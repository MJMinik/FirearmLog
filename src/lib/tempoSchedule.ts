/** When things happen in one run of the Steel Challenge tempo trainer. Pure:
 *  no DOM, no audio, no clock of its own. Every time here is in seconds on
 *  whatever clock the caller passes in (the audio engine uses the Web Audio
 *  context clock, so sight and sound are placed from the same numbers).
 *
 *  One string is a start signal followed by five beats, placed by beatTimes()
 *  in steelTempo.ts: the first at the draw, the last at exactly the per-string
 *  time. The first string of a run is preceded by a three-second countdown.
 *  Under Repeat the next string's start signal comes four seconds after the
 *  previous string's last beat. */
import { beatTimes } from './steelTempo.ts';

/** Seconds counted down (3, 2, 1) between the Start tap and the start signal. */
export const COUNTDOWN_SEC = 3;

/** Seconds of quiet between one string's last beat and the next string's
 *  start signal under Repeat. */
export const REPEAT_PAUSE_SEC = 4;

export interface TempoEvent {
  /** 'start' is the start signal; 'beat' is one of the five beats. */
  kind: 'start' | 'beat';
  /** Clock time of the event, in seconds. */
  at: number;
  /** 0 for the start signal; 0 to 4 for the beats, in order. */
  index: number;
}

export interface TempoString {
  /** Clock time of this string's start signal. */
  startAt: number;
  /** The start signal, then the five beats, in time order. */
  events: TempoEvent[];
  /** Clock time of the last beat: startAt + perStringSec. */
  lastBeatAt: number;
  /** Clock time the NEXT string's start signal would sound under Repeat:
   *  this string's start signal + perStringSec + REPEAT_PAUSE_SEC. Worked
   *  from this string's own start, never from "now", so a long run of
   *  repeats cannot drift. */
  nextStartAt: number;
}

/** One string whose start signal sounds at `startAt`. Null when beatTimes()
 *  refuses the pair (see steelTempo.ts) or `startAt` is not a usable time. */
export function stringFrom(perStringSec: number, drawSec: number, startAt: number): TempoString | null {
  if (!Number.isFinite(startAt)) return null;
  const beats = beatTimes(perStringSec, drawSec);
  if (beats === null) return null;
  const events: TempoEvent[] = [{ kind: 'start', at: startAt, index: 0 }];
  beats.forEach((t, i) => events.push({ kind: 'beat', at: startAt + t, index: i }));
  return {
    startAt,
    events,
    lastBeatAt: startAt + perStringSec,
    nextStartAt: startAt + perStringSec + REPEAT_PAUSE_SEC
  };
}

/** The first string of a run begun at `t0` (the Start tap): its start signal
 *  sounds once the countdown has run. Null as stringFrom. */
export function firstString(
  perStringSec: number, drawSec: number, t0: number, countdownSec: number = COUNTDOWN_SEC
): TempoString | null {
  if (!Number.isFinite(t0) || !Number.isFinite(countdownSec) || countdownSec < 0) return null;
  return stringFrom(perStringSec, drawSec, t0 + countdownSec);
}

export interface CountdownTick {
  /** Clock time the digit appears. */
  at: number;
  /** The digit shown: 3, then 2, then 1. */
  digit: number;
}

/** The countdown digits for a run begun at `t0`, one a second, ending one
 *  second before the start signal. Whole seconds only; a countdown that is
 *  not a whole number of seconds gets no digits rather than a wrong one. */
export function countdownTicks(t0: number, countdownSec: number = COUNTDOWN_SEC): CountdownTick[] {
  if (!Number.isFinite(t0) || !Number.isInteger(countdownSec) || countdownSec <= 0) return [];
  const out: CountdownTick[] = [];
  for (let i = 0; i < countdownSec; i++) out.push({ at: t0 + i, digit: countdownSec - i });
  return out;
}
