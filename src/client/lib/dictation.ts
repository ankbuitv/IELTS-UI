/**
 * Browser dictation (Web Speech API) shared by the speaking recorder and the
 * AI speaking partner. Chrome/Safari expose it under two names; Firefox and
 * some in-app browsers do not expose it at all, which callers must handle by
 * offering a text box instead.
 */
export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}

export interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0?: { transcript?: string } } & { length: number }>;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function detectSpeechRecognition(): boolean {
  return getSpeechRecognition() !== null;
}

/** Collects final transcript text from a recognition result event. */
export function finalTranscriptOf(event: SpeechRecognitionEventLike): string {
  let text = '';
  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    if (result?.isFinal) text += `${result[0]?.transcript ?? ''} `;
  }
  return text.trim();
}
