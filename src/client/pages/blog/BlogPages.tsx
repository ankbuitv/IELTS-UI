import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Button, EmptyState, Loading, Notice } from '../../components/ui';
import { UserAvatar } from '../../components/UserAvatar';
import { RichText } from '../../components/RichText';
import { describeError } from '../../lib/api';
import { formatDateTime, relativeTime } from '../../lib/format';
import { blogApi } from '../../lib/blog-api';
import { useAuth } from '../../context/AuthContext';
import type { BlogPostCard } from '@shared/blog';

export function BlogListPage() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<BlogPostCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDrafts, setShowDrafts] = useState(false);
  const [manageable, setManageable] = useState<BlogPostCard[]>([]);
  const canWrite = user?.role === 'MENTOR' || user?.role === 'ADMIN';

  useEffect(() => {
    let alive = true;
    blogApi
      .listPublished()
      .then((res) => {
        if (alive) setPosts(res.posts);
      })
      .catch((err) => {
        if (alive) setError(describeError(err));
      });
    if (canWrite) {
      blogApi
        .listManageable()
        .then((res) => {
          if (alive) setManageable(res.posts.filter((post) => post.status === 'DRAFT'));
        })
        .catch(() => {
          /* the manage board is a convenience — silence is fine */
        });
    }
    return () => {
      alive = false;
    };
  }, [canWrite]);

  const visible = showDrafts ? [...manageable, ...(posts ?? [])] : posts ?? [];

  return (
    <div className="page blog-page">
      <div className="page-head">
        <div>
          <h1>Blog</h1>
          <p className="page-head__meta">Ghi chú luyện thi, mẹo bốn kỹ năng và tin từ cố vấn Ai eo.</p>
        </div>
        {canWrite ? (
          <div className="row">
            {manageable.length > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => setShowDrafts((on) => !on)}>
                {showDrafts ? 'Ẩn bản nháp' : `Bản nháp (${manageable.length})`}
              </Button>
            ) : null}
            <Link className="btn btn--primary" to="/blog/write">
              Viết bài
            </Link>
          </div>
        ) : null}
      </div>

      {error ? <Notice tone="danger" title="Không tải được blog">{error}</Notice> : null}

      {posts === null && !error ? <Loading label="Đang tải bài viết…" /> : null}

      {posts !== null && visible.length === 0 && !error ? (
        <EmptyState title="Chưa có bài viết nào" icon="book">
          <p className="muted">Bài viết đầu tiên từ đội cố vấn sẽ xuất hiện ở đây.</p>
        </EmptyState>
      ) : null}

      {visible.length > 0 ? (
        <div className="blog-grid">
          {visible.map((post) => (
            <Link key={post.id} className="card card--link blog-card" to={`/blog/${post.slug}`}>
              <div className="blog-card__meta">
                {post.status === 'DRAFT' ? <Badge tone="warning">Nháp</Badge> : null}
                <span className="muted small">
                  {relativeTime(post.publishedAt ?? post.createdAt)}
                </span>
              </div>
              <h2 className="blog-card__title">{post.title}</h2>
              {post.excerpt ? <p className="blog-card__excerpt">{post.excerpt}</p> : null}
              <div className="blog-card__byline">
                <UserAvatar
                  userId={post.author.id}
                  avatarUpdatedAt={post.author.avatarUpdatedAt}
                  name={post.author.displayName}
                  size={24}
                />
                <span className="muted small">{post.author.displayName}</span>
                {post.commentCount > 0 ? (
                  <span className="muted small blog-card__comments">{post.commentCount} bình luận</span>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function BlogPostPage() {
  const { user } = useAuth();
  const { slug = '' } = useParams();
  const [post, setPost] = useState<Awaited<ReturnType<typeof blogApi.get>>['post'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let alive = true;
    blogApi
      .get(slug)
      .then((res) => {
        if (alive) setPost(res.post);
      })
      .catch((err) => {
        if (alive) setError(describeError(err));
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  if (error) return <div className="page"><Notice tone="danger" title="Không tìm thấy bài viết">{error}</Notice></div>;
  if (!post) return <div className="page"><Loading label="Đang tải bài viết…" /></div>;

  const canComment = !!user;
  const canDeleteComment = (comment: { author: { id: string } }) =>
    user && (user.role === 'ADMIN' || user.id === comment.author.id);

  const submitComment = async () => {
    const body = commentBody.trim();
    if (!body) return;
    setPosting(true);
    try {
      await blogApi.comment(slug, body);
      const res = await blogApi.get(slug);
      setPost(res.post);
      setCommentBody('');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="page blog-page blog-page--read">
      <article className="blog-post">
        <div className="blog-post__meta">
          {post.status === 'DRAFT' ? <Badge tone="warning">Bản nháp</Badge> : null}
          <span className="muted small">{formatDateTime(post.publishedAt ?? post.createdAt)}</span>
        </div>
        <h1 className="blog-post__title">{post.title}</h1>
        <div className="blog-post__byline">
          <UserAvatar
            userId={post.author.id}
            avatarUpdatedAt={post.author.avatarUpdatedAt}
            name={post.author.displayName}
            size={32}
          />
          <div>
            <div className="blog-post__author">{post.author.displayName}</div>
            <div className="muted small">{relativeTime(post.publishedAt ?? post.createdAt)}</div>
          </div>
        </div>
        <div className="blog-post__body">
          <RichText text={post.body_md} variant="article" />
        </div>
      </article>

      <section className="blog-comments">
        <h2 className="blog-comments__title">Bình luận ({post.comments.length})</h2>

        {post.comments.length === 0 ? (
          <p className="muted">Chưa có bình luận nào.</p>
        ) : (
          <ul className="blog-comments__list">
            {post.comments.map((comment) => (
              <li key={comment.id} className="blog-comment">
                <div className="blog-comment__head">
                  <UserAvatar
                    userId={comment.author.id}
                    avatarUpdatedAt={comment.author.avatarUpdatedAt}
                    name={comment.author.displayName}
                    size={24}
                  />
                  <span className="blog-comment__author">{comment.author.displayName}</span>
                  <span className="muted small">{relativeTime(comment.createdAt)}</span>
                  {canDeleteComment(comment) ? (
                    <button
                      type="button"
                      className="link-btn small"
                      onClick={async () => {
                        try {
                          await blogApi.removeComment(comment.id);
                          const res = await blogApi.get(slug);
                          setPost(res.post);
                        } catch (err) {
                          setError(describeError(err));
                        }
                      }}
                    >
                      Xóa
                    </button>
                  ) : null}
                </div>
                <p className="blog-comment__body">{comment.body}</p>
              </li>
            ))}
          </ul>
        )}

        {canComment ? (
          <div className="blog-comments__form">
            <textarea
              className="input"
              rows={3}
              placeholder="Viết bình luận của bạn…"
              value={commentBody}
              onChange={(event) => setCommentBody(event.target.value)}
            />
            <div className="row">
              <Button size="sm" loading={posting} disabled={!commentBody.trim()} onClick={submitComment}>
                Gửi bình luận
              </Button>
            </div>
          </div>
        ) : (
          <Notice tone="info" title="Đăng nhập để bình luận">
            <Link to="/login">Đăng nhập</Link> với tài khoản Ai eo để tham gia thảo luận.
          </Notice>
        )}
      </section>
    </div>
  );
}
