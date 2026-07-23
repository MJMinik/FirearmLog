// The Session Report opener, shared by the Session form's "Session Report"
// button and the Progress training grid's day squares (Michael, July 8 2026:
// tapping a day opens the finished report — drills, notes, target photos —
// not the edit screen).
//
// The window must open synchronously inside the user's tap (iOS blocks popups
// opened after an await), so this opens it first with a holding note, then
// loads the SAVED session data and writes the page. Building from saved data
// only means both entry points always show the same report.
//
// Lives in the UI layer because reportImages (canvas downscaling) is
// browser-only; the pure HTML builder stays in src/lib/reports.ts.
import type { Firearm, MalfunctionEntry, Session, SkillSet } from '../lib/types.ts';
import { getAll, getMediaForOwner } from '../lib/db.ts';
import { formatDayKey } from '../lib/dates.ts';
import { buildReportHtml, type ReportSection } from '../lib/reports.ts';
import { reportImageUrls } from './reportImages.ts';
import { skillLabel } from '../lib/skillSets.ts';

/** Plain labels for a session's kind — single source for report + form. */
export const SESSION_KIND_LABEL: Record<string, string> = {
  practice: 'Live practice',
  dry_fire: 'Dry fire',
  class: 'Class',
};

/**
 * Open the printable Session Report for a saved session.
 *
 * Call it directly from a tap handler so the popup opens inside the gesture.
 * Returns a plain-English problem to show the user (pop-ups blocked), or null
 * when the report window is on its way. A failure while building the report is
 * reported inside the report window itself, so the app screen stays clean.
 */
export async function openSessionReport(
  session: Session,
  opts: { autoPrint?: boolean } = {}
): Promise<string | null> {
  const win = window.open('', '_blank');
  if (!win) return 'Pop-ups blocked — please allow pop-ups and try again.';
  win.document.write(
    '<!doctype html><meta charset="utf-8"><body style="font:15px -apple-system,Arial,sans-serif;padding:40px;color:#555">Preparing report…</body>'
  );
  try {
    const [firearms, allMalf, allSkillSets, sessionMedia] = await Promise.all([
      getAll<Firearm>('firearms'),
      getAll<MalfunctionEntry>('malfunctions'),
      getAll<SkillSet>('skillSets'),
      // S-5: only THIS session's media — not the whole photo/video library.
      getMediaForOwner('session', session.id),
    ]);
    const reps = session.type === 'dry_fire';
    const gunRows = session.guns.map((g) => ({
      label: firearms.find((f) => f.id === g.firearmId)?.name ?? '—',
      value: `${g.rounds} ${reps ? 'reps' : 'rds'}`,
    }));
    const drillRows = session.drills.map((dr) => [
      dr.name,
      dr.distance || '—',
      dr.time != null ? `${dr.time}s` : '—',
      dr.score != null ? `${dr.score}${dr.maxScore != null ? '/' + dr.maxScore : ''}` : '—',
    ]);
    const malfRows = allMalf
      .filter((m) => m.sessionId === session.id)
      .map((m) => [
        m.type || '—',
        firearms.find((f) => f.id === m.firearmId)?.name ?? '—',
        m.roundCount != null ? String(m.roundCount) : '—',
        m.resolution || '',
        m.notes || '',
      ]);
    // T3-1: the day's timed-skill sets, in the order they were logged.
    const skillRows = allSkillSets
      .filter((s) => s.sessionId === session.id)
      .map((s) => [
        skillLabel(s.skill),
        firearms.find((f) => f.id === s.firearmId)?.name ?? '—',
        String(s.count),
        `${s.bestSec.toFixed(2)}s`,
        s.typicalSec != null ? `${s.typicalSec.toFixed(2)}s` : '—',
        s.cold ? 'Cold' : '',
        s.notes || '',
      ]);
    const photos = await reportImageUrls(sessionMedia, 'session', session.id);
    const sections: ReportSection[] = [
      { heading: 'Session', rows: [
        { label: 'Date', value: formatDayKey(session.date) },
        { label: 'Kind', value: SESSION_KIND_LABEL[session.type] ?? session.type },
        ...(session.location ? [{ label: 'Where', value: session.location }] : []),
        ...(session.instructor ? [{ label: 'Instructor', value: session.instructor }] : []),
        ...(session.rangeFee != null ? [{ label: 'Range fee', value: '$' + session.rangeFee.toFixed(2) }] : []),
      ] },
      { heading: 'Guns', rows: gunRows },
      ...(drillRows.length ? [{ heading: 'Drills', table: { headers: ['Drill', 'Distance', 'Time', 'Score'], rows: drillRows } }] : []),
      ...(skillRows.length ? [{ heading: 'Timed Skills', table: { headers: ['Skill', 'Gun', 'Reps', 'Best', 'Typical', 'Cold', 'Notes'], rows: skillRows } }] : []),
      ...(malfRows.length ? [{ heading: 'Malfunctions', table: { headers: ['Type', 'Gun', 'Round', 'Cleared', 'Notes'], rows: malfRows } }] : []),
      ...(session.notes ? [{ heading: 'Notes', rows: [{ label: '', value: session.notes }] }] : []),
      ...(photos.length ? [{ heading: 'Photos', images: photos }] : []),
    ];
    win.document.open();
    win.document.write(buildReportHtml(`Session — ${formatDayKey(session.date)}`, session.location || '', sections));
    win.document.close();
    win.focus();
    if (opts.autoPrint) setTimeout(() => win.print(), 400);
    return null;
  } catch {
    try {
      win.document.body.textContent = 'Sorry — could not build this report. Please try again.';
    } catch { /* window already closed */ }
    return null;
  }
}
