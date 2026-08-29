// Reminders: the full list (More → Reminders) and the add/edit form. The list is
// grouped by URGENCY — Overdue / Coming up / Later — not by gun, because a shooter
// asks "what's due?" (spec §6b LOCKED). Templates are an on-demand library; the
// empty state does the discovery. Date reminders can be exported to the calendar.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScreenLoading, ScreenError } from './ScreenState.tsx';
import type { Firearm, Match, Optic, Reminder, Session } from '../lib/types.ts';
import { deleteOne, getAll, getOne, putOne } from '../lib/db.ts';
import { activeOnly } from '../lib/softDelete.ts';
import { todayKey } from '../lib/dates.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { roundsForFirearm } from '../lib/stats.ts';
import { ownedGuns } from '../lib/gunStatus.ts';
import { reminderGovernsOptic } from '../lib/opticBattery.ts';
import { hasBatteryLogEntry, safeBatteryLog } from '../lib/optics.ts';
import { shouldStampNewOpticLink } from './reminderOpticLink.ts';
import {
  buildReminderContext, comingUpReminders, completionPatch, dueReminders,
  inactiveNote, inactiveReminders, laterReminders, reminderViews,
} from '../lib/reminders.ts';
import type { ReminderView } from '../lib/reminders.ts';
import { REMINDER_TEMPLATES, getReminderTemplate } from '../lib/reminderTemplates.ts';
import { buildReminderIcs, icsFileName } from '../lib/ics.ts';
import { deliverFile } from './deliverFile.ts';
import { InfoTip } from './InfoTip.tsx';
import { FormProblem } from './FormProblem.tsx';
import { ConfirmSheet, Sheet } from './Sheet.tsx';
import { Icon } from './Icon.tsx';
import type { View } from './nav.ts';

/** The stored shape minus the stamps stampNew/stampUpdate add. */
type ReminderFields = Omit<Reminder, 'id' | 'createdAt' | 'updatedAt'>;

/** The badge for a reminder's urgency (mirrors the maintenance alert badges). */
function levelBadge(v: ReminderView): { cls: string; text: string } {
  if (v.level === 'due') return { cls: 'bad', text: 'Due' };
  if (v.level === 'soon') return { cls: 'warn-badge', text: 'Soon' };
  return { cls: 'info', text: 'Later' };
}

function ReminderRow({ v, onTap }: { v: ReminderView; onTap: () => void }) {
  const r = v.reminder;
  const badge = levelBadge(v);
  const title = v.gunName ? `${v.gunName}: ${r.title}` : r.title;
  return (
    <button className="row-tap" onClick={onTap}>
      <span className="label">
        {title}
        <div className="row-sub">{v.detail}</div>
      </span>
      <span className={`badge ${badge.cls}`}>{badge.text}</span>
    </button>
  );
}

export function RemindersScreen({ refreshKey, onBack, open }: {
  refreshKey: number; onBack: () => void; open: (v: View) => void;
}) {
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [picking, setPicking] = useState(false);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    let alive = true;
    setError(false);
    void Promise.all([
      getAll<Firearm>('firearms'), getAll<Session>('sessions'),
      getAll<Match>('matches'), getAll<Reminder>('reminders'),
    ]).then(([f, s, m, r]) => {
      if (!alive) return;
      setFirearms(f);
      setSessions(activeOnly(s)); // trashed sessions don't count toward round totals
      setMatches(m);
      setReminders(r);
      setLoaded(true);
    }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [refreshKey, reloadNonce]);

  if (error) return <ScreenError onRetry={() => setReloadNonce((n) => n + 1)} />;
  if (!loaded) return <ScreenLoading />;

  const ctx = buildReminderContext(firearms, sessions, matches, todayKey());
  const views = reminderViews(reminders, ctx);
  const due = dueReminders(views);
  const soon = comingUpReminders(views);
  const later = laterReminders(views);
  // Level-based on purpose: Done also catches a reminder that can't be measured
  // any more (e.g. its gun was deleted before the cascade existed, or arrived in
  // a restored backup) — every stored reminder ALWAYS has a reachable row.
  const done = inactiveReminders(views);
  const activeCount = due.length + soon.length + later.length;

  const openForm = (id?: string) => open({ kind: 'reminder-form', id });

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn section-back" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Reminders <InfoTip title="Reminders">Nudges for the things that run on a schedule — a red-dot battery, a recoil spring by round count, a membership renewal. You'll see them here and on Home when they're coming up; there's no push notification, but you can add a date reminder to your calendar. Start from a template or add your own.</InfoTip></h1>

      {reminders.length === 0 ? (
        <>
          <p className="empty">No reminders yet. Start from a template — a battery, a spring, a renewal — or add your own.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="button" onClick={() => setPicking(true)}>Browse templates</button>
            <button className="button secondary" onClick={() => openForm()}>+ Add your own</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button" style={{ flex: 1 }} onClick={() => openForm()}>+ Add reminder</button>
            <button className="button secondary" style={{ flex: 1 }} onClick={() => setPicking(true)}>From a template</button>
          </div>

          {activeCount === 0 && done.length > 0 && (
            <p className="report-note">Nothing coming due right now. Your finished reminders are in Done below.</p>
          )}

          {due.length > 0 && (
            <div className="card">
              <h2>Overdue</h2>
              {due.map((v) => <ReminderRow key={v.reminder.id} v={v} onTap={() => openForm(v.reminder.id)} />)}
            </div>
          )}
          {soon.length > 0 && (
            <div className="card">
              <h2>Coming up</h2>
              {soon.map((v) => <ReminderRow key={v.reminder.id} v={v} onTap={() => openForm(v.reminder.id)} />)}
            </div>
          )}
          {later.length > 0 && (
            <div className="card">
              <h2>Later</h2>
              {later.map((v) => <ReminderRow key={v.reminder.id} v={v} onTap={() => openForm(v.reminder.id)} />)}
            </div>
          )}

          {done.length > 0 && (
            <div className="card">
              <button className="row-tap" onClick={() => setShowDone((o) => !o)} aria-expanded={showDone}>
                <span className="label">
                  Done
                  <div className="row-sub">{done.length} not running right now</div>
                </span>
                <span className="value"><Icon name={showDone ? 'chevronDown' : 'chevronRight'} size={16} /></span>
              </button>
              {showDone && done.map((v) => {
                const r = v.reminder;
                const label = v.gunName ? `${v.gunName}: ${r.title}` : r.title;
                const gunResolved = r.firearmId ? v.gunName !== undefined : true;
                return (
                  <button className="row-tap" key={r.id} onClick={() => openForm(r.id)}>
                    <span className="label">
                      {label}
                      <div className="row-sub">{inactiveNote(r, gunResolved)}</div>
                    </span>
                    <span className="badge info">{r.enabled === false ? 'Off' : 'Note'}</span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {picking && (
        <Sheet title="Start from a template" onClose={() => setPicking(false)}>
          <p className="report-note" style={{ marginBottom: 12 }}>
            Each one is a starting point you can edit — the intervals are manufacturer
            or community figures, not rules. Nothing is saved until you tap Save.
          </p>
          {REMINDER_TEMPLATES.map((t) => (
            <button key={t.key} className="drill-pick-row"
              onClick={() => { setPicking(false); open({ kind: 'reminder-form', templateKey: t.key }); }}>
              <strong>{t.title}</strong>
              <span>{t.blurb}</span>
            </button>
          ))}
        </Sheet>
      )}
    </div>
  );
}

// ---- Add / edit a reminder ----

export function ReminderForm({ id, templateKey, firearmId: initialFirearmId, opticId: initialOpticId, onSaved, onCancel, onDirtyChange, onSaverChange }: {
  id?: string; templateKey?: string; firearmId?: string; opticId?: string;
  onSaved: () => void; onCancel: () => void; onDirtyChange?: (dirty: boolean) => void;
  // Save-from-discard: reports a persist function when the form is valid, null
  // when invalid or unmounted, so App's DiscardChangesSheet can show Save.
  onSaverChange?: (fn: (() => Promise<boolean>) | null) => void;
}) {
  const editing = id !== undefined;
  const tpl = getReminderTemplate(templateKey);

  const [original, setOriginal] = useState<Reminder | null>(null);
  const [recordReady, setRecordReady] = useState(!editing);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [optics, setOptics] = useState<Optic[]>([]);

  const [title, setTitle] = useState(tpl?.title ?? '');
  const [notes, setNotes] = useState(tpl?.notes ?? '');
  const [trigger, setTrigger] = useState<Reminder['trigger']>(tpl?.trigger ?? 'date');
  const [firearmId, setFirearmId] = useState(initialFirearmId ?? '');
  const [dueDate, setDueDate] = useState('');
  // A fresh custom reminder does NOT repeat unless the shooter says so — a
  // one-off must never silently become annual. Templates carry their own repeat.
  const [repeat, setRepeat] = useState<Reminder['repeat']>(tpl?.defaultRepeat ?? 'none');
  const [repeatMonths, setRepeatMonths] = useState(String(tpl?.defaultRepeatMonths ?? 3));
  const [everyRounds, setEveryRounds] = useState(tpl?.defaultEveryRounds ? String(tpl.defaultEveryRounds) : '');

  const [problem, setProblem] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [initialSig, setInitialSig] = useState<string | null>(null);

  // Load the gear needed for the gun picker and round-count baseline.
  useEffect(() => {
    let alive = true;
    void Promise.all([
      getAll<Firearm>('firearms'), getAll<Session>('sessions'), getAll<Match>('matches'), getAll<Optic>('optics'),
    ]).then(([f, s, m, o]) => {
      if (!alive) return;
      setFirearms(f); setSessions(activeOnly(s)); setMatches(m); setOptics(o);
    }).catch(() => { /* the picker just stays empty — never block the form */ });
    return () => { alive = false; };
  }, []);

  // Editing: load the record over the template/blank defaults.
  useEffect(() => {
    if (id === undefined) return;
    let alive = true;
    void getOne<Reminder>('reminders', id).then((r) => {
      if (!alive) return;
      if (r) {
        setOriginal(r);
        setTitle(r.title); setNotes(r.notes); setTrigger(r.trigger);
        setFirearmId(r.firearmId ?? '');
        setDueDate(r.dueDate ?? '');
        setRepeat(r.repeat ?? 'none');
        setRepeatMonths(String(r.repeatMonths ?? 3));
        setEveryRounds(r.everyRounds != null ? String(r.everyRounds) : '');
      }
      setRecordReady(true);
    }).catch(() => { if (alive) setRecordReady(true); });
    return () => { alive = false; };
  }, [id]);

  // Dirty tracking (F3 parity with the record forms): snapshot the fields once the
  // record is ready, then report any change so leaving prompts Discard-changes?.
  const sig = JSON.stringify({ title, notes, trigger, firearmId, dueDate, repeat, repeatMonths, everyRounds });
  useEffect(() => {
    if (recordReady && initialSig === null) setInitialSig(sig);
  }, [recordReady, sig, initialSig]);
  useEffect(() => {
    onDirtyChange?.(initialSig !== null && sig !== initialSig);
  }, [sig, initialSig, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  // saveProblem: mirrors save()'s validation without side-effects.
  function saveProblem(): string | null {
    if (!title.trim()) return 'Give the reminder a short title.';
    if (trigger === 'date') {
      if (!dueDate) return 'Pick a due date, or switch this to a round count.';
    } else {
      if (!firearmId) return 'Pick which gun this round-count reminder is for.';
      if (firearms.length > 0 && !firearms.some((g) => g.id === firearmId)) {
        return 'That gun is no longer in your log — pick one of your guns, or delete this reminder.';
      }
      const iv = Number(everyRounds);
      if (!Number.isFinite(iv) || iv <= 0) return 'Enter how many rounds between reminders — a number over 0.';
    }
    return null;
  }

  // Only report a saver when the form is dirty AND valid, so the discard sheet
  // only shows Save when it can actually work. ReminderForm uses a sig-based
  // dirty check: `initialSig !== null && sig !== initialSig`.
  const isDirty = initialSig !== null && sig !== initialSig;

  // Always-fresh saver: the ref holds the LATEST persistForm (re-pointed after
  // every render), and the reported wrapper is reference-stable so App's ref
  // write never churns. This replaces a hand-maintained dep list that could — and
  // did — go stale and save old values.
  const persistRef = useRef(persistForm);
  useEffect(() => { persistRef.current = persistForm; });
  const stablePersist = useCallback(() => persistRef.current(), []);

  // Report after every render (cheap: App just writes a ref) so the reported
  // validity can never lag the form state. Saver present ⟺ dirty AND valid.
  useEffect(() => {
    onSaverChange?.(isDirty && saveProblem() === null ? stablePersist : null);
  });
  useEffect(() => () => onSaverChange?.(null), [onSaverChange]);

  if (!recordReady) return <ScreenLoading />;

  const gunOptions = ownedGuns(firearms, original?.firearmId ? [original.firearmId] : []);
  const selectedRounds = firearmId ? roundsForFirearm(firearmId, firearms, sessions, matches) : null;

  /**
   * The optic this reminder is linked to right now, for display (spec §4
   * "Linked optic" row) — an explicit `opticId` (from the record, or from the
   * "Set a battery reminder" button on a brand-new one) OR a live legacy
   * match (opticId absent, same gun, that gun's only optic, battery-shaped).
   * `opticId === null` (deliberately unlinked) always shows nothing, and
   * never legacy-matches — same rule opticBatteryStatus uses. Recomputed
   * every render off `optics`/`original`, same style as gunOptions above.
   *
   * The `!editing` branch runs the SAME `shouldStampNewOpticLink` guard
   * persistForm now uses (finding 6, audit round 2) — without it, this
   * preview kept showing "Linked optic" even after the shooter changed the
   * gun away from the one the button was pressed for, promising a link that
   * the fixed persistForm would then correctly refuse to save. A preview
   * that disagrees with what save() actually does is its own kind of bug.
   */
  function resolveLinkedOptic(): Optic | null {
    if (!editing) {
      return shouldStampNewOpticLink(initialOpticId, initialFirearmId, firearmId, trigger)
        ? (optics.find((o) => o.id === initialOpticId) ?? null)
        : null;
    }
    if (!original) return null;
    if (original.opticId) return optics.find((o) => o.id === original.opticId) ?? null;
    if (original.opticId === null) return null; // deliberately unlinked
    const gunOptics = optics.filter((o) => o.firearmId === original.firearmId);
    return gunOptics.length === 1 && reminderGovernsOptic(original, gunOptics[0], 1) ? gunOptics[0] : null;
  }
  const linkedOptic = resolveLinkedOptic();

  async function persistForm(): Promise<boolean> {
    const p = saveProblem();
    if (p) { setProblem(p); return false; }
    const now = Date.now();
    // Creating the link (spec §4): a brand-new reminder made via the optic's
    // "Set a battery reminder" button stamps its opticId straight away.
    // Upgrading the link (spec §4 "Migration story"): an EXISTING reminder
    // that currently legacy-matches (opticId key absent — never present-null)
    // gets that match stamped as an explicit opticId the first time it's
    // saved through this form — but ONLY when the gun field wasn't changed in
    // this same edit, so a stale match is never stamped onto the wrong optic.
    const opticIdPatch: { opticId?: string } = {};
    if (!original) {
      // Finding 6 (audit round 2): this branch used to stamp initialOpticId
      // unconditionally — create the reminder via the optic's button, change
      // which gun it's for before saving, and the optic kept being governed
      // by a reminder now labelled for a DIFFERENT gun. Guarded the same way
      // the sibling branch below guards its own stamp.
      if (shouldStampNewOpticLink(initialOpticId, initialFirearmId, firearmId, trigger)) {
        opticIdPatch.opticId = initialOpticId!;
      }
    } else if (!('opticId' in original) && firearmId === (original.firearmId ?? '')) {
      const gunOptics = optics.filter((o) => o.firearmId === original.firearmId);
      if (gunOptics.length === 1 && reminderGovernsOptic(original, gunOptics[0], 1)) {
        opticIdPatch.opticId = gunOptics[0].id;
      }
    }
    const base = {
      title: title.trim(),
      notes: notes.trim(),
      source: original?.source ?? (templateKey ? ('template' as const) : ('custom' as const)),
      templateKey: original?.templateKey ?? templateKey ?? null,
      firearmId: firearmId || null,
      enabled: original ? original.enabled : true,
      lastDoneDate: original?.lastDoneDate ?? null,
      ...opticIdPatch,
    };
    let record: ReminderFields;
    if (trigger === 'date') {
      const months = repeat === 'months' ? Math.max(1, Math.round(Number(repeatMonths) || 1)) : null;
      record = {
        ...base, trigger: 'date',
        dueDate: dueDate!, repeat: repeat ?? 'none', repeatMonths: months,
        everyRounds: null, baselineRounds: null,
      };
    } else {
      // Keep the existing baseline when the gun and kind are unchanged; otherwise
      // anchor to the gun's rounds right now, so "every N rounds" runs from here.
      const iv = Number(everyRounds);
      const current = roundsForFirearm(firearmId, firearms, sessions, matches);
      const baseline = (original && original.trigger === 'rounds' && original.firearmId === firearmId && original.baselineRounds != null)
        ? original.baselineRounds
        : current;
      record = {
        ...base, trigger: 'rounds', firearmId,
        everyRounds: Math.round(iv), baselineRounds: baseline,
        dueDate: null, repeat: 'none', repeatMonths: null,
      };
    }
    onDirtyChange?.(false);
    if (original) await putOne('reminders', stampUpdate({ ...original, ...record }, now));
    else await putOne('reminders', stampNew(record, newId('rm'), now));
    return true;
  }

  async function save() { if (await persistForm()) onSaved(); }

  async function markDone() {
    if (!original) return;
    const ctx = buildReminderContext(firearms, sessions, matches, todayKey());
    const patch = completionPatch(original, ctx);
    const today = todayKey();
    const provenanceNote = 'Marked done from the reminder';
    // Decision 1-A: marking a GOVERNING reminder done also writes the fact
    // into the optic's battery log — dated today, with a note that says
    // exactly what happened so the log never claims a change the owner
    // didn't actually make. Write order (spec §4): the fact (the optic)
    // first, then the schedule (the reminder) — same order the Log Battery
    // Change sheet uses, for the same reason.
    //
    // Unlike that sheet's reminder write, THIS write is never swallowed:
    // if the log entry can't be saved, the reminder must not silently
    // advance on the strength of a fact that never actually landed. So on
    // failure this bails out BEFORE touching the reminder, using the same
    // visible error surface every other problem on this form uses (never a
    // silent failure, never a dead button, never an uncaught rejection) —
    // and the shooter can just tap Mark done again once whatever went wrong
    // is fixed.
    if (linkedOptic) {
      try {
        // Finding F-4 (audit round 3): re-read fresh, and skip the write
        // entirely if today's provenance entry is ALREADY there. A PRIOR tap
        // can have written the optic successfully and then failed on the
        // reminder write below (see the second try/catch) — the advice in
        // that failure message is "tap Mark done again", and without this
        // check that retry would append a SECOND, byte-identical entry for
        // the same day.
        const freshOptic = await getOne<Optic>('optics', linkedOptic.id);
        const base = freshOptic ?? linkedOptic;
        if (!hasBatteryLogEntry(base.batteryLog, today, provenanceNote)) {
          const entry = { date: today, notes: provenanceNote };
          await putOne('optics', stampUpdate({ ...base, batteryLog: [...safeBatteryLog(base.batteryLog), entry] }, Date.now()));
        }
      } catch (e) {
        setProblem(e instanceof Error
          ? `The battery log entry couldn't be saved, so this reminder wasn't marked done either: ${e.message}`
          : "The battery log entry couldn't be saved, so this reminder wasn't marked done either.");
        return;
      }
    }
    // Finding F-4 (audit round 3): this write was previously unwrapped — a
    // rejection here surfaced as a generic global error, left the log entry
    // written but the reminder NOT marked done (the write order above means
    // the fact always lands first), and gave no path back except retrying
    // the whole tap. Wrapped the same visible way as every other write on
    // this form, worded for the state it actually leaves.
    try {
      await putOne('reminders', stampUpdate({ ...original, ...patch }, Date.now()));
    } catch (e) {
      setProblem(e instanceof Error
        ? `The battery log entry was saved, but this reminder couldn't be marked done: ${e.message}. It's still due — tap Mark done again.`
        : "The battery log entry was saved, but this reminder couldn't be marked done. It's still due — tap Mark done again.");
      return;
    }
    onDirtyChange?.(false);
    onSaved();
  }

  async function turnBackOn() {
    if (!original) return;
    onDirtyChange?.(false);
    await putOne('reminders', stampUpdate({ ...original, enabled: true }, Date.now()));
    onSaved();
  }

  async function addToCalendar() {
    // Export what's ON SCREEN, not the last-saved record — editing the date and
    // then tapping Add to Calendar must never silently export the stale saved
    // date. This matches how the codebase treats the visible form as what the
    // shooter means (edits are guarded on exit, never silently substituted):
    // the shooter sees exactly the fields the event is built from.
    if (!original || trigger !== 'date' || !dueDate) return;
    try {
      const candidate: Reminder = {
        ...original,
        title: title.trim() || original.title,
        notes: notes.trim(),
        trigger: 'date',
        dueDate,
        repeat: repeat ?? 'none',
        repeatMonths: repeat === 'months' ? Math.max(1, Math.round(Number(repeatMonths) || 1)) : null,
      };
      const ics = buildReminderIcs(candidate);
      const blob = new Blob([ics], { type: 'text/calendar' });
      // Same delivery-router as SyncCard: on the installed iOS PWA a plain
      // anchor to a blob URL navigates the webview away (blank screen), so we
      // route through the Share sheet / new-window paths there and keep the
      // classic download-anchor everywhere else. See src/ui/deliverFile.ts.
      await deliverFile(blob, icsFileName(candidate), 'text/calendar');
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'That reminder could not be exported.');
    }
  }

  async function reallyDelete() {
    if (id !== undefined) await deleteOne('reminders', id);
    onDirtyChange?.(false);
    onSaved();
  }

  const paused = editing && original?.enabled === false;

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onCancel}>‹ Cancel</button>
        <button className="navbar-action" onClick={() => void save()}>Save</button>
      </div>
      <h1 className="large-title">{editing ? 'Edit Reminder' : 'New Reminder'}</h1>
      <FormProblem problem={problem} />

      <div className="card">
        <label className="field">Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optic battery" />
        </label>

        <label className="field">What brings it up?
          <div className="seg" role="group" aria-label="Reminder trigger" style={{ marginTop: 6 }}>
            <button type="button" aria-pressed={trigger === 'date'} className={trigger === 'date' ? 'on' : ''}
              onClick={() => setTrigger('date')}>A date</button>
            <button type="button" aria-pressed={trigger === 'rounds'} className={trigger === 'rounds' ? 'on' : ''}
              onClick={() => setTrigger('rounds')}>A round count</button>
          </div>
        </label>

        {trigger === 'date' ? (
          <>
            <label className="field">Due date
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
            <label className="field">Repeats
              <select value={repeat ?? 'none'} onChange={(e) => setRepeat(e.target.value as Reminder['repeat'])}>
                <option value="none">Doesn't repeat</option>
                <option value="yearly">Every year</option>
                <option value="months">Every few months</option>
              </select>
            </label>
            {repeat === 'months' && (
              <label className="field">Every how many months?
                <input type="number" inputMode="numeric" min="1" value={repeatMonths}
                  onChange={(e) => setRepeatMonths(e.target.value)} placeholder="6" />
              </label>
            )}
            <label className="field">Which gun? (optional)
              <select value={firearmId} onChange={(e) => setFirearmId(e.target.value)}>
                <option value="">No specific gun</option>
                {gunOptions.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
            {linkedOptic && (
              <div className="row">
                <span className="label">Linked optic</span>
                <span className="value">{[linkedOptic.make, linkedOptic.model].filter(Boolean).join(' ') || 'Unnamed optic'}</span>
              </div>
            )}
          </>
        ) : (
          <>
            <label className="field">Which gun?
              <select value={firearmId} onChange={(e) => setFirearmId(e.target.value)}>
                <option value="">Choose a gun…</option>
                {gunOptions.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
            <label className="field">Every how many rounds?
              <input type="number" inputMode="numeric" min="1" value={everyRounds}
                onChange={(e) => setEveryRounds(e.target.value)} placeholder="5000" />
            </label>
            {firearmId && selectedRounds !== null && (
              <p className="report-note">
                This gun has fired {selectedRounds.toLocaleString()} rounds. You'll be reminded once it has
                gone {everyRounds && Number(everyRounds) > 0 ? Number(everyRounds).toLocaleString() : 'N'} more from here.
              </p>
            )}
          </>
        )}

        <label className="field">Notes
          <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="What to check or do — and where the interval came from." />
        </label>
      </div>

      <button className="button" onClick={() => void save()}>{editing ? 'Save changes' : 'Save reminder'}</button>

      {editing && !paused && linkedOptic && (
        <p className="report-note" style={{ marginTop: 8 }}>
          Mark done also adds today's date to this optic's battery log.
        </p>
      )}
      {editing && !paused && (
        <button className="button secondary" style={{ marginTop: 8 }} onClick={() => void markDone()}>
          Mark done
        </button>
      )}
      {editing && paused && (
        <button className="button secondary" style={{ marginTop: 8 }} onClick={() => void turnBackOn()}>
          Turn back on
        </button>
      )}
      {/* Keyed to the FORM state (not the saved record) so it tracks what the
          export uses: it appears exactly when the fields on screen make a
          calendar event, and hides the moment the reminder is switched to a
          round count — a round-count reminder has no date to export. */}
      {editing && original && trigger === 'date' && !!dueDate && (
        <button className="button secondary" style={{ marginTop: 8 }} onClick={() => void addToCalendar()}>
          Add to Calendar
        </button>
      )}
      {editing && (
        <button className="button danger" style={{ marginTop: 8 }} onClick={() => setConfirming(true)}>
          Delete Reminder
        </button>
      )}

      {confirming && (
        <ConfirmSheet
          title="Delete this reminder?"
          message="It's removed for good. Your logs and gun history aren't affected."
          confirmLabel="Delete Reminder"
          onConfirm={() => void reallyDelete()}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
