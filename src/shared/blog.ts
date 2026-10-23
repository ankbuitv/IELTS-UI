import type { Role } from './types';

/** Blog — posts by admins and mentors, readable by anyone; comments by any signed-in learner. */
export interface BlogAuthor {
  id: string;
  displayName: string;
  avatarUpdatedAt: string | null;
  role: Role;
}

export type BlogPostStatus = 'DRAFT' | 'PUBLISHED';

export interface BlogPostCard {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  status: BlogPostStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  author: BlogAuthor;
  commentCount: number;
}

export interface BlogComment {
  id: string;
  body: string;
  createdAt: string;
  author: BlogAuthor;
}

export interface BlogPostDetail extends BlogPostCard {
  body_md: string;
  comments: BlogComment[];
}
