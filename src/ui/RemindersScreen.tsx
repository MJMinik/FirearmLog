// Reminders: the full list (More → Reminders) and the add/edit form. The list is
// grouped by URGENCY — Overdue / Coming up / Later — not by gun, because a shooter
// asks "what's due?" (spec §6b LOCKED). Templates are an on-demand library; the
// empty state does the discovery. Date reminders can be exported to the calendar.
import { useEffect, useState } from 'react';
import { ScreenLoading, ScreenError } from './ScreenState.tsx';
import type { Firearm, Match, Reminder, Session } from '../lib/types.ts';
import { deleteOne, getAll, getOne, putOne } from '../lib/db.ts';
import { activeOnly } from '../lib/softDelete.ts';
import { todayKey, formatDayKey } from '../lib/dates.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { roundsForFirearm } from '../lib/stats.ts';
import { ownedGuns } from '../lib/gunStatus.ts';
import {
  buildReminderContext, comingUpReminders, completionPatch, dueReminders,
  laterReminders, pausedReminders, reminderViews,
} from '../lib/reminders.ts';
import type { ReminderView } from '../lib/reminders.ts';
import { REMINDER_TEMPLATES, getReminderTemplate } from '../lib/reminderTemplates.ts';
import { buildReminderIcs, canExportIcs, icsFileName } from '../lib/ics.ts';
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
  const done = pausedReminders(views);
  const activeCount = due.length + soon.length + later.length;

  const openForm = (id?: string) => open({ kind: 'reminder-form', id });

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
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
                  <div className="row-sub">{done.length} finished or paused</div>
                </span>
                <span className="value"><Icon name={showDone ? 'chevronDown' : 'chevronRight'} size={16} /></span>
              </button>
              {showDone && done.map((v) => {
                const r = v.reminder;
                const label = r.firearmId ? `${ctx.gunName(r.firearmId) ?? '—'}: ${r.title}` : r.title;
                return (
                  <button className="row-tap" key={r.id} onClick={() => openForm(r.id)}>
                    <span className="label">
                      {label}
                      <div className="row-sub">{r.lastDoneDate ? `Marked done ${formatDayKey(r.lastDoneDate)}` : 'Paused'}</div>
                    </span>
                    <span className="badge info">Off</span>
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

export function ReminderForm({ id, templateKey, firearmId: initialFirearmId, onSaved, onCancel, onDirtyChange }: {
  id?: string; templateKey?: string; firearmId?: string;
  onSaved: () => void; onCancel: () => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const editing = id !== undefined;
  const tpl = getReminderTemplate(templateKey);

  const [original, setOriginal] = useState<Reminder | null>(null);
  const [recordReady, setRecordReady] = useState(!editing);
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);

  const [title, setTitle] = useState(tpl?.title ?? '');
  const [notes, setNotes] = useState(tpl?.notes ?? '');
  const [trigger, setTrigger] = useState<Reminder['trigger']>(tpl?.trigger ?? 'date');
  const [firearmId, setFirearmId] = useState(initialFirearmId ?? '');
  const [dueDate, setDueDate] = useState('');
  const [repeat, setRepeat] = useState<Reminder['repeat']>(tpl?.defaultRepeat ?? 'yearly');
  const [repeatMonths, setRepeatMonths] = useState(String(tpl?.defaultRepeatMonths ?? 3));
  const [everyRounds, setEveryRounds] = useState(tpl?.defaultEveryRounds ? String(tpl.defaultEveryRounds) : '');

  const [problem, setProblem] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [initialSig, setInitialSig] = useState<string | null>(null);

  // Load the gear needed for the gun picker and round-count baseline.
  useEffect(() => {
    let alive = true;
    void Promise.all([
      getAll<Firearm>('firearms'), getAll<Session>('sessions'), getAll<Match>('matches'),
    ]).then(([f, s, m]) => {
      if (!alive) return;
      setFirearms(f); setSessions(activeOnly(s)); setMatches(m);
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

  if (!recordReady) return <ScreenLoading />;

  const gunOptions = ownedGuns(firearms, original?.firearmId ? [original.firearmId] : []);
  const selectedRounds = firearmId ? roundsForFirearm(firearmId, firearms, sessions, matches) : null;

  async function save() {
    if (!title.trim()) { setProblem('Give the reminder a short title.'); return; }
    const now = Date.now();
    const base = {
      title: title.trim(),
      notes: notes.trim(),
      source: original?.source ?? (templateKey ? ('template' as const) : ('custom' as const)),
      templateKey: original?.templateKey ?? templateKey ?? null,
      firearmId: firearmId || null,
      enabled: original ? original.enabled : true,
      lastDoneDate: original?.lastDoneDate ?? null,
    };
    let record: ReminderFields;
    if (trigger === 'date') {
      if (!dueDate) { setProblem('Pick a due date, or switch this to a round count.'); return; }
      const months = repeat === 'months' ? Math.max(1, Math.round(Number(repeatMonths) || 1)) : null;
      record = {
        ...base, trigger: 'date',
        dueDate, repeat: repeat ?? 'none', repeatMonths: months,
        everyRounds: null, baselineRounds: null,
      };
    } else {
      if (!firearmId) { setProblem('Pick which gun this round-count reminder is for.'); return; }
      const iv = Number(everyRounds);
      if (!Number.isFinite(iv) || iv <= 0) { setProblem('Enter how many rounds between reminders — a number over 0.'); return; }
      // Keep the existing baseline when the gun and kind are unchanged; otherwise
      // anchor to the gun's rounds right now, so "every N rounds" runs from here.
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
    onSaved();
  }

  async function markDone() {
    if (!original) return;
    const ctx = buildReminderContext(firearms, sessions, matches, todayKey());
    const patch = completionPatch(original, ctx);
    onDirtyChange?.(false);
    await putOne('reminders', stampUpdate({ ...original, ...patch }, Date.now()));
    onSaved();
  }

  async function turnBackOn() {
    if (!original) return;
    onDirtyChange?.(false);
    await putOne('reminders', stampUpdate({ ...original, enabled: true }, Date.now()));
    onSaved();
  }

  function addToCalendar() {
    if (!original || !canExportIcs(original)) return;
    try {
      const ics = buildReminderIcs(original);
      const blob = new Blob([ics], { type: 'text/calendar' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = icsFileName(original);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
      {editing && original && canExportIcs(original) && (
        <button className="button secondary" style={{ marginTop: 8 }} onClick={addToCalendar}>
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
