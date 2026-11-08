import { useEffect, useState } from 'react';
import { ChevronDown, ScanText } from 'lucide-react';
import type { Profile } from '../types';
import { sourceTranscript, uploadCoverage } from '../engine/uploadedWords';
import './UploadedWordLibrary.css';

export default function UploadedWordLibrary({ profile, text, onUpdate, onUseText }: {
  profile: Profile;
  text: string;
  onUpdate: (profile: Profile) => void;
  onUseText: (text: string) => void;
}) {
  const [transcript, setTranscript] = useState(profile.sourceTranscript || '');
  const [error, setError] = useState('');

  useEffect(() => {
    setTranscript(profile.sourceTranscript || '');
    setError('');
  }, [profile.id, profile.sourceTranscript]);

  const words = profile.wordSamples;
  if (!words?.length) return <p className="upload-library-notice">This older profile only stores style references. Upload the original note again to enable reuse of its actual words.</p>;

  const coverage = uploadCoverage(text, profile);
  const percent = coverage.total ? Math.round(coverage.found.length / coverage.total * 100) : 0;
  const missingPreview = coverage.missing.slice(0, 3).map(word => word.length > 24 ? `${word.slice(0, 24)}…` : word).join(', ');
  const commit = (updated: NonNullable<Profile['wordSamples']>) => onUpdate({
    ...profile,
    wordSamples: updated,
    sourceTranscript: sourceTranscript(updated),
    updatedAt: Date.now(),
  });

  return <section className="uploaded-word-library" aria-label="Uploaded handwriting word library">
    <div className="word-library-overview">
      <span className="word-library-icon" aria-hidden="true"><ScanText size={19} /></span>
      <div className="word-library-coverage">
        <span className="word-library-eyebrow">Original ink library</span>
        <strong>{coverage.found.length} of {coverage.total} typed words can use your original handwriting</strong>
        <p>{!coverage.total
          ? 'Type in the editor to see which words can reuse the ink from your sample.'
          : coverage.missing.length
            ? `${coverage.missing.length} unmatched ${coverage.missing.length === 1 ? 'word needs' : 'words need'} approximate synthesis: ${missingPreview}${coverage.missing.length > 3 ? '…' : ''}. Review the sample text below if these words are already in your note.`
            : 'Every typed word has an uploaded match. Its original ink will be reused; no synthesis is needed.'}</p>
      </div>
      <span className="word-library-match" aria-label={`${percent}% original handwriting coverage`}>
        <b>{percent}<small>%</small></b><span>original ink</span>
      </span>
    </div>
    <progress className="word-library-progress" aria-label="Original handwriting word coverage" max={coverage.total || 1} value={coverage.found.length} />
    <details className="word-library-details">
      <summary>
        <span>Review the text read from your sample <small>({words.length} word crops)</small></span>
        <ChevronDown size={15} aria-hidden="true" />
      </summary>
      <div className="word-library-review" tabIndex={0} role="region" aria-label="Recognized sample review">
        {!!coverage.missing.length && <details className="word-library-unmatched">
          <summary>New or unmatched words ({coverage.missing.length})</summary>
          <p>{coverage.missing.join(', ')}</p>
        </details>}
        <p className="word-library-help">Recognition can misread handwriting. Correct this transcript or the individual labels below. Match spelling, capitalization and punctuation to the image.</p>
        <label className="word-library-transcript">
          Recognized sample text
          <textarea aria-label="Recognized sample text" value={transcript} onChange={event => setTranscript(event.target.value)} rows={4} />
        </label>
        <div className="word-library-actions">
          <button className="button small" onClick={() => {
            const labels = transcript.match(/\S+/g) || [];
            if (labels.length !== words.length) {
              setError(`The sample has ${words.length} word crops, but this text has ${labels.length} words. Correct individual crop labels below if a word was joined or split.`);
              return;
            }
            setError('');
            commit(words.map((word, index) => ({ ...word, text: labels[index] })));
          }}>Apply corrected labels</button>
          <button className="button small" onClick={() => onUseText(profile.sourceTranscript || sourceTranscript(words))}>Use recognized text in editor</button>
        </div>
        {error && <p className="word-library-warning" role="alert">{error}</p>}
        {profile.sourceReadWarnings?.map((warning, index) => <p className="word-library-warning" key={index}>{warning}</p>)}
        <div className="word-library-grid-heading"><span>Original word crops</span><span>Edit a label to correct it</span></div>
        <div className="uploaded-word-grid">{words.map((word, index) => <label className="uploaded-word-card" key={word.id}>
          <span className="uploaded-word-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          <img src={word.image} alt={`Original uploaded word ${index + 1}`} loading="lazy" />
          <input aria-label={`Uploaded word label ${index + 1}`} value={word.text} maxLength={160} onChange={event => commit(words.map((sample, sampleIndex) => sampleIndex === index ? { ...sample, text: event.target.value } : sample))} />
        </label>)}</div>
      </div>
    </details>
  </section>;
}
