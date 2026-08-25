// A real PractiScore stage Review + Combined capture, with every competitor's
// NAME AND MEMBER NUMBER replaced -- same convention as the Gun Craft stage
// fixture in this directory and as fixtures/practiscore-guncraft-2026-08-02.ts.
//
// Source: Take Aim Monday Night Mini Match, 3 August 2026 -- Stage 1 Review
// and Combined pages, copied out of PractiScore's Html Results on 24 August
// 2026 (spec STAGE_SCORES_SPEC.md section 3a). Tab-separated, same as the
// Gun Craft fixture.
//
// Distinct shapes this club's capture evidences that Gun Craft's does not:
//   * Every Member# cell on this club's Review page is BLANK, not the
//     literal string '0' -- Take Aim runs an unsquadded club night, and it
//     is the SQUAD column that reads '0' on every row, not Member#. (The
//     signed spec's evidence note describes this as "every Member# as
//     literal 0"; the actual captured bytes show blank cells throughout, so
//     the blank case is the one this fixture demonstrates for real, and the
//     literal-'0' case is covered by a synthetic row in the test file
//     instead. Both must read as "no number, fall back to name" either way.)
//   * A '[1]' edit marker on a normal (non-DNF) row: Whitcombe, Jon (was
//     Buehler, Jon).
//
// Ashgrove, Priya (was Minik, Michael) is the same alias used in the Gun
// Craft fixture for the same real person, reused here on purpose: Stage 1,
// 17A 5C 2D, Minor, no penalties -- 17*5 + 5*3 + 2*1 = 102 pts,
// 102/29.80 = 3.4228 = printed HF.
export const TAKE_AIM_2026_08_03_STAGE1_REVIEW = [
  "Stage Results - Review",
  ["Name", "Member#", "Squad", "Class", "Category", "Div", "PF", "A", "B", "C", "D", "M", "NS", "Proc", "AP", "Time", "Hit Factor", "TOD"].join('\t'),
  ["Pruett, Enzo", "", "0", "", "", "CO", "Min", "21", "-", "2", "1", "-", "-", "-", "-", "22.79", "4.9144", "08-03 19:38"].join('\t'),
  ["Larkin, Wren", "", "0", "", "", "LO", "Min", "14", "-", "9", "-", "1", "-", "-", "-", "17.31", "5.0260", "08-03 19:45"].join('\t'),
  ["Whitcombe, Jon", "", "0", "", "", "CO", "Min", "9", "-", "8", "3", "4", "-", "-", "-", "20.76", "1.5414", "08-03 19:15 [1]"].join('\t'),
  ["Vaccaro, Silas", "", "0", "", "", "LO", "Min", "17", "-", "6", "1", "-", "-", "-", "-", "14.16", "7.3446", "08-03 19:32"].join('\t'),
  ["Holloway, Talia", "", "0", "", "", "O", "Min", "17", "-", "5", "1", "1", "-", "-", "-", "21.73", "4.1878", "08-03 19:22"].join('\t'),
  ["Marchand, Rowan", "", "0", "", "", "CO", "Min", "17", "-", "7", "-", "-", "-", "-", "-", "18.33", "5.7829", "08-03 19:25"].join('\t'),
  ["Beaumont, Amara", "", "0", "", "", "CO", "Min", "19", "-", "5", "-", "-", "-", "-", "-", "36.15", "3.0429", "08-03 19:34"].join('\t'),
  ["Farrow, Finn", "", "0", "", "", "CO", "Min", "12", "-", "10", "1", "1", "-", "-", "-", "21.92", "3.6953", "08-03 19:24"].join('\t'),
  ["Quintero, Elowen", "", "0", "", "", "LO", "Min", "15", "-", "6", "-", "3", "-", "-", "-", "19.49", "3.2324", "08-03 19:41"].join('\t'),
  ["Hargrove, Dax", "", "0", "", "", "CO", "Min", "18", "-", "4", "1", "1", "-", "-", "-", "21.37", "4.3519", "08-03 19:36"].join('\t'),
  ["Ashgrove, Priya", "", "0", "", "", "CO", "Min", "17", "-", "5", "2", "-", "-", "-", "-", "29.80", "3.4228", "08-03 19:44"].join('\t'),
  ["Ellery, Junia", "", "0", "", "", "CO", "Min", "19", "-", "4", "1", "-", "-", "-", "-", "31.42", "3.4373", "08-03 19:47"].join('\t'),
  ["Beaulieu, Bram", "", "0", "", "", "LO", "Min", "18", "-", "6", "-", "-", "-", "-", "-", "14.58", "7.4074", "08-03 19:18"].join('\t'),
  ["Nakamura, Sable", "", "0", "", "", "O", "Min", "12", "-", "10", "-", "2", "-", "-", "-", "24.86", "2.8158", "08-03 19:30"].join('\t'),
  ["Osei, Otis", "", "0", "", "", "CO", "Min", "19", "-", "4", "1", "-", "-", "-", "-", "17.40", "6.2069", "08-03 19:12"].join('\t'),
  ["Vantol, Marisol", "", "0", "", "", "CO", "Min", "18", "-", "6", "-", "-", "-", "-", "-", "50.65", "2.1323", "08-03 19:09"].join('\t'),
  ["Belmonte, Ezra", "", "0", "", "", "LO", "Min", "14", "-", "8", "1", "1", "-", "-", "-", "20.24", "4.1996", "08-03 19:16"].join('\t'),
  ["Corwin, Vesper", "", "0", "", "", "O", "Min", "19", "-", "5", "-", "-", "-", "-", "-", "21.45", "5.1282", "08-03 19:29"].join('\t'),
  ["Halvorsen, Callum", "", "0", "", "", "CO", "Min", "11", "-", "8", "5", "-", "-", "-", "-", "23.73", "3.5398", "08-03 19:13"].join('\t'),
  ["Iversen, Ondine", "", "0", "", "", "CO", "Min", "19", "-", "4", "1", "-", "-", "-", "-", "16.03", "6.7374", "08-03 19:27"].join('\t'),
  ["Jarrett, Basil", "", "0", "", "", "CO", "Min", "20", "-", "4", "-", "-", "-", "-", "-", "22.08", "5.0725", "08-03 19:40"].join('\t'),
].join('\n') + '\n';

export const TAKE_AIM_2026_08_03_STAGE1_COMBINED = [
  "Stage Results - Combined",
  ["Place", "Name", "No.", "Class", "Div", "PF", "Points", "Pen", "Time", "Hit Factor", "Stage Pts", "Stage %"].join('\t'),
  ["1", "Beaulieu, Bram", "", "", "LO", "Min", "108", "0", "14.58", "7.4074", "120.0000", "100.00%"].join('\t'),
  ["2", "Vaccaro, Silas", "", "", "LO", "Min", "104", "0", "14.16", "7.3446", "118.9826", "99.15%"].join('\t'),
  ["3", "Iversen, Ondine", "", "", "CO", "Min", "108", "0", "16.03", "6.7374", "109.1460", "90.95%"].join('\t'),
  ["4", "Osei, Otis", "", "", "CO", "Min", "108", "0", "17.40", "6.2069", "100.5519", "83.79%"].join('\t'),
  ["5", "Marchand, Rowan", "", "", "CO", "Min", "106", "0", "18.33", "5.7829", "93.6831", "78.07%"].join('\t'),
  ["6", "Corwin, Vesper", "", "", "O", "Min", "110", "0", "21.45", "5.1282", "83.0769", "69.23%"].join('\t'),
  ["7", "Jarrett, Basil", "", "", "CO", "Min", "112", "0", "22.08", "5.0725", "82.1746", "68.48%"].join('\t'),
  ["8", "Larkin, Wren", "", "", "LO", "Min", "97", "10", "17.31", "5.0260", "81.4213", "67.85%"].join('\t'),
  ["9", "Pruett, Enzo", "", "", "CO", "Min", "112", "0", "22.79", "4.9144", "79.6134", "66.34%"].join('\t'),
  ["10", "Hargrove, Dax", "", "", "CO", "Min", "103", "10", "21.37", "4.3519", "70.5009", "58.75%"].join('\t'),
  ["11", "Belmonte, Ezra", "", "", "LO", "Min", "95", "10", "20.24", "4.1996", "68.0336", "56.69%"].join('\t'),
  ["12", "Holloway, Talia", "", "", "O", "Min", "101", "10", "21.73", "4.1878", "67.8424", "56.54%"].join('\t'),
  ["13", "Farrow, Finn", "", "", "CO", "Min", "91", "10", "21.92", "3.6953", "59.8639", "49.89%"].join('\t'),
  ["14", "Halvorsen, Callum", "", "", "CO", "Min", "84", "0", "23.73", "3.5398", "57.3448", "47.79%"].join('\t'),
  ["15", "Ellery, Junia", "", "", "CO", "Min", "108", "0", "31.42", "3.4373", "55.6843", "46.40%"].join('\t'),
  ["16", "Ashgrove, Priya", "", "", "CO", "Min", "102", "0", "29.80", "3.4228", "55.4494", "46.21%"].join('\t'),
  ["17", "Quintero, Elowen", "", "", "LO", "Min", "93", "30", "19.49", "3.2324", "52.3649", "43.64%"].join('\t'),
  ["18", "Beaumont, Amara", "", "", "CO", "Min", "110", "0", "36.15", "3.0429", "49.2950", "41.08%"].join('\t'),
  ["19", "Nakamura, Sable", "", "", "O", "Min", "90", "20", "24.86", "2.8158", "45.6160", "38.01%"].join('\t'),
  ["20", "Vantol, Marisol", "", "", "CO", "Min", "108", "0", "50.65", "2.1323", "34.5433", "28.79%"].join('\t'),
  ["21", "Whitcombe, Jon", "", "", "CO", "Min", "72", "40", "20.76", "1.5414", "24.9707", "20.81%"].join('\t'),
].join('\n') + '\n';
