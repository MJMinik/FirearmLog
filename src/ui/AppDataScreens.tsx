// App & Data section screens (July 2026). Sync & Backup, Import, and Free Up
// Space each get their own screen so the "App & Data" menu group reads as clean
// chevron rows (the iOS Settings pattern) instead of a stack of unlike cards.
// These are thin shells around the existing SyncCard / ImportFlow / PhotoCleanup
// components — no behavior change, only where they live.
import type { ReactNode } from 'react';
import { SyncCard } from './SyncCard.tsx';
import { PhotoCleanupCard } from './PhotoCleanupCard.tsx';
import { ImportFlow } from './ImportFlow.tsx';

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

export function ImportScreen({ onBack, onImported }: { onBack: () => void; onImported: () => void }) {
  return (
    <ScreenShell title="Import" onBack={onBack}>
      <div className="card">
        <h2>Pistol Tracker import</h2>
        <p className="report-note" style={{ marginBottom: 12 }}>
          Import your Pistol Tracker backup here. Running it again simply re-applies the same
          records — it won't double anything up.
        </p>
        <ImportFlow onImported={onImported} />
      </div>
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
