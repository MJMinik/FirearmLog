/** SCSA Steel Challenge peak times: the sport's benchmark time, in seconds, for
 *  each classifier stage in each division. Source: scsa.org/classification
 *  (fetched 8 July 2026; verified against that page three times, decision 32).
 *
 *  THIS IS A COPY. The first home of these 128 figures is the marketing site's
 *  engine, `website/calc.js` (`SC_PEAKS`). Two guards stop the copies drifting
 *  apart quietly:
 *    1. tests/scsaPeaks.test.ts pins a checksum of this table, so any edit
 *       here fails the unit suite until the checksum is changed on purpose.
 *    2. website-verify/run.js reads this file and asserts it equals the site's
 *       table, division by division and stage by stage.
 *  When SCSA revises a peak, change BOTH copies in one sitting.
 *
 *  Each row is written as 'Division':[eight numbers] on one line. The site's
 *  suite parses that exact shape; keep it.
 *
 *  Stage order (SC-101 to SC-108) is SCSA_STAGES below. Division names are the
 *  ones STEEL_DIVISIONS in competition.ts uses, less 'Other'. */

export interface ScsaStage {
  /** SCSA's stage number, e.g. 'SC-103'. */
  code: string;
  /** The stage's name as the app's built-in drills carry it. */
  name: string;
  /** Strings that count toward the stage time: best 4 of 5, or best 3 of 4 on
   *  Outer Limits (SCSA Rulebook 9.1.2). */
  countedStrings: number;
}

export const SCSA_STAGES: readonly ScsaStage[] = [
  { code: 'SC-101', name: 'Five to Go', countedStrings: 4 },
  { code: 'SC-102', name: 'Showdown', countedStrings: 4 },
  { code: 'SC-103', name: 'Smoke & Hope', countedStrings: 4 },
  { code: 'SC-104', name: 'Outer Limits', countedStrings: 3 },
  { code: 'SC-105', name: 'Accelerator', countedStrings: 4 },
  { code: 'SC-106', name: 'Pendulum', countedStrings: 4 },
  { code: 'SC-107', name: 'Speed Option', countedStrings: 4 },
  { code: 'SC-108', name: 'Roundabout', countedStrings: 4 }
];

/* prettier-ignore */
export const SCSA_PEAKS: Readonly<Record<string, readonly number[]>> = {
  'Open':[11.25,9.5,8.5,12.5,10.5,11.25,11.5,8.5],
  'Limited':[12.5,9.5,9.5,13.5,10.5,12.5,12.5,9.5],
  'Limited Optics':[12.25,9.5,9.5,13.5,10.75,12.25,12.25,9.5],
  'Production':[13,10,10,14,11.5,13,13,10],
  'Single Stack':[13.25,10.5,10.25,14.75,11.75,13.5,13.5,10.5],
  'Carry Optics':[12.5,9.75,10,13.75,11,12.75,13,9.75],
  'Iron Sight Revolver':[13.5,12,10.5,15.75,13,14.25,14,11],
  'Optical Sight Revolver':[12.25,10.5,10,14.25,12.75,13.5,12.75,10.5],
  'PCC Optics':[9.5,7,7,11.25,8.75,9,9.5,7.5],
  'PCC Iron':[10.75,8.5,7.75,12.25,9.5,10.5,11,8],
  'Rimfire Pistol Optics':[8.75,7.5,7,11.5,8.5,9.5,10,7.5],
  'Rimfire Pistol Iron':[10.5,9,8,13,9.25,11,11,8.25],
  'Rimfire Rifle Optics':[9.5,7,7,10.75,8.5,9,9,7],
  'Rimfire Rifle Iron':[9.75,7.5,7.5,12,9,9.75,10,7.5],
  'Rimfire Revolver Optic':[9.75,8.25,7.75,12.75,9.5,10.5,11,8.25],
  'Rimfire Revolver Iron':[11.5,10,9,14.25,10.25,12,12,9]
};

/** The official peak for one stage in one division, or null when either is
 *  unknown. Never indexes the table with an unchecked name or position. */
export function scsaPeak(division: string, stageIndex: number): number | null {
  if (!Object.prototype.hasOwnProperty.call(SCSA_PEAKS, division)) return null;
  if (!Number.isInteger(stageIndex) || stageIndex < 0 || stageIndex >= SCSA_STAGES.length) return null;
  const v = SCSA_PEAKS[division][stageIndex];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
