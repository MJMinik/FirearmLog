import { useId } from 'react';
import { stepValue } from '../lib/stepper.ts';

/**
 * A number field with big −/+ buttons for one-handed count entry at the bay
 * (mobile wins the tie). The number stays typeable for large counts; the buttons
 * step by 1 and floor at 0. The visible label is associated to the input via
 * `htmlFor`, so the field stays reachable by its name for screen readers and
 * tests (getByLabel). The −/+ buttons carry their own aria-labels.
 */
export function Stepper({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const atMin = (parseInt(value, 10) || 0) <= 0;
  return (
    <div className="field small stepper-field">
      <label htmlFor={id}>{label}</label>
      <div className="stepper">
        <button type="button" className="stepper-btn" aria-label={`Decrease ${label}`}
          disabled={atMin} onClick={() => onChange(stepValue(value, -1))}>−</button>
        <input id={id} type="number" inputMode="numeric" min="0" value={value}
          onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="stepper-btn" aria-label={`Increase ${label}`}
          onClick={() => onChange(stepValue(value, 1))}>+</button>
      </div>
    </div>
  );
}
