// The one fixed condition-tag list, shared by every mag picker (session-mags
// spec, 11 Sep 2026, "SESSION_MAG_CONDITIONS_SPEC_2026-09-11", §2). Moved out
// of MatchMagPicker.tsx verbatim -- values and labels unchanged -- so a
// session's per-gun mag rows and a match's mag rows draw from the exact same
// list, and the categories stay comparable across both.
//
// The minimal v1 condition tag (decision 4a, match-mags spec): one optional
// tag per picked mag, independent of round count. NOT a structured incident
// form -- one tag, plus the record's own free-text notes field for anything
// more. Expanded 21 Aug 2026 (board-adopted): Water, Snow, and Dust added
// alongside the original five. The curated list stays fixed -- the board
// rejected a user-editable list so condition categories stay comparable
// across mags/matches/sessions; anything a tag can't capture belongs in the
// record's own notes field.
export const CONDITION_TAGS: { value: string; label: string }[] = [
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
