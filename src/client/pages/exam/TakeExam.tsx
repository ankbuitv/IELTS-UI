import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useExamSession } from '../../components/exam/useExamSession';
import { ExamShell } from '../../components/exam/ExamShell';
import { Button, Loading, Notice } from '../../components/ui';

export function TakeExamPage() {
  const { attemptId = '' } = useParams();
  const navigate = useNavigate();
  const session = useExamSession(attemptId);

  useEffect(() => {
    if (session.state?.submitted) {
      navigate(`/attempts/${attemptId}`, { replace: true });
    }
  }, [session.state?.submitted, attemptId, navigate]);

  if (session.loading && !session.state) {
    return (
      <div className="exam-root" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Loading label="Establishing your server-authoritative attempt…" />
      </div>
    );
  }

  if (session.error && !session.state) {
    return (
      <div className="exam-root" style={{ alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div className="card" style={{ maxWidth: 520 }}>
          <Notice tone="danger" title="This attempt could not be opened">
            {session.error}
          </Notice>
          <div className="row" style={{ marginTop: 14 }}>
            <Button onClick={() => void session.reload()}>Retry</Button>
            <Button variant="ghost" onClick={() => navigate('/dashboard')}>
              Back to dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ExamShell
      session={session}
      onFinished={() => navigate(`/attempts/${attemptId}`, { replace: true })}
    />
  );
}
