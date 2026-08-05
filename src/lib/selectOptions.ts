// Options for a <select> whose starting value comes from OUTSIDE our own list.
// Pure, no React, no DOM — its own file rather than the screen's, because the
// unit runner cannot load JSX and a rule this load-bearing has to be testable
// directly rather than only through a browser.

/**
 * The options for a select whose starting value comes from OUTSIDE our own list.
 *
 * PractiScore writes divisions and power factors in its own shorthand — "O",
 * "Min" — which are not our nine divisions or our two power factors. So the
 * value the screen starts on is frequently not in the list, and the list has to
 * carry it as an extra option or the browser shows one thing while the form
 * holds another.
 *
 * The rule this enforces, and it is the whole point: THE CURRENT VALUE ALWAYS
 * HAS AN OPTION. Not "the as-scored value has an option while it happens to be
 * selected" — always. The earlier version drew the extra option only while it
 * was the current value, so the moment the shooter picked anything else the
 * option was removed from the DOM and there was no way back to what PractiScore
 * had actually recorded. Michael hit that on 5 August 2026 on his own match:
 * "There was no way to change it back to -0-". Reverting was not merely awkward,
 * it was unreachable, and since the division placing is kept only while the
 * division still matches what the results said, one stray tap blanked a real
 * placing permanently with starting over as the only repair.
 *
 * A blank as-scored value gets an option too, for the same reason: a results
 * page can leave the Div or PF cell empty, and without an option for '' the
 * select displays the first item in the list while the form saves an empty
 * string — a screen disagreeing with what it is about to write.
 *
 * Exported so it can be tested directly. The defect it fixes was invisible to a
 * test that changed the value away and never tried to change it back, which is
 * exactly the test that existed.
 */
export function fieldOptions(
  list: readonly string[],
  asScored: string,
  current: string
): { value: string; label: string }[] {
  const seen = new Set(list);
  const extras: { value: string; label: string }[] = [];
  const add = (value: string, label: string) => {
    if (seen.has(value)) return;
    seen.add(value);
    extras.push({ value, label });
  };
  // What the results recorded, so it is always reachable again. Only when it is
  // something: a blank cell is not a value anyone returns TO, and offering one
  // is how a select acquires an option that was never its state. That is what
  // the first version of this did to power factor, where the screen seeds
  // 'Minor' for a blank cell — it gained a selectable "Not recorded" that saved
  // an empty string the rest of the app cannot hold.
  if (asScored !== '') add(asScored, `${asScored} (as scored)`);
  // Whatever is selected right now, always. This is the guarantee that actually
  // matters — a select whose value has no option displays a different value
  // from the one the form will save. A blank reaches here only when blank IS
  // the state, which is exactly when the screen should say so out loud.
  add(current, current === '' ? 'Not recorded' : current);
  return [...extras, ...list.map((v) => ({ value: v, label: v }))];
}
