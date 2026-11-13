import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNTDOWN_SEC, REPEAT_PAUSE_SEC, countdownTicks, firstString, stringFrom
} from '../src/lib/tempoSchedule.ts';
import { tempoTargets } from '../src/lib/steelTempo.ts';
import { SCSA_PEAKS } from '../src/lib/scsaPeaks.ts';

// Float sums like 103 + 1.485 are not exact, so times are compared to a
// billionth of a second: far below anything a speaker or an ear can tell.
const near = (got: number, want: number, what: string) =>
  assert.ok(Math.abs(got - want) < 1e-9, `${what}: got ${got}, want ${want}`);

// THE WORKED CASE, by hand, used throughout this file.
//   Carry Optics, Smoke & Hope, Master. Peak 10.00.
//   Stage:      10.00 / 0.85 = 11.7647...  cut to 11.76
//   Per string: 11.7647 / 4  =  2.9411...  cut to  2.94
//   Draw 1.00 leaves 2.94 - 1.00 = 1.94 for four gaps: 1.94 / 4 = 0.485 each.
//   Beats after the start signal: 1.00, 1.485, 1.97, 2.455, 2.94.
const PER = 2.94;
const DRAW = 1;

test('the worked case really is 2.94 s a string (so the numbers below are the app\'s own)', () => {
  const m = tempoTargets(SCSA_PEAKS['Carry Optics'][2], 4).find((t) => t.band === 'M')!;
  assert.equal(m.perStringSec, PER);
});

test('the constants: a 3-second countdown and a 4-second pause between repeats', () => {
  assert.equal(COUNTDOWN_SEC, 3);
  assert.equal(REPEAT_PAUSE_SEC, 4);
});

test('first string from t0 = 100: start signal at 103, beats at 104, 104.485, 104.97, 105.455, 105.94', () => {
  // Start tap at 100. Countdown 3 s, so the start signal is at 103.
  // Beats: 103 + 1.00, 103 + 1.485, 103 + 1.97, 103 + 2.455, 103 + 2.94.
  const s = firstString(PER, DRAW, 100)!;
  assert.equal(s.startAt, 103);
  assert.deepEqual(s.events.map((e) => [e.kind, e.index]), [
    ['start', 0], ['beat', 0], ['beat', 1], ['beat', 2], ['beat', 3], ['beat', 4]
  ]);
  const want = [103, 104, 104.485, 104.97, 105.455, 105.94];
  s.events.forEach((e, i) => near(e.at, want[i], `event ${i}`));
});

test('events are in time order, and every gap after the draw is the same 0.485 s', () => {
  const s = firstString(PER, DRAW, 100)!;
  for (let i = 1; i < s.events.length; i++) assert.ok(s.events[i].at > s.events[i - 1].at);
  near(s.events[1].at - s.events[0].at, 1, 'draw');
  for (let i = 2; i < s.events.length; i++) near(s.events[i].at - s.events[i - 1].at, 0.485, `gap ${i - 1}`);
});

test('the last beat is the per-string time after the start signal, to the bit', () => {
  // 103 + 2.94, written once; not the sum of four float gaps.
  const s = firstString(PER, DRAW, 100)!;
  assert.equal(s.events[5].at, 103 + 2.94);
  assert.equal(s.lastBeatAt, 103 + 2.94);
  assert.equal(s.events[5].at, s.lastBeatAt);
});

test('Repeat: the next start signal is 4 s after the last beat, 109.94', () => {
  // Previous start signal 103, plus the string 2.94, plus the pause 4.00 = 109.94.
  const s = firstString(PER, DRAW, 100)!;
  near(s.nextStartAt, 109.94, 'next start');
  near(s.nextStartAt - s.lastBeatAt, 4, 'pause after the last beat');
});

test('Repeat: the second string is the first one moved 6.94 s later, with no countdown', () => {
  // 2.94 + 4.00 = 6.94 from one start signal to the next.
  const a = firstString(PER, DRAW, 100)!;
  const b = stringFrom(PER, DRAW, a.nextStartAt)!;
  near(b.startAt, 109.94, 'second start');
  const want = [109.94, 110.94, 111.425, 111.91, 112.395, 112.88];
  b.events.forEach((e, i) => near(e.at, want[i], `second string event ${i}`));
  near(b.nextStartAt, 116.88, 'third start'); // 109.94 + 6.94
});

test('Repeat does not drift: the 200th start signal is 199 periods after the first', () => {
  // 103 + 199 x 6.94 = 103 + 1381.06 = 1484.06
  let s = firstString(PER, DRAW, 100)!;
  for (let i = 1; i < 200; i++) s = stringFrom(PER, DRAW, s.nextStartAt)!;
  assert.ok(Math.abs(s.startAt - 1484.06) < 1e-6, `got ${s.startAt}`);
});

test('a start time of zero works (a fresh audio context starts its clock at 0)', () => {
  const s = firstString(PER, DRAW, 0)!;
  assert.equal(s.startAt, 3);
  near(s.events[1].at, 4, 'first beat');
});

test('stringFrom places the start signal exactly where it is told', () => {
  const s = stringFrom(PER, DRAW, 50)!;
  assert.equal(s.startAt, 50);
  assert.equal(s.events[0].at, 50);
  assert.equal(s.events[0].kind, 'start');
});

test('countdown digits: 3 at t0, 2 a second later, 1 a second after that', () => {
  assert.deepEqual(countdownTicks(100), [
    { at: 100, digit: 3 }, { at: 101, digit: 2 }, { at: 102, digit: 1 }
  ]);
  // The last digit is one second before the start signal.
  assert.equal(firstString(PER, DRAW, 100)!.startAt - countdownTicks(100)[2].at, 1);
});

test('unusable input gives null or no ticks, never a schedule with NaN in it', () => {
  assert.equal(firstString(PER, 0, 100), null); // no draw
  assert.equal(firstString(PER, 2.94, 100), null); // draw as long as the string
  assert.equal(firstString(PER, 2.6, 100), null); // gaps of 0.085 s, under a tenth
  assert.equal(firstString(NaN, DRAW, 100), null);
  assert.equal(firstString(PER, DRAW, NaN), null);
  assert.equal(firstString(PER, DRAW, Infinity), null);
  assert.equal(firstString(PER, DRAW, 100, -1), null);
  assert.equal(firstString(PER, DRAW, 100, NaN), null);
  assert.equal(stringFrom(PER, DRAW, NaN), null);
  assert.deepEqual(countdownTicks(NaN), []);
  assert.deepEqual(countdownTicks(100, 0), []);
  assert.deepEqual(countdownTicks(100, 2.5), []);
});

test('the smallest gap the trainer will play still schedules: draw 2.54 leaves exactly a tenth', () => {
  // 2.94 - 2.54 = 0.40; 0.40 / 4 = 0.10. Beats at 2.54, 2.64, 2.74, 2.84, 2.94.
  const s = stringFrom(PER, 2.54, 0)!;
  const want = [0, 2.54, 2.64, 2.74, 2.84, 2.94];
  s.events.forEach((e, i) => near(e.at, want[i], `event ${i}`));
});
