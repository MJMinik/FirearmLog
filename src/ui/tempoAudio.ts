/** The sound and timing engine behind the Steel Challenge tempo trainer.
 *
 *  SOUND IS SYNTHESIZED, ALWAYS. Two plain tones made by Web Audio
 *  oscillators: a longer, lower one for the start signal and a short, higher
 *  click for each beat. No recorded sample is loaded or played.
 *
 *  TIMING. Every tone is placed on the audio context's own clock with
 *  `osc.start(when)`, never with a timer, so the spacing you hear is as exact
 *  as the hardware allows. What you SEE (the countdown digits, the dot) is
 *  read from that same clock once a frame, so sight and sound are placed from
 *  the same numbers (lib/tempoSchedule.ts). When the browser has no usable
 *  audio the run still happens, silently, on the page's own clock.
 *
 *  iPhone Safari only lets a page make sound from inside a tap, so the
 *  context is created and resumed inside `start()`, which the screen calls
 *  straight from the Start button's tap handler.
 *
 *  Nothing here reads or writes stored data. */
import { COUNTDOWN_SEC, countdownTicks, firstString, stringFrom } from '../lib/tempoSchedule.ts';
import type { TempoString } from '../lib/tempoSchedule.ts';

/** Start signal: the longer, lower tone. */
export const START_TONE = { hz: 440, sec: 0.3, attackSec: 0.01, releaseSec: 0.05 } as const;
/** Beat: the short, higher click. */
export const BEAT_CLICK = { hz: 1760, sec: 0.04, attackSec: 0.003, releaseSec: 0.02 } as const;

/** Loudness of both tones, as a share of full scale. Each tone peaks at 1
 *  before this is applied, and a very short draw can put the first click on
 *  top of the start tone's tail, so two can sound at once. At 0.5 the two
 *  together reach full scale and no further, so they cannot clip. */
const LEVEL = 0.5;
/** How far ahead of "now" a run's first moment is placed, so nothing is
 *  scheduled in the past by the time the browser acts on it. */
const LEAD_SEC = 0.06;
/** How long the screen stays in its running state after the final beat, so
 *  the last flash is seen before the controls come back. */
const END_HOLD_SEC = 0.4;
/** Longest the dot stays lit for a beat. Shortened when the beats are close
 *  together so there is always a dark moment between two flashes. */
const BEAT_FLASH_SEC = 0.09;
/** How long to wait for the browser to start the audio before running
 *  without it. Not a sound timer: it only bounds a promise. */
const RESUME_WAIT_MS = 1500;
/** The most the picture is held back to match a slow audio path (a
 *  Bluetooth speaker, say). A larger reported figure is treated as wrong. */
const MAX_OUTPUT_LATENCY_SEC = 0.5;

export type TempoSignal = 'start' | 'beat';

export interface TempoHandlers {
  /** A countdown digit (3, 2, 1) should show. */
  onCountdown: (digit: number) => void;
  /** The start signal or a beat is sounding: light the dot. */
  onSignal: (kind: TempoSignal) => void;
  /** The dot should go dark again. */
  onSignalEnd: () => void;
  /** The run ended by itself: 'finished' after the last beat with Repeat
   *  off, 'interrupted' when the page was hidden or the audio was taken
   *  away. NOT called for stop() or dispose(); the caller did those. */
  onEnd: (reason: 'finished' | 'interrupted') => void;
}

export interface TempoRunConfig {
  perStringSec: number;
  drawSec: number;
  repeat: boolean;
}

export interface TempoStartResult {
  /** False when the run could not begin (unusable times, or stopped while
   *  the audio was starting). */
  started: boolean;
  /** False when the run is silent because the browser gave no audio. */
  audio: boolean;
  /** Set when the engine declined to begin and will call no handler: the
   *  caller must put its own controls back. Absent when the run was stopped
   *  by the caller, or ended itself and already said so through onEnd. */
  reason?: 'refused';
}

type AudioContextCtor = typeof AudioContext;
type WakeLockLike = { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

interface Pending { at: number; seq: number; fire: () => void; role: 'light' | 'dark' | 'other' }

export class TempoEngine {
  private ctx: AudioContext | null = null;
  /** Bumped by every start, stop and dispose. Anything asynchronous checks
   *  it is still the run it belongs to before touching anything. */
  private runId = 0;
  private disposed = false;
  private running = false;

  private clock: () => number = () => performance.now() / 1000;
  private queue: Pending[] = [];
  private seq = 0;
  private raf = 0;

  private master: GainNode | null = null;
  private voices = new Set<{ osc: OscillatorNode; gain: GainNode }>();
  private wake: { release: () => Promise<void> } | null = null;
  private unlisten: (() => void) | null = null;

  /** Begins a run. MUST be called synchronously from a tap handler: the
   *  audio context is created and resumed before the first await. */
  async start(cfg: TempoRunConfig, handlers: TempoHandlers): Promise<TempoStartResult> {
    this.halt(false);
    if (this.disposed) return { started: false, audio: false, reason: 'refused' };
    // Refuse unusable times before any audio is touched.
    if (stringFrom(cfg.perStringSec, cfg.drawSec, 0) === null) return { started: false, audio: false, reason: 'refused' };

    const id = ++this.runId;
    this.running = true;
    const ctx = this.ensureContext();
    const resumed = ctx ? resumeWithin(ctx, RESUME_WAIT_MS) : Promise.resolve(false);
    void this.holdScreenAwake(id);

    const audio = await resumed;
    if (id !== this.runId) return { started: false, audio };

    let latency = 0;
    if (audio && ctx) {
      this.clock = () => ctx.currentTime;
      try {
        this.master = ctx.createGain();
        this.master.gain.value = LEVEL;
        this.master.connect(ctx.destination);
      } catch (e) {
        console.error('Tempo: could not build the audio path', e);
        this.master = null;
      }
      const reported = ctx.outputLatency;
      if (typeof reported === 'number' && Number.isFinite(reported) && reported > 0) {
        latency = Math.min(reported, MAX_OUTPUT_LATENCY_SEC);
      }
    } else {
      this.clock = () => performance.now() / 1000;
    }
    const sounding = audio && this.master !== null;

    const t0 = this.clock() + LEAD_SEC;
    const first = firstString(cfg.perStringSec, cfg.drawSec, t0, COUNTDOWN_SEC);
    if (first === null) { this.halt(); return { started: false, audio: sounding, reason: 'refused' }; }

    for (const tick of countdownTicks(t0, COUNTDOWN_SEC)) {
      this.at(tick.at + latency, () => handlers.onCountdown(tick.digit));
    }
    this.playString(first, cfg, handlers, latency);

    // A run nobody is watching is stopped: a hidden page throttles the frame
    // clock, and a phone that has gone to its lock screen should fall silent.
    const onVisibility = () => { if (document.hidden) this.endRun(id, handlers, 'interrupted'); };
    // iPhone takes the audio away for a call or an alarm ('interrupted'), and
    // the context clock stops with it. End the run rather than freeze it.
    const onState = () => { if (ctx && ctx.state !== 'running') this.endRun(id, handlers, 'interrupted'); };
    document.addEventListener('visibilitychange', onVisibility);
    // Listened for whenever the run is on the audio clock, sounding or not:
    // if that clock stops, a run timed from it would freeze.
    if (audio && ctx) ctx.addEventListener('statechange', onState);
    this.unlisten = () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (ctx) ctx.removeEventListener('statechange', onState);
    };
    if (document.hidden) { this.endRun(id, handlers, 'interrupted'); return { started: false, audio: sounding }; }

    const frame = () => {
      if (id !== this.runId) return;
      const now = this.clock();
      // A frame that arrives late can find a flash's "on" and its "off" both
      // due. Fired together they would cancel out and the beat would never
      // be seen, so the "off" waits for the next frame.
      let litThisFrame = false;
      while (this.queue.length > 0 && this.queue[0].at <= now) {
        if (litThisFrame && this.queue[0].role === 'dark') break;
        const next = this.queue.shift();
        if (next?.role === 'light') litThisFrame = true;
        next?.fire();
        if (id !== this.runId) return; // the event ended the run
      }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
    return { started: true, audio: sounding };
  }

  /** Stops the run now: silences everything already scheduled, clears the
   *  picture queue and lets the screen sleep again. Safe to call at any time. */
  stop(): void {
    this.halt();
  }

  /** Stops, then closes the audio context for good. Call on unmount. */
  dispose(): void {
    this.halt();
    this.disposed = true;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== 'closed') {
      try { void ctx.close().catch(() => { /* already closing */ }); } catch { /* nothing left to close */ }
    }
  }

  // ── inside ────────────────────────────────────────────────────────────────

  private ensureContext(): AudioContext | null {
    if (this.ctx && this.ctx.state !== 'closed') return this.ctx;
    this.ctx = null;
    const Ctor = audioContextCtor();
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch (e) {
      console.error('Tempo: this browser could not create an audio context', e);
      this.ctx = null;
    }
    return this.ctx;
  }

  /** Schedules one string: its six tones on the audio clock, and the matching
   *  picture events on the frame queue. Under Repeat, the moment this
   *  string's start signal arrives the next string is scheduled from THIS
   *  string's times, so repeats cannot drift. */
  private playString(str: TempoString, cfg: TempoRunConfig, handlers: TempoHandlers, latency: number): void {
    const id = this.runId;
    const gap = (cfg.perStringSec - cfg.drawSec) / 4;
    const beatFlash = Math.min(BEAT_FLASH_SEC, gap / 2);
    const startFlash = Math.min(START_TONE.sec, cfg.drawSec / 2);

    for (const ev of str.events) {
      this.voice(ev.at, ev.kind === 'start' ? START_TONE : BEAT_CLICK);
      this.at(ev.at + latency, () => handlers.onSignal(ev.kind), 'light');
      this.at(ev.at + latency + (ev.kind === 'start' ? startFlash : beatFlash), () => handlers.onSignalEnd(), 'dark');
    }

    if (cfg.repeat) {
      this.at(str.startAt, () => {
        // The frame clock stalled for longer than a whole string and its
        // pause (a frozen page). Scheduling now would put the next string in
        // the past, where every tone plays at once; end the run instead.
        if (this.clock() > str.nextStartAt) { this.endRun(id, handlers, 'interrupted'); return; }
        const next = stringFrom(cfg.perStringSec, cfg.drawSec, str.nextStartAt);
        if (next !== null) this.playString(next, cfg, handlers, latency);
        else this.endRun(id, handlers, 'finished');
      });
    } else {
      this.at(str.lastBeatAt + latency + END_HOLD_SEC, () => this.endRun(id, handlers, 'finished'));
    }
  }

  /** One tone at `when` on the audio clock, with a short fade in and out so
   *  it neither clicks nor pops. Silent run: does nothing. */
  private voice(when: number, tone: { hz: number; sec: number; attackSec: number; releaseSec: number }): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = tone.hz;
      gain.gain.value = 0;
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(1, when + tone.attackSec);
      gain.gain.setValueAtTime(1, when + tone.sec - tone.releaseSec);
      gain.gain.linearRampToValueAtTime(0, when + tone.sec);
      osc.connect(gain);
      gain.connect(master);
      const entry = { osc, gain };
      this.voices.add(entry);
      osc.onended = () => {
        this.voices.delete(entry);
        try { osc.disconnect(); gain.disconnect(); } catch { /* already gone */ }
      };
      osc.start(when);
      osc.stop(when + tone.sec);
    } catch (e) {
      // One tone that cannot be built must not take the run down with it.
      console.error('Tempo: could not schedule a tone', e);
    }
  }

  private at(at: number, fire: () => void, role: Pending['role'] = 'other'): void {
    this.queue.push({ at, seq: this.seq++, fire, role });
    this.queue.sort((a, b) => (a.at - b.at) || (a.seq - b.seq));
  }

  private endRun(id: number, handlers: TempoHandlers, reason: 'finished' | 'interrupted'): void {
    if (id !== this.runId || !this.running) return;
    this.halt();
    handlers.onEnd(reason);
  }

  /** Everything stop() promises. Also invalidates any start() still waiting
   *  on the browser, by moving runId on. */
  private halt(rest: boolean = true): void {
    this.runId++;
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.queue = [];
    if (this.unlisten) { this.unlisten(); this.unlisten = null; }
    for (const v of this.voices) {
      try { v.osc.onended = null; v.osc.stop(); } catch { /* never started, or already stopped */ }
      try { v.osc.disconnect(); v.gain.disconnect(); } catch { /* already gone */ }
    }
    this.voices.clear();
    if (this.master) {
      try { this.master.disconnect(); } catch { /* already gone */ }
      this.master = null;
    }
    const wake = this.wake;
    this.wake = null;
    if (wake) void wake.release().catch(() => { /* already released */ });
    // Between runs the context is put to sleep so an open Tempo screen is not
    // holding the phone's audio hardware awake. Skipped when a new run is
    // about to resume it in the same tap.
    const ctx = this.ctx;
    if (rest && ctx && ctx.state === 'running') {
      try { void ctx.suspend().catch(() => { /* closing, or already asleep */ }); } catch { /* same */ }
    }
  }

  /** Asks the browser to keep the screen on for the length of the run, where
   *  it can. Missing or refused is normal (low battery, older Safari) and is
   *  ignored: the trainer works the same, the screen may just dim. */
  private async holdScreenAwake(id: number): Promise<void> {
    try {
      const lock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
      if (!lock || typeof lock.request !== 'function') return;
      const sentinel = await lock.request('screen');
      if (id !== this.runId) { void sentinel.release().catch(() => { /* already released */ }); return; }
      this.wake = sentinel;
    } catch { /* not available or not allowed right now */ }
  }
}

/** Resolves true once the context is running. False when the browser refuses,
 *  throws, or has not answered within `ms` (an iPhone can leave the promise
 *  hanging); the run then goes ahead without sound rather than waiting. */
function resumeWithin(ctx: AudioContext, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ok: boolean) => { if (!done) { done = true; clearTimeout(timer); resolve(ok); } };
    const timer = setTimeout(() => finish(ctx.state === 'running'), ms);
    try {
      ctx.resume().then(() => finish(ctx.state === 'running'), () => finish(false));
    } catch {
      finish(false);
    }
  });
}
