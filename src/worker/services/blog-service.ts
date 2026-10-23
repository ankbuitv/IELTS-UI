/**
 * The blog: posts by admins and mentors, readable by anyone; comments from
 * any signed-in account. Slugs are derived from the title (diacritics
 * stripped) and kept unique at write time.
 */
import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import type { BlogAuthor, BlogComment, BlogPostCard, BlogPostDetail, BlogPostStatus } from '../../shared/blog';

interface PostRow {
  id: string;
  author_id: string;
  author_name: string | null;
  author_username: string | null;
  author_avatar_at: string | null;
  author_role: BlogAuthor['role'];
  title: string;
  slug: string;
  excerpt: string;
  body_md: string;
  status: BlogPostStatus;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  comment_count: number;
}

interface CommentRow {
  id: string;
  post_id: string;
  body: string;
  created_at: string;
  user_id: string;
  display_name: string | null;
  username: string | null;
  avatar_updated_at: string | null;
  role: BlogAuthor['role'];
}

const POST_SELECT = `
  SELECT p.*, up.display_name AS author_name, u.username AS author_username,
         up.avatar_updated_at AS author_avatar_at, u.role AS author_role,
         (SELECT COUNT(*) FROM blog_comments bc WHERE bc.post_id = p.id) AS comment_count
    FROM blog_posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN user_profiles up ON up.user_id = u.id`;

const COMMENT_SELECT = `
  SELECT c.*, up.display_name, u.username, up.avatar_updated_at, u.role
    FROM blog_comments c
    JOIN users u ON u.id = c.user_id
    LEFT JOIN user_profiles up ON up.user_id = u.id`;

/**
 * Slug from a Vietnamese title: diacritics folded away, everything else
 * collapsed into dashes. `Bài viết mới #1` → `bai-viet-moi-1`.
 */
export function slugify(input: string): string {
  const base = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.slice(0, 80) || 'bai-viet';
}

const authorOf = (row: { author_id: string; author_name: string | null; author_username: string | null; author_avatar_at: string | null; author_role: BlogAuthor['role'] }): BlogAuthor => ({
  id: row.author_id,
  displayName: row.author_name?.trim() || row.author_username || 'Tác giả',
  avatarUpdatedAt: row.author_avatar_at,
  role: row.author_role,
});

const cardOf = (row: PostRow): BlogPostCard => ({
  id: row.id,
  title: row.title,
  slug: row.slug,
  excerpt: row.excerpt,
  status: row.status,
  publishedAt: row.published_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  author: authorOf(row),
  commentCount: row.comment_count,
});

const commentOf = (row: CommentRow): BlogComment => ({
  id: row.id,
  body: row.body,
  createdAt: row.created_at,
  author: {
    id: row.user_id,
    displayName: row.display_name?.trim() || row.username || 'Bạn đọc',
    avatarUpdatedAt: row.avatar_updated_at,
    role: row.role,
  },
});

/** Published posts, newest first. */
export async function listPublishedPosts(env: Env): Promise<{ posts: BlogPostCard[] }> {
  const rows = await env.DB.prepare(
    `${POST_SELECT} WHERE p.status = 'PUBLISHED' ORDER BY p.published_at DESC LIMIT 60`,
  ).all<PostRow>();
  return { posts: (rows.results ?? []).map(cardOf) };
}

/** The editor's board: an admin sees everything, a mentor their own drafts too. */
export async function listManageablePosts(env: Env, viewer: AuthUser): Promise<{ posts: BlogPostCard[] }> {
  const rows = await env.DB.prepare(
    `${POST_SELECT} WHERE p.author_id = ? OR ? = 'ADMIN' ORDER BY p.created_at DESC LIMIT 120`,
  )
    .bind(viewer.id, viewer.role)
    .all<PostRow>();
  return { posts: (rows.results ?? []).map(cardOf) };
}

/**
 * One post, with its comments. The key may be a slug (`/blog/:slug`) or a post
 * id — the editor's save/publish handlers arrive with an id, so a single lookup
 * path keeps them from 404-ing on a post that plainly exists. Drafts are visible
 * to their author and to admins.
 */
export async function getPost(env: Env, key: string, viewer: AuthUser | null): Promise<BlogPostDetail> {
  const row = await env.DB.prepare(`${POST_SELECT} WHERE p.slug = ? OR p.id = ?`)
    .bind(key, key)
    .first<PostRow>();
  if (!row) throw ApiError.notFound('That post does not exist.');
  if (row.status !== 'PUBLISHED' && row.author_id !== viewer?.id && viewer?.role !== 'ADMIN') {
    throw ApiError.notFound('That post does not exist.');
  }
  const comments = await env.DB.prepare(
    `${COMMENT_SELECT} WHERE c.post_id = ? ORDER BY c.created_at ASC LIMIT 300`,
  )
    .bind(row.id)
    .all<CommentRow>();
  return { ...cardOf(row), body_md: row.body_md, comments: (comments.results ?? []).map(commentOf) };
}

const canWrite = (viewer: AuthUser): void => {
  if (viewer.role !== 'ADMIN' && viewer.role !== 'MENTOR') {
    throw ApiError.forbidden('Only mentors and administrators can write blog posts.');
  }
};

async function uniqueSlug(env: Env, title: string, currentId?: string): Promise<string> {
  const base = slugify(title);
  let slug = base;
  for (let attempt = 2; attempt <= 30; attempt += 1) {
    const clash = await env.DB.prepare('SELECT id FROM blog_posts WHERE slug = ?')
      .bind(slug)
      .first<{ id: string }>();
    if (!clash || clash.id === currentId) return slug;
    slug = `${base}-${attempt}`;
  }
  return `${base}-${Date.now()}`;
}

export async function createPost(
  env: Env,
  viewer: AuthUser,
  input: { title: string; excerpt: string; body_md: string },
): Promise<BlogPostDetail> {
  canWrite(viewer);
  const id = newId('post');
  const timestamp = nowIso();
  const slug = await uniqueSlug(env, input.title);
  await env.DB.prepare(
    `INSERT INTO blog_posts (id, author_id, title, slug, excerpt, body_md, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)`,
  )
    .bind(id, viewer.id, input.title, slug, input.excerpt, input.body_md, timestamp, timestamp)
    .run();
  return getPost(env, slug, viewer);
}

async function ownedPost(env: Env, viewer: AuthUser, postId: string): Promise<PostRow> {
  const row = await env.DB.prepare(`${POST_SELECT} WHERE p.id = ?`).bind(postId).first<PostRow>();
  if (!row) throw ApiError.notFound('That post does not exist.');
  if (row.author_id !== viewer.id && viewer.role !== 'ADMIN') {
    throw ApiError.forbidden('Only the author or an administrator can change this post.');
  }
  return row;
}

export async function updatePost(
  env: Env,
  viewer: AuthUser,
  postId: string,
  input: { title?: string; excerpt?: string; body_md?: string },
): Promise<BlogPostDetail> {
  await ownedPost(env, viewer, postId);
  const fields: string[] = [];
  const values: Array<string | null> = [];
  if (input.title !== undefined) {
    fields.push('title = ?', 'slug = ?');
    values.push(input.title, await uniqueSlug(env, input.title, postId));
  }
  if (input.excerpt !== undefined) fields.push('excerpt = ?'), values.push(input.excerpt);
  if (input.body_md !== undefined) fields.push('body_md = ?'), values.push(input.body_md);
  if (fields.length === 0) throw ApiError.validation('Nothing to save.');
  await env.DB.prepare(`UPDATE blog_posts SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...values, nowIso(), postId)
    .run();
  const row = await env.DB.prepare('SELECT slug FROM blog_posts WHERE id = ?').bind(postId).first<{ slug: string }>();
  return getPost(env, row!.slug, viewer);
}

export async function setPublished(env: Env, viewer: AuthUser, postId: string, published: boolean): Promise<BlogPostDetail> {
  const row = await ownedPost(env, viewer, postId);
  if (published && !row.body_md.trim()) throw ApiError.validation('An empty post cannot be published.');
  const timestamp = nowIso();
  await env.DB.prepare(
    `UPDATE blog_posts SET status = ?, published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ?`,
  )
    .bind(published ? 'PUBLISHED' : 'DRAFT', timestamp, timestamp, postId)
    .run();
  return getPost(env, row.slug, viewer);
}

export async function deletePost(env: Env, viewer: AuthUser, postId: string): Promise<{ ok: true }> {
  const row = await ownedPost(env, viewer, postId);
  // Children explicitly first: the batch must not lean on the foreign-key pragma.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM blog_comments WHERE post_id = ?').bind(row.id),
    env.DB.prepare('DELETE FROM blog_posts WHERE id = ?').bind(row.id),
  ]);
  return { ok: true };
}

export async function addComment(env: Env, viewer: AuthUser, slug: string, body: string): Promise<BlogComment> {
  const post = await env.DB.prepare("SELECT id, status FROM blog_posts WHERE slug = ?").bind(slug).first<{ id: string; status: BlogPostStatus }>();
  if (!post || post.status !== 'PUBLISHED') throw ApiError.notFound('That post does not exist.');
  const id = newId('cmt');
  const timestamp = nowIso();
  await env.DB.prepare('INSERT INTO blog_comments (id, post_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, post.id, viewer.id, body, timestamp)
    .run();
  const row = await env.DB.prepare(
    `${COMMENT_SELECT} WHERE c.id = ?`,
  )
    .bind(id)
    .first<CommentRow>();
  return commentOf(row!);
}

export async function deleteComment(env: Env, viewer: AuthUser, commentId: string): Promise<{ ok: true }> {
  const row = await env.DB.prepare('SELECT id, user_id FROM blog_comments WHERE id = ?')
    .bind(commentId)
    .first<{ id: string; user_id: string }>();
  if (!row) throw ApiError.notFound('That comment does not exist.');
  if (row.user_id !== viewer.id && viewer.role !== 'ADMIN') {
    throw ApiError.forbidden('Only the comment author or an administrator can delete it.');
  }
  await env.DB.prepare('DELETE FROM blog_comments WHERE id = ?').bind(row.id).run();
  return { ok: true };
}
