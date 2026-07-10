// App & Data section screens (July 2026). Sync & Backup and Free Up Space each
// get their own screen so the "App & Data" menu group reads as clean chevron
// rows (the iOS Settings pattern) instead of a stack of unlike cards. These are
// thin shells around the existing SyncCard / PhotoCleanup components — no
// behavior change, only where they live. (F11, session 55: the orphaned
// ImportScreen was removed — the migration importer library in lib/import/
// stays forever, per rules 5/46, but it has no user-facing surface.)
import type { ReactNode } from 'react';
import { SyncCard } from './SyncCard.tsx';
import { PhotoCleanupCard } from './PhotoCleanupCard.tsx';

function ScreenShell({ title, onBack, children }: {
  title: string; onBack: () => void; children: ReactNode;
}) {
  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">{title}</h1>
      {children}
    </div>
  );
}

export function SyncScreen({ onBack, onImported }: { onBack: () => void; onImported: () => void }) {
  return (
    <ScreenShell title="Sync & Backup" onBack={onBack}>
      <SyncCard onPulled={onImported} onBackedUp={onImported} />
    </ScreenShell>
  );
}

export function FreeSpaceScreen({ onBack }: { onBack: () => void }) {
  return (
    <ScreenShell title="Free Up Space" onBack={onBack}>
      <PhotoCleanupCard standalone />
    </ScreenShell>
  );
}
