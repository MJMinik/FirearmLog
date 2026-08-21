// The match-side "Magazines" disclosure (spec: vault "Magazines in
// competitions", 17 Aug 2026, decisions 1a/2a/3a/4a/5). Same collapsed
// pattern as SessionForm's per-gun mag picker, minus the per-gun repetition —
// a match has exactly one gun, so this is that pattern with one fewer axis.
// Shared by MatchForm (log/edit a match) and both PractiScoreImport confirm
// screens (decision 3a) so the three surfaces can never drift apart.
//
// Ownership split: this component owns its OWN UI state (the disclosure
// open/closed, the magazine + past-match lookups it needs, and the as-typed
// override text so a half-finished number doesn't get coerced mid-keystroke).
// It does NOT own the picked mags/overrides/conditions themselves — those are
// passed in once as `initial*` props (read only at mount) and every change is
// reported immediately via `onChange`, so the CALLER is the single source of
// truth for what actually gets saved. Callers key each instance by
// `firearmId` (`key={firearmId}`) so picking a different gun remounts this
// component fresh — old picks belonged to the old gun's magazines and would
// be meaningless carried over, the same reasoning SessionForm's syncGun uses
// when a gun is removed from a session.
import { Fragment, useEffect, useId, useMemo, useState } from 'react';
import type { Magazine, Match } from '../lib/types.ts';
import { getAll } from '../lib/db.ts';
import { splitRounds } from '../lib/mags.ts';
import { Icon } from './Icon.tsx';

export interface MatchMagPatch {
  magIds: string[];
  magOverrides: { magId: string; rounds: number }[];
  magConditions: { magId: string; tag: string }[];
}

/** The minimal v1 condition tag (decision 4a) — one optional tag per
 *  match-mag, independent of round count. NOT a structured incident form:
 *  one tag, plus the match's own free-text notes field for anything more.
 *  Expanded 21 Aug 2026 (board-adopted): Water, Snow, and Dust added
 *  alongside the original five. The curated list stays fixed — the board
 *  rejected a user-editable list so condition categories stay comparable
 *  across mags/matches; anything a tag can't capture belongs in the match's
 *  own notes field. */
const CONDITION_TAGS: { value: string; label: string }[] = [
  { value: '', label: 'No tag' },
  { value: 'sand', label: 'Sand' },
  { value: 'mud', label: 'Mud' },
  { value: 'rain', label: 'Rain' },
  { value: 'water', label: 'Water' },
  { value: 'snow', label: 'Snow' },
  { value: 'dust', label: 'Dust' },
  { value: 'dropped', label: 'Dropped' },
  { value: 'issue', label: 'Issue' },
];

export function MatchMagPicker({
  firearmId, totalRounds, initialMagIds, initialMagOverrides, initialMagConditions, sticky, onChange,
}: {
  firearmId: string;
  /** The match's rounds fired, live (may be null — "pending a round count",
   *  never a silent zero, spec decision 2a). */
  totalRounds: number | null;
  initialMagIds?: string[];
  initialMagOverrides?: { magId: string; rounds: number }[];
  initialMagConditions?: { magId: string; tag: string }[];
  /**
   * Offer the "same mags as last time" one-tap suggestion. True only for a
   * brand-new match/import — never when opening an existing match's saved
   * picks, which show exactly what is stored (spec decision: "do not pre-tick
   * on edit of an existing match"). Mirrors SessionForm's magSuggestion rule
   * (session 100, 75): a saved record's history is never backfilled from
   * habit.
   */
  sticky: boolean;
  onChange: (next: MatchMagPatch) => void;
}) {
  const [magazines, setMagazines] = useState<Magazine[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(Array.isArray(initialMagIds) ? initialMagIds : []);
  // Unique per instance: the Steel confirm screen renders one picker per
  // entry, and a static id would break aria-describedby for all but one of
  // them (audit finding D, 17 Aug 2026).
  const suggestListId = useId();
  // As-typed override text, keyed by magId — mirrors SessionForm's
  // magOverride[fid]: present only once the shooter edits a number, and its
  // presence (not its values) is what marks the split "custom" rather than
  // even. Seeded from the passed-in props once, at mount.
  const [overrideText, setOverrideText] = useState<Record<string, string>>(() => {
    const t: Record<string, string> = {};
    for (const o of Array.isArray(initialMagOverrides) ? initialMagOverrides : []) t[o.magId] = String(o.rounds);
    return t;
  });
  const [tags, setTags] = useState<Record<string, string>>(() => {
    const t: Record<string, string> = {};
    for (const c of Array.isArray(initialMagConditions) ? initialMagConditions : []) t[c.magId] = c.tag;
    return t;
  });

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [mags, allMatches] = await Promise.all([getAll<Magazine>('magazines'), getAll<Match>('matches')]);
      if (!alive) return;
      setMagazines(mags);
      setMatches(allMatches);
    })();
    return () => { alive = false; };
  }, []);

  // Mags offered for this gun: its linked, in-service mags, plus any already
  // picked even if since retired (same pickableGuns-style precedent SessionForm
  // uses). Ghosts — picked mags no longer linked/active — stay visible as
  // removable rows rather than vanishing (an invisible pick would still
  // re-save and still soak up a share of the split).
  const gunMags = useMemo(
    () => magazines
      .filter((m) => m.firearmIds.includes(firearmId) && (m.active || picked.includes(m.id)))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
    [magazines, firearmId, picked]
  );
  const ghostIds = useMemo(
    () => picked.filter((id) => !gunMags.some((m) => m.id === id)),
    [picked, gunMags]
  );

  // The mags this gun ran last time, offered as a one-tap suggestion — never
  // applied without the shooter's tap. Looked up from past matches on this
  // same gun (most-recent first), the match-side counterpart to SessionForm's
  // lastMags. Empty once anything is picked, or when `sticky` is false.
  const lastMags = useMemo(() => {
    if (!sticky || picked.length > 0 || !firearmId) return [];
    // Array.isArray here too -- this reads LIVE match records, and one prior
    // match with a corrupt (bare-string) magIds would otherwise crash every
    // NEW match for that gun at mount (verify-loop finding, 17 Aug 2026).
    const sorted = matches
      .filter((m) => m.firearmId === firearmId && !m.deletedAt && Array.isArray(m.magIds) && m.magIds.length > 0)
      .sort((a, b) => b.date.localeCompare(a.date));
    const found = sorted[0]?.magIds ?? [];
    return found.filter((id) => magazines.some((m) => m.id === id && m.firearmIds.includes(firearmId) && m.active));
  }, [sticky, picked.length, matches, magazines, firearmId]);

  // Only ever written once a total exists to divide (spec: overrides can
  // never exist while totalRounds is null — there is nothing to sum to).
  function computeOverrides(ids: string[], text: Record<string, string>): { magId: string; rounds: number }[] {
    if (totalRounds == null || ids.length === 0 || Object.keys(text).length === 0) return [];
    const even = splitRounds(totalRounds, ids.length);
    const counts = ids.map((magId, i) => ({ magId, rounds: Number(text[magId] ?? even[i]) || 0 }));
    // Stored ONLY when they differ from the even split (spec §4) — an
    // untouched or reset-to-even split is not an override.
    if (counts.every((c, i) => c.rounds === even[i])) return [];
    return counts;
  }

  function computeConditions(ids: string[], t: Record<string, string>): { magId: string; tag: string }[] {
    return ids.filter((id) => t[id]).map((magId) => ({ magId, tag: t[magId] }));
  }

  function emit(ids: string[], text: Record<string, string>, tagMap: Record<string, string>) {
    onChange({ magIds: ids, magOverrides: computeOverrides(ids, text), magConditions: computeConditions(ids, tagMap) });
  }

  function toggleMag(magId: string) {
    const next = picked.includes(magId) ? picked.filter((x) => x !== magId) : [...picked, magId];
    setPicked(next);
    // Changing WHICH mags are picked invalidates any custom split — old
    // numbers can't line up with a different set (mirrors SessionForm's
    // toggleMag exactly).
    setOverrideText({});
    // A condition tag describes a mag that ran this match; drop it the
    // moment the mag is unpicked rather than leave an orphaned tag behind.
    const nextTags = { ...tags };
    if (!next.includes(magId)) delete nextTags[magId];
    setTags(nextTags);
    emit(next, {}, nextTags);
  }

  function editMagCount(magId: string, val: string) {
    if (totalRounds == null) return; // no split to override while pending
    const even = splitRounds(totalRounds, picked.length);
    // Seed every currently-picked mag with its even-split value first, so a
    // single edited box still leaves a meaningful sum to check against —
    // exactly SessionForm's `p[fid] ?? evenSplitFor(fid)` seeding.
    const seeded: Record<string, string> = { ...overrideText };
    picked.forEach((id, i) => { if (seeded[id] === undefined) seeded[id] = String(even[i]); });
    seeded[magId] = val;
    setOverrideText(seeded);
    emit(picked, seeded, tags);
  }

  function resetSplit() {
    setOverrideText({});
    emit(picked, {}, tags);
  }

  function applySuggestion() {
    if (!lastMags.length) return;
    setPicked(lastMags);
    setOverrideText({});
    emit(lastMags, {}, tags);
  }

  function setTag(magId: string, tag: string) {
    const next = { ...tags };
    if (tag) next[magId] = tag; else delete next[magId];
    setTags(next);
    emit(picked, overrideText, next);
  }

  const evenSplit = useMemo((): Record<string, string> => {
    if (totalRounds == null) return {};
    const parts = splitRounds(totalRounds, picked.length);
    return Object.fromEntries(picked.map((id, i) => [id, String(parts[i])]));
  }, [totalRounds, picked]);
  const magCount = (magId: string): string => overrideText[magId] ?? evenSplit[magId] ?? '0';

  const customSplit = Object.keys(overrideText).length > 0;
  const sum = picked.reduce((t, id) => t + (Number(overrideText[id] ?? '0') || 0), 0);
  const mismatch = customSplit && totalRounds != null && sum !== totalRounds;

  // Nothing to pick: hide the whole row rather than an empty disclosure —
  // mirrors SessionForm, which only renders the Magazines section at all
  // when the gun has mags to offer.
  if (gunMags.length === 0 && ghostIds.length === 0) return null;

  return (
    <div className="session-mags">
      <button className="checklist-disclosure" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="checklist-disclosure-title">
          Mags{picked.length > 0 && !open
            ? ` — ${picked.map((id) => magazines.find((m) => m.id === id)?.label ?? '—').join(', ')}`
            : ''}
        </span>
        <span className="checklist-disclosure-toggle">{open ? 'Hide' : 'Show'} <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} style={{ verticalAlign: 'middle' }} /></span>
      </button>
      {open && (
        <>
          {/* Decision 5, verbatim, both forms. */}
          <p className="report-note">Updates round counts for maintenance tracking.</p>
          {/* State notes sit at the TOP of the section, not under the mag
              list — with a long mag list they were rendering off-screen and
              a shooter never saw the mismatch warning (Michael's tap test,
              17 Aug 2026). */}
          {picked.length > 0 && totalRounds == null && (
            // Never a silent zero (spec decision 2a): a plain, visible
            // "pending" state — no split arithmetic renders until a total
            // exists to divide.
            <p className="report-note">Pending a round count — the split happens once you enter (or import) the total.</p>
          )}
          {picked.length > 0 && totalRounds != null && mismatch && (
            <>
              <p className="report-note warn">
                These mag rounds total {sum.toLocaleString()}, but the match logged{' '}
                {totalRounds.toLocaleString()} — match them to save.
              </p>
              <button className="button secondary" onClick={resetSplit}>Reset to even split</button>
            </>
          )}
          {lastMags.length > 0 && (
            <div className="mag-suggest-wrap">
              <button className="mag-suggest" aria-describedby={suggestListId} onClick={applySuggestion}>
                Same mags as last time
              </button>
              <p className="mag-suggest-list" id={suggestListId}>
                {lastMags.map((id) => magazines.find((m) => m.id === id)?.label ?? '—').join(', ')}
              </p>
            </div>
          )}
          {gunMags.map((m) => {
            const on = picked.includes(m.id);
            return (
              <Fragment key={m.id}>
                <div className="row">
                  <button className={`gun-toggle ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggleMag(m.id)}>
                    {m.label}{m.active ? '' : ' (retired)'}
                  </button>
                  {on && totalRounds != null && (
                    <input className="rounds-input" type="number" inputMode="numeric" min="0"
                      aria-label={`Rounds through ${m.label}`}
                      value={magCount(m.id)}
                      onChange={(e) => editMagCount(m.id, e.target.value)} />
                  )}
                </div>
                {on && (
                  <label className="field small">Condition
                    {/* Named per mag -- two bare "Condition" selects would be
                        indistinguishable to a screen reader (and to a test)
                        the moment two mags are picked; same pattern as the
                        "Rounds through X" input above. */}
                    <select aria-label={`Condition for ${m.label}`} value={tags[m.id] ?? ''} onChange={(e) => setTag(m.id, e.target.value)}>
                      {CONDITION_TAGS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </label>
                )}
              </Fragment>
            );
          })}
          {ghostIds.map((id) => {
            const m = magazines.find((x) => x.id === id);
            const label = m ? `${m.label} (no longer linked)` : 'Deleted magazine';
            return (
              <Fragment key={id}>
                <div className="row">
                  <button className="gun-toggle on" aria-pressed={true} onClick={() => toggleMag(id)}>
                    {label}
                  </button>
                  {totalRounds != null && (
                    <input className="rounds-input" type="number" inputMode="numeric" min="0"
                      aria-label={`Rounds through ${m?.label ?? 'a deleted magazine'}`}
                      value={magCount(id)}
                      onChange={(e) => editMagCount(id, e.target.value)} />
                  )}
                </div>
                <label className="field small">Condition
                  <select aria-label={`Condition for ${m?.label ?? 'a deleted magazine'}`} value={tags[id] ?? ''} onChange={(e) => setTag(id, e.target.value)}>
                    {CONDITION_TAGS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </label>
              </Fragment>
            );
          })}
          {picked.length > 0 && totalRounds != null && !mismatch && (customSplit ? (
            <p className="report-note">Custom split — each mag&rsquo;s lifetime count uses these numbers.</p>
          ) : (
            <p className="report-note">Rounds split evenly across the mags you pick — tap a number to adjust.</p>
          ))}
        </>
      )}
    </div>
  );
}
