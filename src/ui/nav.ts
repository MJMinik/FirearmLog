// The screens you can push on top of a tab (detail and form views).
export type View =
  | { kind: 'gun-detail'; id: string }
  | { kind: 'gun-form'; id?: string }
  | { kind: 'session-detail'; id: string }
  | { kind: 'session-form'; id?: string; planned?: boolean; convert?: boolean }
  | { kind: 'drills' }
  | { kind: 'drill-form'; id?: string }
  | { kind: 'magazines' }
  | { kind: 'magazine-form'; id?: string }
  | { kind: 'references' }
  | { kind: 'reference-detail'; id: string }
  | { kind: 'maintenance' }
  | { kind: 'maint-form'; gunId: string }
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
  | { kind: 'part-form'; id?: string };
