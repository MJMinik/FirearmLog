/** The arithmetic behind the Steel Challenge tempo trainer (decision 80; spec
 *  STEEL_TEMPO_TRAINER_SPEC_2026-09-18.md section 2). Pure functions only:
 *  nothing here reads or writes stored data.
 *
 *  The one sum: per-string target = peak / class percentage / counted strings.
 *  Carry Optics on Smoke & Hope, Master: 10.00 / 0.85 = 11.76 s for the stage,
 *  and 11.76 / 4 = 2.94 s per string.
 *
 *  What no source publishes is how a string divides between the draw and the
 *  four transitions, so the shooter sets his draw and the remaining time is
 *  spread evenly over the four remaining shots (decision 80(a)). */

/** A class row the shooter can pick. `pct` is the share of peak that class
 *  begins at. D has no row: it is everything below C, so it has no time to
 *  hold. Peak is the benchmark itself, 100. */
export interface TempoBand {
  name: 'Peak' | 'GM' | 'M' | 'A' | 'B' | 'C';
  pct: number;
}

/** Same bands the classification calculator uses (GM 95, M 85, A 75, B 60,
 *  C 40), with the peak itself on top. */
export const TEMPO_BANDS: readonly TempoBand[] = [
  { name: 'Peak', pct: 100 },
  { name: 'GM', pct: 95 },
  { name: 'M', pct: 85 },
  { name: 'A', pct: 75 },
  { name: 'B', pct: 60 },
  { name: 'C', pct: 40 }
];

/** Shots in a string: four plates and the stop plate (SCSA Rulebook 9.1.1). */
export const SHOTS_PER_STRING = 5;

/** The smallest peak the arithmetic will work from. The lowest official peak
 *  is 7 s; this floor exists for a figure the shooter types himself. Below
 *  about three quarters of a second the hundredths run out: neighbouring
 *  classes show the same time and a row can earn a class above its label. */
export const MIN_PEAK_SEC = 1;

/** The smallest gap between two beats the trainer will play. A draw set so
 *  close to the string time that the other four shots fall inside a tenth of
 *  a second apiece is five clicks heard as one noise, not a pace anyone can
 *  hold, so it is refused rather than played. */
export const MIN_TRANSITION_SEC = 0.1;

/** Cuts a time to hundredths WITHOUT rounding up. A target that rounds up
 *  would cost the shooter the class. Open on Five to Go, B class: the stage
 *  needs 18.75, which is 4.6875 a string. Shown as 4.69 and shot four times
 *  that is 18.76, slower than B needs; shown as 4.68 it is 18.72 and earns it.
 *  The tiny nudge clears floating-point noise first, so an exact 3 that
 *  arrives as 2.9999999999 still reads 3.00. */
export function truncHundredths(sec: number): number {
  return Math.floor(sec * 100 + 1e-7) / 100;
}

/** Total stage time that earns `pct` of `peakSec`, uncut. Null on bad input. */
export function stageTimeFor(peakSec: number, pct: number): number | null {
  if (!Number.isFinite(peakSec) || !Number.isFinite(pct) || peakSec <= 0 || pct <= 0) return null;
  return peakSec / (pct / 100);
}

export interface TempoTarget {
  band: TempoBand['name'];
  pct: number;
  /** Stage time for this class, cut to hundredths. */
  stageSec: number;
  /** Time for one string at this class, cut to hundredths. This is the figure
   *  shown AND the figure the beat is scheduled from, so the number and the
   *  sound always agree. */
  perStringSec: number;
}

/** One target per band for a peak and a stage's counted strings (4, or 3 on
 *  Outer Limits). Empty when the input is unusable, which includes a peak
 *  under MIN_PEAK_SEC.
 *
 *  The two figures on a row are each cut to hundredths separately, so the
 *  per-string time multiplied back up is often a hundredth or two under the
 *  stage time shown (Open, Five to Go, Peak: 11.25 and 2.81, and 2.81 x 4 is
 *  11.24). Both are right; neither is the other times four. */
export function tempoTargets(peakSec: number, countedStrings: number): TempoTarget[] {
  if (!Number.isInteger(countedStrings) || countedStrings <= 0) return [];
  if (!Number.isFinite(peakSec) || peakSec < MIN_PEAK_SEC) return [];
  const out: TempoTarget[] = [];
  for (const b of TEMPO_BANDS) {
    const stage = stageTimeFor(peakSec, b.pct);
    if (stage === null || !Number.isFinite(stage)) return [];
    out.push({
      band: b.name,
      pct: b.pct,
      stageSec: truncHundredths(stage),
      perStringSec: truncHundredths(stage / countedStrings)
    });
  }
  return out;
}

/** When each of the five beats lands, in seconds after the start signal: the
 *  first at the draw, the last (the stop plate) at exactly `perStringSec`, the
 *  three between spread evenly. Null when the draw leaves less than
 *  MIN_TRANSITION_SEC between the remaining shots, or the input is unusable. */
export function beatTimes(perStringSec: number, drawSec: number): number[] | null {
  if (!Number.isFinite(perStringSec) || !Number.isFinite(drawSec)) return null;
  if (drawSec <= 0 || perStringSec <= 0 || drawSec >= perStringSec) return null;
  const gaps = SHOTS_PER_STRING - 1;
  const gap = (perStringSec - drawSec) / gaps;
  if (gap < MIN_TRANSITION_SEC - 1e-9) return null;
  const out: number[] = [];
  for (let i = 0; i < gaps; i++) out.push(drawSec + gap * i);
  out.push(perStringSec); // exact, not the sum of four float additions
  return out;
}

/** The even gap between shots after the draw, or null as beatTimes. */
export function transitionSec(perStringSec: number, drawSec: number): number | null {
  const t = beatTimes(perStringSec, drawSec);
  return t === null ? null : (perStringSec - drawSec) / (SHOTS_PER_STRING - 1);
}
