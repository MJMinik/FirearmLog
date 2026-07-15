// The reminder template library (spec §4 + the research appendix). An ON-DEMAND
// library only — NONE are pre-enabled (spec §6 decision 3: no nagging out of the
// box). A template just prefills the reminder form with an honest, editable
// starting point; nothing is written until the shooter saves.
//
// Every interval here is presented as a manufacturer/community STARTING POINT,
// never as a fact about when a part fails — the shooter edits it to their gun and
// habits. All copy passes the DESIGN_DIRECTION §4 writing gate (rule 44): plain
// range language, no self-praise, no legal-adjacent categories (rule 34) — a
// free-form custom reminder covers anything personal without a word about law.

import type { Reminder } from './types.ts';

export interface ReminderTemplate {
  key: string;
  title: string;
  /** Prefilled, editable note — the honest "starting point" framing. */
  notes: string;
  trigger: Reminder['trigger'];
  /** 'gun' = naturally tied to one gun (the form asks which); 'global' = shooter-wide. */
  scope: 'gun' | 'global';
  defaultRepeat?: Reminder['repeat'];
  defaultRepeatMonths?: number | null;
  defaultEveryRounds?: number | null;
  /** One-line library subtitle (what/when, plain). */
  blurb: string;
}

export const REMINDER_TEMPLATES: readonly ReminderTemplate[] = [
  {
    key: 'optic-battery',
    title: 'Optic battery',
    blurb: 'Yearly — pick a date you’ll remember',
    trigger: 'date',
    scope: 'global',
    defaultRepeat: 'yearly',
    notes: 'Swap the red-dot battery once a year so it never dies at a match. Many shooters pick a date they’ll remember — a birthday is a common one. Battery life varies a lot by optic, so treat once a year as a floor, not a ceiling.',
  },
  {
    key: 'recoil-spring',
    title: 'Recoil spring',
    blurb: 'By round count, on one gun',
    trigger: 'rounds',
    scope: 'gun',
    defaultEveryRounds: 5000,
    notes: 'Recoil springs wear with rounds, and a tired one shows up as brass landing close or the odd failure to return to battery. Common starting points: about 5,000 rounds for a 2011, 3,000 for a 1911, 3,000–5,000 for a Glock. Set the number your gun’s maker lists.',
  },
  {
    key: 'mag-springs',
    title: 'Magazine springs',
    blurb: 'Yearly, or switch it to a round count',
    trigger: 'date',
    scope: 'global',
    defaultRepeat: 'yearly',
    notes: 'Magazine springs are debated — many competitors swap them over the winter as cheap insurance, others run them for years. Keep a yearly date if you like the winter-overhaul habit, or switch this to a round count instead.',
  },
  {
    key: 'uspsa-membership',
    title: 'USPSA membership renewal',
    blurb: 'Yearly, on your renewal date',
    trigger: 'date',
    scope: 'global',
    defaultRepeat: 'yearly',
    notes: 'USPSA membership renews once a year. A lapsed membership suspends your classification until you’re current again, so set your renewal date here.',
  },
  {
    key: 'idpa-membership',
    title: 'IDPA membership renewal',
    blurb: 'Yearly, on your renewal date',
    trigger: 'date',
    scope: 'global',
    defaultRepeat: 'yearly',
    notes: 'IDPA membership renews once a year. Set the date so it doesn’t lapse between matches.',
  },
  {
    key: 'idpa-classifier',
    title: 'IDPA classifier currency',
    blurb: 'A classifier at least once every 12 months',
    trigger: 'date',
    scope: 'global',
    defaultRepeat: 'yearly',
    notes: 'IDPA asks you to shoot a classifier at least once every 12 months to keep your classification current — a sanctioned match in that window counts too. Set a yearly nudge so it doesn’t slip.',
  },
  {
    key: 'chrono-check',
    title: 'Chrono / power-factor check',
    blurb: 'Before a major',
    trigger: 'date',
    scope: 'global',
    defaultRepeat: 'none',
    notes: 'Confirm your load makes power factor before a major, so a chrono stage doesn’t end your match. Set this a week or two out from the event.',
  },
  {
    key: 'deep-clean',
    title: 'Annual deep clean & inspection',
    blurb: 'Yearly, on one gun',
    trigger: 'date',
    scope: 'gun',
    defaultRepeat: 'yearly',
    notes: 'A full strip, clean, and look-over once a year catches wear before it bites — a good companion to the by-the-round cleaning schedule already kept on each gun.',
  },
  {
    key: 'zero-confirm',
    title: 'Zero confirmation',
    blurb: 'After a battery change, remount, or drop',
    trigger: 'date',
    scope: 'gun',
    defaultRepeat: 'none',
    notes: 'Re-confirm your zero after a battery change, a remount, or a drop — and before a major. There’s no set calendar for this; set a date when one of those happens.',
  },
  {
    key: 'range-membership',
    title: 'Range membership renewal',
    blurb: 'Yearly, on your renewal date',
    trigger: 'date',
    scope: 'global',
    defaultRepeat: 'yearly',
    notes: 'Range or club membership usually renews once a year. Set your date so range access doesn’t lapse.',
  },
];

export function getReminderTemplate(key: string | null | undefined): ReminderTemplate | undefined {
  if (!key) return undefined;
  return REMINDER_TEMPLATES.find((t) => t.key === key);
}
