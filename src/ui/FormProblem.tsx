// Shared validation-error line for every form (audit #7). The problem message
// renders at the top of long forms, but the Save button is at the bottom — so a
// failed save could leave its only feedback far off-screen. This component
// scrolls itself into view (and announces to screen readers) whenever a new
// problem appears, so the user always sees why a save didn't go through.
import { useEffect, useRef } from 'react';

export function FormProblem({ problem }: { problem: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (problem) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [problem]);
  if (!problem) return null;
  return (
    <p className="form-problem" ref={ref} role="alert" aria-live="assertive">{problem}</p>
  );
}
