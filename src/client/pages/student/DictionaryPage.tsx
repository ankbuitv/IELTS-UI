import { useSearchParams } from 'react-router-dom';
import { DictionaryPanel } from '../../components/learn/DictionaryPanel';
import { PageHead } from '../../components/page';

/** The dictionary as a page. A `?term=` query opens it on a word (the vocabulary notebook links here). */
export function DictionaryPage() {
  const [params] = useSearchParams();
  return (
    <div className="stack">
      <PageHead
        eyebrow="Reference"
        title="Dictionary"
        meta="English definitions with Vietnamese meanings, pronunciation and examples. Save a word and it joins your daily review."
      />
      <DictionaryPanel key={params.get('term') ?? ''} initialTerm={params.get('term') ?? ''} autoFocus={!params.get('term')} />
    </div>
  );
}
