import { useSearchParams } from 'react-router-dom';
import { DictionaryPanel } from '../../components/learn/DictionaryPanel';

/** The dictionary as a page. A `?term=` query opens it on a word (the vocabulary notebook links here). */
export function DictionaryPage() {
  const [params] = useSearchParams();
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Dictionary</h1>
          <p className="page-head__meta">
            English definitions with Vietnamese meanings, pronunciation and examples. Save a word and it joins your daily review.
          </p>
        </div>
      </div>
      <DictionaryPanel key={params.get('term') ?? ''} initialTerm={params.get('term') ?? ''} autoFocus={!params.get('term')} />
    </div>
  );
}
