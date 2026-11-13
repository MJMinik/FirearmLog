// The Steel Challenge tempo trainer (decision 80; step 2, the screen).
//
// A metronome for one string: a start signal, then five beats, the first at
// the shooter's draw and the last at the per-string time a class needs. The
// arithmetic is lib/steelTempo.ts, the timetable is lib/tempoSchedule.ts and
// the sound is ui/tempoAudio.ts. This file is the controls and the readout.
//
// THIS SCREEN SAVES NOTHING. It reads matches, sessions and timed-skill sets
// once, to choose a starting division and draw, and writes nowhere: not the
// database, not settings, not localStorage. Division, class, draw, Repeat and
// a typed peak all live in component state, so leaving the screen forgets
// them.
import { useEffect, useRef, useState } from 'react';
import type { Match, Session, SkillSet } from '../lib/types.ts';
import { getAll } from '../lib/db.ts';
import { STEEL_DIVISIONS } from '../lib/competition.ts';
import { formatDayKey } from '../lib/dates.ts';
import { SCSA_PEAKS, SCSA_STAGES, scsaPeak } from '../lib/scsaPeaks.ts';
import {
  MIN_PEAK_SEC, beatTimes, tempoTargets, transitionSec, truncHundredths
} from '../lib/steelTempo.ts';
import type { TempoBand } from '../lib/steelTempo.ts';
import { latestSteelDivision, latestTypicalDraw } from '../lib/tempoDefaults.ts';
import { TempoEngine } from './tempoAudio.ts';
import type { TempoSignal } from './tempoAudio.ts';
import { InfoTip } from './InfoTip.tsx';

/** The sixteen divisions the peak table holds, in the order the match form
 *  lists them (STEEL_DIVISIONS, less 'Other', which has no peaks). */
const DIVISIONS: readonly string[] = STEEL_DIVISIONS.filter((d) =>
  Object.prototype.hasOwnProperty.call(SCSA_PEAKS, d));

/** The draw the field starts on when the log holds no typical draw. */
const DEFAULT_DRAW_SEC = 1;

/** The largest peak the shooter may type. A string is capped at 30 seconds
 *  and at most four count, so no stage can total more than 120. The bound
 *  also keeps an absurd entry from producing a table too wide for a phone. */
const MAX_PEAK_SEC = 120;

/** How long the screen waits for the log before opening on the defaults. */
const READ_WAIT_MS = 2000;

/** The class the table starts on. */
const DEFAULT_BAND: TempoBand['name'] = 'B';

/** Two decimals, always. Callers pass a figure already cut to hundredths. */
const fmt = (sec: number): string => sec.toFixed(2);

/** Reads a typed number of seconds and cuts it to hundredths, so the figure
 *  on screen and the figure the beat is scheduled from are the same one.
 *  Null for an empty field or anything that is not a number. */
function parseSec(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? truncHundredths(n) : null;
}

function validStage(stage: number | undefined): number {
  return typeof stage === 'number' && Number.isInteger(stage) && stage >= 0 && stage < SCSA_STAGES.length
    ? stage : 0;
}

type RunStatus = '' | 'Counting down' | 'Running' | 'Stopped' | 'Finished';

export function TempoScreen({ stage, onBack }: { stage?: number; onBack: () => void }) {
  // ── Settings (component state only; nothing is stored) ────────────────────
  const [stageIdx, setStageIdx] = useState(() => validStage(stage));
  const [division, setDivision] = useState(DIVISIONS[0]);
  const [band, setBand] = useState<TempoBand['name']>(DEFAULT_BAND);
  // null = the official peak is in use; a string = the edit field is open and
  // holds this text.
  const [peakText, setPeakText] = useState<string | null>(null);
  const [drawText, setDrawText] = useState(fmt(DEFAULT_DRAW_SEC));
  // Day-key of the session the pre-filled draw came from; null when it is the
  // working default.
  const [drawFrom, setDrawFrom] = useState<string | null>(null);
  const [drawTyped, setDrawTyped] = useState(false);
  const [repeat, setRepeat] = useState(false);
  // False until the two starting values have been read (or the read failed),
  // so the pickers never change under the shooter's thumb a moment after the
  // screen appears.
  const [ready, setReady] = useState(false);

  // ── The run ───────────────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [digit, setDigit] = useState<number | null>(null);
  const [flash, setFlash] = useState<TempoSignal | null>(null);
  const [status, setStatus] = useState<RunStatus>('');
  const [soundFailed, setSoundFailed] = useState(false);

  const engineRef = useRef<TempoEngine | null>(null);
  useEffect(() => {
    const engine = new TempoEngine();
    engineRef.current = engine;
    // Leaving the screen stops the sound, releases the screen and closes the
    // audio context.
    return () => { engine.dispose(); engineRef.current = null; };
  }, []);

  // Starting values, read once. Each read stands alone: if one fails the
  // other still applies, and a failure only ever means "use the default".
  useEffect(() => {
    let alive = true;
    // A read that never answers must not leave the screen blank. After two
    // seconds the screen opens on the defaults, and a late answer is dropped
    // so nothing changes under the shooter's thumb.
    const giveUp = setTimeout(() => { if (alive) { alive = false; setReady(true); } }, READ_WAIT_MS);
    void (async () => {
      try {
        const matches = await getAll<Match>('matches');
        const d = latestSteelDivision(matches);
        if (alive && d !== null && DIVISIONS.includes(d)) setDivision(d);
      } catch (e) {
        console.error('Tempo: could not read matches for the starting division', e);
      }
      try {
        const [sessions, sets] = await Promise.all([
          getAll<Session>('sessions'), getAll<SkillSet>('skillSets')
        ]);
        const d = latestTypicalDraw(sets, sessions);
        if (alive && d !== null) {
          setDrawText(fmt(truncHundredths(d.sec)));
          setDrawFrom(d.date);
        }
      } catch (e) {
        console.error('Tempo: could not read the log for a typical draw', e);
      }
      if (alive) { clearTimeout(giveUp); setReady(true); }
    })();
    return () => { alive = false; clearTimeout(giveUp); };
  }, []);

  // ── What the settings work out to ─────────────────────────────────────────
  const stageDef = SCSA_STAGES[stageIdx];
  const official = scsaPeak(division, stageIdx);
  const editing = peakText !== null;
  const typedPeak = editing ? parseSec(peakText) : null;
  const typedPeakTooBig = typedPeak !== null && typedPeak > MAX_PEAK_SEC;
  const typedPeakUsable = typedPeak !== null && typedPeak >= MIN_PEAK_SEC && !typedPeakTooBig;
  const peak = editing ? (typedPeakUsable ? typedPeak : null) : official;
  const targets = peak === null ? [] : tempoTargets(peak, stageDef.countedStrings);
  const chosen = targets.find((t) => t.band === band) ?? null;

  const draw = parseSec(drawText);
  const beats = chosen !== null && draw !== null ? beatTimes(chosen.perStringSec, draw) : null;
  const gap = chosen !== null && draw !== null ? transitionSec(chosen.perStringSec, draw) : null;
  const canStart = beats !== null && gap !== null;

  const peakProblem = typedPeakTooBig
    ? 'Type a peak of 120.00 seconds or less to see the times.'
    : 'Type a peak of 1.00 seconds or more to see the times.';

  let summary: string;
  if (chosen === null) {
    summary = peakProblem;
  } else if (draw === null || draw <= 0) {
    summary = 'Set a draw time to hear the pace.';
  } else if (draw >= chosen.perStringSec) {
    summary = 'That draw is as long as the whole string at this class. Set a shorter draw or pick a slower class.';
  } else if (!canStart) {
    summary = 'That draw leaves under a tenth of a second between the other four beats. Set a shorter draw or pick a slower class.';
  } else {
    // The gap is a quarter of (string - draw), so it often runs past two
    // decimals (0.485). Cut to hundredths it no longer adds up to the last
    // beat, so the line says "about" whenever the figure shown is not exact.
    const exactGap = Math.round((chosen.perStringSec - draw) * 100) % 4 === 0;
    summary = `Draw ${fmt(draw)} s, then four beats ${exactGap ? '' : 'about '}${fmt(truncHundredths(gap))} s apart. Last beat at ${fmt(chosen.perStringSec)} s.`;
  }

  // ── Peak edit: focus follows the control that replaced the one tapped ─────
  const peakInputRef = useRef<HTMLInputElement>(null);
  const ownFigureBtnRef = useRef<HTMLButtonElement>(null);
  const focusAfterPeakToggle = useRef<'field' | 'link' | null>(null);
  useEffect(() => {
    if (focusAfterPeakToggle.current === 'field') peakInputRef.current?.focus();
    else if (focusAfterPeakToggle.current === 'link') ownFigureBtnRef.current?.focus();
    focusAfterPeakToggle.current = null;
  }, [editing]);

  function openPeakEdit() {
    if (running || official === null) return;
    focusAfterPeakToggle.current = 'field';
    setPeakText(fmt(official));
  }
  function resetPeak() {
    if (running) return;
    focusAfterPeakToggle.current = 'link';
    setPeakText(null);
  }
  // A typed peak belongs to one stage in one division, so choosing another of
  // either goes back to that pair's official figure.
  function chooseStage(i: number) { setStageIdx(validStage(i)); setPeakText(null); }
  function chooseDivision(d: string) { if (DIVISIONS.includes(d)) { setDivision(d); setPeakText(null); } }

  // ── Start and Stop ────────────────────────────────────────────────────────
  function endRun(next: RunStatus) {
    setRunning(false); setDigit(null); setFlash(null); setStatus(next);
  }

  function start() {
    const engine = engineRef.current;
    if (running || !canStart || chosen === null || draw === null || engine === null) return;
    setRunning(true); setDigit(null); setFlash(null); setStatus('Counting down');
    // Called straight from the tap, with nothing awaited first: iPhone Safari
    // only lets a page start sound from inside a tap.
    void engine.start({ perStringSec: chosen.perStringSec, drawSec: draw, repeat }, {
      onCountdown: (d) => { setDigit(d); setFlash(null); },
      onSignal: (kind) => {
        if (kind === 'start') { setDigit(null); setStatus('Running'); }
        setFlash(kind);
      },
      onSignalEnd: () => setFlash(null),
      onEnd: (reason) => endRun(reason === 'finished' ? 'Finished' : 'Stopped')
    }).then((res) => {
      if (engineRef.current !== engine) return; // left the screen meanwhile
      if (res.started) setSoundFailed(!res.audio);
      // The engine declined to begin and will send no ending of its own.
      else if (res.reason === 'refused') endRun('Stopped');
    }).catch((e: unknown) => {
      console.error('Tempo: the run could not start', e);
      if (engineRef.current !== engine) return;
      engine.stop();
      endRun('Stopped');
    });
  }

  function stop() {
    engineRef.current?.stop();
    endRun('Stopped');
  }

  const caption = editing ? 'Times from your figure' : `Times for ${division} on ${stageDef.name}`;
  const drawNote = drawFrom !== null
    ? (drawTyped ? null : `your typical draw, from ${formatDayKey(drawFrom)}`)
    : `${drawTyped ? '' : 'a working default; set your own. '}About one second is a common working target for a draw at 7 yards. It is a community figure, not an SCSA one.`;

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Tempo <InfoTip title="Tempo">A metronome for one Steel Challenge string. Pick the stage, your division and a class, set your draw, then tap Start. You hear a start tone, then five beats: the first at your draw, the last at the time that class needs for one string, the three between spread evenly. It is a pace to hold, not a prediction of your string. Nothing on this screen is saved.</InfoTip></h1>

      {ready && (
        <>
          <div className="card">
            <label className="field">Stage
              <select value={String(stageIdx)} disabled={running}
                onChange={(e) => chooseStage(Number(e.target.value))}>
                {SCSA_STAGES.map((s, i) => (
                  <option key={s.code} value={String(i)}>{s.name} ({s.code})</option>
                ))}
              </select>
            </label>
            <label className="field">Division
              <select value={division} disabled={running}
                onChange={(e) => chooseDivision(e.target.value)}>
                {DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>

            {!editing && official !== null && (
              <p className="tempo-peak">
                Peak time <strong>{fmt(official)} s</strong>, from scsa.org/classification.{' '}
                <button type="button" className="link-btn" ref={ownFigureBtnRef} disabled={running}
                  onClick={openPeakEdit}>Use my own figure</button>
              </p>
            )}
            {editing && (
              <>
                <label className="field">Your peak time (seconds)
                  <input ref={peakInputRef} type="number" inputMode="decimal" step="0.01" min="1" max="120"
                    value={peakText} disabled={running}
                    aria-describedby="tempo-peak-line"
                    aria-invalid={typedPeakUsable ? undefined : true}
                    onChange={(e) => setPeakText(e.target.value)} />
                </label>
                <div className="tempo-peak-edited">
                  <p className="tempo-peak" id="tempo-peak-line" role="status">
                    {typedPeakUsable && typedPeak !== null
                      ? <>Peak time <strong>{fmt(typedPeak)} s</strong> <span className="tempo-own">your figure, not SCSA&apos;s</span></>
                      : peakProblem}
                  </p>
                  <button type="button" className="button secondary tempo-reset" disabled={running}
                    onClick={resetPeak}>Reset to official</button>
                </div>
              </>
            )}
          </div>

          <div className="card">
            <table className="tempo-table">
              <caption>{caption}</caption>
              <thead>
                <tr>
                  <th scope="col">Class</th>
                  <th scope="col">% of peak</th>
                  <th scope="col">Stage</th>
                  <th scope="col">Per string</th>
                </tr>
              </thead>
              {targets.length > 0 && (
                <tbody>
                  {targets.map((t) => {
                    const on = t.band === band;
                    return (
                      // The radio is the control (keyboard, VoiceOver); the
                      // row's own tap is a larger target for a thumb and
                      // changes nothing a radio could not.
                      <tr key={t.band} className={`tempo-row${on ? ' on' : ''}${running ? ' locked' : ''}`}
                        onClick={() => { if (!running) setBand(t.band); }}>
                        <th scope="row">
                          <label className="tempo-pick">
                            <input type="radio" name="tempo-class" value={t.band} checked={on}
                              disabled={running}
                              aria-label={`${t.band}, ${fmt(t.perStringSec)} seconds per string`}
                              onChange={() => setBand(t.band)} />
                            <span>{t.band}</span>
                          </label>
                        </th>
                        <td>{t.pct}%</td>
                        <td>{fmt(t.stageSec)} s</td>
                        <td>{fmt(t.perStringSec)} s</td>
                      </tr>
                    );
                  })}
                  {/* D is everything below C: it has no time to hold, so it
                      is a plain row with nothing to pick. */}
                  <tr className="tempo-d">
                    <th scope="row">D</th>
                    <td>below 40%</td>
                    <td colSpan={2}>slower than the C time</td>
                  </tr>
                </tbody>
              )}
            </table>
            <p className="report-note">
              Stage is the total for the strings that count: your best 4 of 5 (best 3 of 4 on Outer Limits). Per string is the average each of those strings needs. Both are cut to hundredths, never rounded up.
            </p>
            {stageDef.name === 'Outer Limits' && (
              <p className="report-note">
                Outer Limits has a move from one box to the other in the middle of the string. The beats stay evenly spaced, so the move has to fit inside one gap.
              </p>
            )}
          </div>

          <div className="card">
            <label className="field">Draw (seconds)
              <input type="number" inputMode="decimal" step="0.01" min="0"
                value={drawText} disabled={running}
                aria-describedby={drawNote ? 'tempo-draw-note tempo-summary' : 'tempo-summary'}
                aria-invalid={chosen !== null && !canStart ? true : undefined}
                onChange={(e) => { setDrawText(e.target.value); setDrawTyped(true); }} />
            </label>
            {drawNote && <p className="report-note tempo-draw-note" id="tempo-draw-note">{drawNote}</p>}
            <p className={`tempo-summary${canStart ? '' : ' blocked'}`} id="tempo-summary" role="status">{summary}</p>
          </div>

          <div className="card tempo-console">
            <p className="tempo-readout"
              aria-label={chosen !== null ? `${band}, ${fmt(chosen.perStringSec)} seconds per string` : band}>
              <span className="tempo-readout-class">{band}</span>
              {chosen !== null && <span className="tempo-readout-time">{fmt(chosen.perStringSec)} s</span>}
              {chosen !== null && <span className="tempo-readout-unit">per string</span>}
            </p>
            {/* Sight only: the status line below speaks for this, so a screen
                reader is not read a digit or a flash five times a string. */}
            <div className="tempo-stage" aria-hidden="true">
              {digit !== null
                ? <span className="tempo-count">{digit}</span>
                : <span className={`tempo-dot${flash ? ` ${flash}` : ''}`} />}
            </div>
            {/* One button for both, so keyboard focus stays put when Start
                becomes Stop. Blocked Start stays focusable and says why. */}
            <button type="button" className={`button tempo-go${running ? ' stop' : ''}`}
              aria-disabled={!running && !canStart ? true : undefined}
              aria-describedby={!running && !canStart ? 'tempo-summary' : undefined}
              onClick={running ? stop : start}>
              {running ? 'Stop' : 'Start'}
            </button>
            {running && <p className="report-note">Stop to change the settings.</p>}
            {soundFailed && (
              <p className="report-note warn" role="status">This browser could not start the sound. The dot still flashes on every beat.</p>
            )}
            <div className="row">
              <button type="button" className={`gun-toggle ${repeat ? 'on' : ''}`} aria-pressed={repeat}
                disabled={running} onClick={() => setRepeat((r) => !r)}>
                Repeat
              </button>
            </div>
            <p className="report-note tempo-repeat-note">Plays the string again after a 4-second pause, until you tap Stop.</p>
            <p className="tempo-status">{status}</p>
            {/* Spoken states only. "Running" is left out on purpose: it would
                be read aloud over the start tone and the first beat. */}
            <p className="sr-only tempo-live" role="status" aria-live="polite">{status === 'Running' ? '' : status}</p>
          </div>
        </>
      )}
    </div>
  );
}
