import { useEffect, useRef } from 'react';

/**
 * M4 / charter §6 ("never let a tap cost someone their work"): detect whether a
 * form has unsaved edits, so a stray ‹ Cancel can prompt instead of silently
 * discarding.
 *
 * Pass a `signature` string built from the form's editable state, and a `ready`
 * flag that is true once the form is initialized (immediately for a new record;
 * after the load effect populates state for an edit). The initial signature is
 * captured the first time `ready` is true, so loading an existing record doesn't
 * register as a change. The returned function reports whether the current
 * signature differs from that captured baseline.
 */
export function useDirtyGuard(signature: string, ready: boolean): () => boolean {
  const initial = useRef<string | null>(null);
  useEffect(() => {
    if (ready && initial.current === null) initial.current = signature;
  }, [ready, signature]);
  return () => initial.current !== null && signature !== initial.current;
}
