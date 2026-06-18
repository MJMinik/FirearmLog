// Plain-language "add FirearmLog to your home screen / Dock" guidance.
// Detects the visitor's device and shows those steps first; the rest sit
// behind "On a different device?" so a wrong guess is never a dead end. If the
// app is already running installed (standalone), it just says so.
import { useState } from 'react';
import { detectInstallTarget } from '../lib/platform.ts';
import type { InstallTarget } from '../lib/platform.ts';

const SECTIONS: { key: InstallTarget; title: string; steps: string[] }[] = [
  {
    key: 'ios', title: 'iPhone / iPad (Safari)', steps: [
      'Tap the Share button — the square with an up-arrow.',
      'Scroll down and tap "Add to Home Screen."',
      'Tap "Add." It’s now an icon on your home screen.'
    ]
  },
  {
    key: 'android', title: 'Android (Chrome)', steps: [
      'Tap the three-dot menu at the top right.',
      'Tap "Add to Home screen" (or "Install app").',
      'Tap "Add."'
    ]
  },
  {
    key: 'mac-safari', title: 'Mac (Safari)', steps: [
      'With FirearmLog open, click the Share button in the toolbar — or the File menu.',
      'Choose "Add to Dock."',
      'Keep the name and click "Add." It now lives in your Dock.'
    ]
  },
  {
    key: 'desktop', title: 'Windows or Mac (Chrome / Edge)', steps: [
      'Look at the right end of the address bar for the install icon — a little screen with a down-arrow.',
      'Click it (or the menu, then "Install FirearmLog").',
      'Click "Install." It opens in its own window.'
    ]
  }
];

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mql = window.matchMedia?.('(display-mode: standalone)');
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return !!(mql?.matches || iosStandalone);
}

function InstallSteps({ section }: { section: typeof SECTIONS[number] }) {
  return (
    <div style={{ marginTop: 12 }}>
      <h3 className="checklist-section-title">{section.title}</h3>
      <ol className="sync-steps">
        {section.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
    </div>
  );
}

export function InstallCard() {
  const [showAll, setShowAll] = useState(false);

  if (isStandalone()) {
    return (
      <div className="card">
        <h2>You’re all set</h2>
        <p className="report-note">
          FirearmLog is added to this device and running as an app — its own icon, and your log lives right here.
        </p>
      </div>
    );
  }

  const target = detectInstallTarget({
    ua: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints
  });
  const primary = SECTIONS.find((s) => s.key === target) ?? SECTIONS[0];
  const others = SECTIONS.filter((s) => s.key !== primary.key);

  return (
    <div className="card">
      <h2>Add FirearmLog to your home screen</h2>
      <p className="report-note">
        FirearmLog runs in your browser, but you can add it to your home screen or Dock so it opens
        like a normal app — its own icon, full screen, and <strong>it still works at the range with no signal.</strong>
      </p>
      <InstallSteps section={primary} />
      {!showAll
        ? <button className="button secondary" style={{ marginTop: 12 }} onClick={() => setShowAll(true)}>On a different device?</button>
        : others.map((s) => <InstallSteps key={s.key} section={s} />)}
    </div>
  );
}
