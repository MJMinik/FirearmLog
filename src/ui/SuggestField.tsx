// A text field that suggests your own past entries as you type — tap the
// field and recent values appear; type a letter and the list narrows, and
// you can keep typing a brand-new value (a "creatable combobox"). The new
// value is saved the moment the record it's on is saved, so it shows up as a
// suggestion next time. One shared component (DRY) so any form can use it.
import { useState } from 'react';
import { rankSuggestions } from '../lib/suggest.ts';

// Attributes that tell iOS Safari (and password managers) to leave a field
// alone, so OUR suggestions — not Apple's "AutoFill Contact" bar — show up.
// Spread onto any plain text input that was wrongly triggering contact
// autofill. Pair with a non-name-like `name` to defeat iOS's label heuristic.
export const noAutofillProps = {
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'off',
  spellCheck: false,
  'data-1p-ignore': true,
  'data-lpignore': 'true'
} as const;

export function SuggestField({ label, value, onChange, suggestions, placeholder, name }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  name?: string;
}) {
  const [open, setOpen] = useState(false);
  const matches = open ? rankSuggestions(suggestions, value) : [];
  return (
    <label className="field suggest-anchor">{label}
      <input value={value} placeholder={placeholder} {...noAutofillProps}
        name={name}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)} />
      {matches.length > 0 && (
        <div className="suggest-list" role="listbox" aria-label={`${label} suggestions`}>
          {matches.map((v) => (
            <button key={v} type="button" className="suggest-row" role="option" aria-selected={false}
              // preventDefault keeps the input focused so onBlur can't eat the tap
              onPointerDown={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(v); setOpen(false); }}>
              {v}
            </button>
          ))}
        </div>
      )}
    </label>
  );
}
