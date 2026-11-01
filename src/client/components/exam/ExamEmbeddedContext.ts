import { createContext, useContext, type RefObject } from 'react';
/** A staff exam lives inside this window; null means the normal full-page experience. */
export const ExamEmbeddedContext = createContext<RefObject<HTMLDivElement | null> | null>(null);
export const useExamContainer = () => useContext(ExamEmbeddedContext);
export const useExamEmbedded = () => useExamContainer() !== null;
