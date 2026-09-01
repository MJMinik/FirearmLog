// A text field that suggests your own past entries as you type — tap the
// field and recent values appear; type a letter and the list narrows, and
// you can keep typing a brand-new value (a "creatable combobox"). The new
// value is saved the moment the record it's on is saved, so it shows up as a
// suggestion next time. One shared component (DRY) so any form can use it.
import { useState } from 'react';
import type { MutableRefObject, Ref } from 'react';
import { rankSuggestions } from '../lib/suggest.ts';

// Attributes that tell iOS Safari (and password managers) to leave a field
// alone, so OUR suggestions — not Apple's "AutoFill Contact" bar — show up.
// Spread onto any plain text input that was wrongly triggering contact
// autofill. Pair with a non-name-like `name` to defeat iOS's label heuristic.
/* iOS contact-AutoFill defense, round two (session 138, 1 Sep 2026, Michael's
   phone). Round one (July audit) found Safari scans a field's name attribute,
   then placeholder, then label for contact-ish tokens, and renamed the fields
   to *-title — which killed the bar at the time. It came back: "title" is
   itself a contact-card token (job title), and a later iOS appears to treat it
   as one. The standing rule these props travel with: a text field's name
   attribute uses flog-* words that no contact card carries — never name,
   title, first, last, phone, email, organization, address. autoComplete='off'
   alone does NOT stop the contact bar on iOS. */
export const noAutofillProps = {
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'off',
  spellCheck: false,
  'data-1p-ignore': true,
  'data-lpignore': 'true'
} as const;

export function SuggestField({ label, value, onChange, suggestions, placeholder, name, inputRef, enterKeyHint, onEnter, suppressOpenOnFocus }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  name?: string;
  // Tester-2 F2 (July 16 2026): the goals form drives the keyboard's Return key
  // from field to field. inputRef lets a parent focus THIS field; onEnter fires
  // on Return so the parent can advance focus to the next field (Enter must not
  // commit the goal — only the Add Goal button does).
  inputRef?: Ref<HTMLInputElement>;
  enterKeyHint?: 'enter' | 'done' | 'go' | 'next' | 'previous' | 'search' | 'send';
  onEnter?: () => void;
  // A6 (Michael, July 17 2026): a shared "suppress the next auto-open" flag.
  // When focus arrives PROGRAMMATICALLY (Enter-advancing from the field above),
  // the parent sets this true right before calling focus(); the field then skips
  // opening its suggestion list once and clears the flag. Discoverability is
  // kept — a real tap/click or typing still opens the list — but the noise of a
  // menu popping open on every Return keypress is cut.
  suppressOpenOnFocus?: MutableRefObject<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const matches = open ? rankSuggestions(suggestions, value) : [];
  return (
    <label className="field suggest-anchor">{label}
      <input value={value} placeholder={placeholder} {...noAutofillProps}
        name={name} ref={inputRef} enterKeyHint={enterKeyHint}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => {
          // A6: honor the one-shot suppression from an Enter-advance, then clear
          // it so the very next real focus (a tap) opens normally.
          if (suppressOpenOnFocus?.current) { suppressOpenOnFocus.current = false; return; }
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) { e.preventDefault(); setOpen(false); onEnter(); }
        }}
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
