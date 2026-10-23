import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, ConfirmButton, Field, Loading, Notice, TextArea, TextInput } from '../../components/ui';
import { RichText } from '../../components/RichText';
import { describeError } from '../../lib/api';
import { blogApi } from '../../lib/blog-api';
import type { BlogPostDetail } from '@shared/blog';

/**
 * Write and edit a blog post. Markdown is rendered beside the editor with the
 * same RichText component the reader sees, so the preview is never a second
 * opinion about what will be published.
 */
export function BlogEditorPage() {
  const { postId = '' } = useParams();
  const navigate = useNavigate();
  const isNew = !postId;

  const [post, setPost] = useState<BlogPostDetail | null>(null);
  const [title, setTitle] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [loaded, setLoaded] = useState(isNew);

  useEffect(() => {
    if (isNew) return;
    let alive = true;
    blogApi
      .get(postId)
      .then((res) => {
        if (!alive) return;
        setPost(res.post);
        setTitle(res.post.title);
        setExcerpt(res.post.excerpt);
        setBody(res.post.body_md);
        setLoaded(true);
      })
      .catch((err) => {
        if (alive) setError(describeError(err));
      });
    return () => {
      alive = false;
    };
  }, [postId, isNew]);

  const dirty = post
    ? title !== post.title || excerpt !== post.excerpt || body !== post.body_md
    : title.trim() !== '' || excerpt.trim() !== '' || body.trim() !== '';

  const save = async (): Promise<BlogPostDetail | null> => {
    if (!title.trim()) {
      setError('Give the post a title before saving.');
      return null;
    }
    if (!body.trim()) {
      setError('The body is empty — write something before saving.');
      return null;
    }
    setSaving(true);
    setError(null);
    try {
      const input = { title: title.trim(), excerpt: excerpt.trim(), body_md: body };
      const saved = isNew
        ? await blogApi.create(input)
        : await blogApi.update(postId, input);
      setPost(saved.post);
      setError(null);
      if (isNew) navigate(`/blog/write/${saved.post.id}`, { replace: true });
      return saved.post;
    } catch (err) {
      setError(describeError(err));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async () => {
    if (!post) return;
    // A never-saved draft has nothing to publish — save first, then flip.
    if (isNew || dirty) {
      const saved = await save();
      if (!saved) return;
      setToggling(true);
      try {
        const next = await blogApi.setPublished(saved.id, saved.status !== 'PUBLISHED');
        setPost(next.post);
      } catch (err) {
        setError(describeError(err));
      } finally {
        setToggling(false);
      }
      return;
    }
    setToggling(true);
    try {
      const next = await blogApi.setPublished(post.id, post.status !== 'PUBLISHED');
      setPost(next.post);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setToggling(false);
    }
  };

  const remove = async () => {
    if (!post) return;
    try {
      await blogApi.remove(post.id);
      navigate('/blog');
    } catch (err) {
      setError(describeError(err));
    }
  };

  if (!loaded) return <div className="page"><Loading label="Đang tải bài viết…" /></div>;

  const published = post?.status === 'PUBLISHED';

  return (
    <div className="page blog-page">
      <div className="page-head">
        <div>
          <h1>{isNew ? 'Viết bài mới' : 'Sửa bài viết'}</h1>
          <p className="page-head__meta">
            Hỗ trợ Markdown: <code>#</code> tiêu đề, <code>**đậm**</code>, <code>`code`</code>, danh sách và bảng.
          </p>
        </div>
        <div className="row">
          {!isNew && post ? (
            <Badge tone={published ? 'success' : 'warning'}>{published ? 'Đã đăng' : 'Bản nháp'}</Badge>
          ) : null}
          {post && !isNew ? (
            <ConfirmButton
              title="Xóa bài viết?"
              body="Bài viết và toàn bộ bình luận sẽ bị xóa vĩnh viễn."
              confirmLabel="Xóa bài"
              onConfirm={remove}
            >
              Xóa
            </ConfirmButton>
          ) : null}
          <Button variant="ghost" onClick={togglePublish} loading={toggling} disabled={isNew && !dirty}>
            {published ? 'Rút bài' : 'Đăng bài'}
          </Button>
          <Button variant="primary" onClick={save} loading={saving}>
            {isNew ? 'Lưu nháp' : 'Lưu thay đổi'}
          </Button>
        </div>
      </div>

      {error ? <Notice tone="danger" title="Không lưu được">{error}</Notice> : null}

      <div className="blog-editor">
        <div className="blog-editor__form">
          <Field label="Tiêu đề" required>
            {(id) => (
              <TextInput
                id={id}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Ví dụ: Mẹo quản lý thời gian ở Reading"
                maxLength={160}
              />
            )}
          </Field>
          <Field label="Mô tả ngắn" hint="Một hoặc hai dòng hiện trên thẻ blog — để trống sẽ tự rút từ nội dung.">
            {(id) => (
              <TextArea
                id={id}
                rows={2}
                value={excerpt}
                onChange={(event) => setExcerpt(event.target.value)}
                maxLength={400}
              />
            )}
          </Field>
          <Field label="Nội dung (Markdown)" required>
            {(id) => (
              <TextArea
                id={id}
                rows={20}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder={'## Tiêu đề mục\n\nĐoạn văn…\n\n- gạch đầu dòng\n- gạch đầu dòng thứ hai'}
              />
            )}
          </Field>
        </div>
        <div className="blog-editor__preview">
          <div className="blog-editor__preview-label">Xem trước</div>
          {body.trim() ? (
            <RichText text={body} variant="article" />
          ) : (
            <p className="muted">Bản xem trước hiện ra khi bạn gõ nội dung.</p>
          )}
        </div>
      </div>
    </div>
  );
}
