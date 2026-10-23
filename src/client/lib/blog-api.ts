import { api } from './api';
import type { BlogComment, BlogPostCard, BlogPostDetail } from '@shared/blog';

export const blogApi = {
  listPublished: () => api.get<{ posts: BlogPostCard[] }>('/api/blog'),
  listManageable: () => api.get<{ posts: BlogPostCard[] }>('/api/blog/manage'),
  get: (slug: string) => api.get<{ post: BlogPostDetail }>(`/api/blog/${encodeURIComponent(slug)}`),
  create: (input: { title: string; excerpt: string; body_md: string }) =>
    api.post<{ post: BlogPostDetail }>('/api/blog', input),
  update: (postId: string, input: { title?: string; excerpt?: string; body_md?: string }) =>
    api.patch<{ post: BlogPostDetail }>(`/api/blog/${encodeURIComponent(postId)}`, input),
  setPublished: (postId: string, published: boolean) =>
    api.post<{ post: BlogPostDetail }>(`/api/blog/${encodeURIComponent(postId)}/publish`, { published }),
  remove: (postId: string) => api.delete(`/api/blog/${encodeURIComponent(postId)}`),
  comment: (slug: string, body: string) =>
    api.post<{ comment: BlogComment }>(`/api/blog/${encodeURIComponent(slug)}/comments`, { body }),
  removeComment: (commentId: string) =>
    api.delete(`/api/blog/comments/${encodeURIComponent(commentId)}`),
};
