// The screens you can push on top of a tab (detail and form views).
export type View =
  | { kind: 'guns' }
  | { kind: 'gun-detail'; id: string }
  | { kind: 'gun-form'; id?: string }
  | { kind: 'session-form'; id?: string; planned?: boolean; convert?: boolean; date?: string }
  | { kind: 'drills' }
  | { kind: 'drill-form'; id?: string }
  | { kind: 'magazines' }
  | { kind: 'magazine-form'; id?: string }
  | { kind: 'references' }
  | { kind: 'reference-detail'; id: string }
  | { kind: 'maintenance' }
  | { kind: 'maint-form'; gunId: string; id?: string }
  | { kind: 'reminders' }
  | { kind: 'reminder-form'; id?: string; templateKey?: string; firearmId?: string }
  | { kind: 'malfunctions' }
  | { kind: 'reference-form'; id?: string; copyFrom?: string }
  | { kind: 'match-detail'; id: string }
  | { kind: 'match-form'; id?: string }
  | { kind: 'classifier-form'; id?: string }
  | { kind: 'ammo' }
  | { kind: 'ammo-form'; id?: string }
  | { kind: 'costs' }
  | { kind: 'purchase-form'; id?: string }
  | { kind: 'optics' }
  | { kind: 'optic-form'; id?: string; firearmId?: string }
  | { kind: 'parts' }
  | { kind: 'part-form'; id?: string }
  | { kind: 'reports'; blocked?: boolean }
  | { kind: 'practiscore-import' }
  | { kind: 'uspsa-import' }
  | { kind: 'help'; tour?: 'quick' | 'full' }
  | { kind: 'numbers'; section?: string }
  | { kind: 'setup' }
  | { kind: 'settings' }
  | { kind: 'sync' }
  | { kind: 'free-space' }
  | { kind: 'your-data' }
  | { kind: 'drill-history'; name: string };
