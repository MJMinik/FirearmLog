// Reports hub (spec §13). Generates each report as a printable page (Save as
// PDF from the print dialog). The report builders live in reportLaunch.ts so
// the desktop menu bar's Reports menu and this screen share one code path
// (menu-bar work, July 2026); this screen keeps the browsing UI: descriptions,
// the how-to note, and the pop-up-blocked message.
import { useEffect, useState } from 'react';
import {
  REPORTS, loadReportBundle, openReportWindow, presentReport, reportFailed,
  type ReportBundle
} from './reportLaunch.ts';
import { InfoTip } from './InfoTip.tsx';
import { FormProblem } from './FormProblem.tsx';
import { ScreenError, ScreenLoading } from './ScreenState.tsx';

const BLOCKED_MSG = 'Pop-ups blocked — please allow pop-ups and try again.';

export function ReportsScreen({ refreshKey, onBack, popupBlocked }: {
  refreshKey: number; onBack: () => void;
  /** True when the menu bar's report launch was popup-blocked and sent the
   *  user here — the message shows immediately instead of after a second try. */
  popupBlocked?: boolean;
}) {
  const [data, setData] = useState<ReportBundle | null>(null);
  const [problem, setProblem] = useState(popupBlocked ? BLOCKED_MSG : '');
  // The prop can also flip while this screen is already mounted (a blocked
  // menu-bar launch taken from the Reports screen itself reconciles in place —
  // the same-kind replace path), so it's watched, not just read at mount.
  useEffect(() => { if (popupBlocked) setProblem(BLOCKED_MSG); }, [popupBlocked]);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(false);
    void loadReportBundle()
      .then((d) => { if (alive) setData(d); })
      .catch((e) => {
        console.error('Reports load failed', e);
        if (alive) setError(true);
      });
    return () => { alive = false; };
  }, [refreshKey, nonce]);

  if (error) return <ScreenError onRetry={() => setNonce((n) => n + 1)} />;
  if (!data) return <ScreenLoading />;
  const d = data;

  // Window-first, always (the pattern the photo-heavy insurance report already
  // needed): open the tab inside the tap so a blocker can't kill it, then write
  // the finished page. With the bundle already loaded this is near-instant.
  function run(build: (d: ReportBundle) => ReturnType<(typeof REPORTS)[number]['build']>) {
    const win = openReportWindow();
    if (!win) { setProblem(BLOCKED_MSG); return; }
    Promise.resolve(build(d))
      .then((r) => presentReport(win, r))
      .catch(() => reportFailed(win));
  }

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn section-back" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Reports <InfoTip title="Reports">Printable summaries — round count, costs, season, malfunctions, maintenance, insurance. Save as PDF.</InfoTip></h1>
      <FormProblem problem={problem} />
      <p className="report-note">Each opens a printable page — use your browser's "Save as PDF" to keep a copy.</p>
      <div className="card">
        {REPORTS.map((r) => (
          <button className="row-tap" key={r.label} onClick={() => run(r.build)}>
            <span className="label">{r.label}<div className="row-sub">{r.desc}</div></span>
            <span className="value">›</span>
          </button>
        ))}
      </div>
      <p className="report-note">A single-session report is on each session — open a session and tap "Session Report".</p>
    </div>
  );
}
