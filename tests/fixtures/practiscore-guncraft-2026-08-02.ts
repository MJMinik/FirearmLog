// A real PractiScore capture, with every competitor's NAME AND MEMBER NUMBER
// replaced — the shapes are preserved exactly, the identities are not.
//
// Source: Gun Craft Practical Shooters 1st Sunday August, 2 August 2026, copied
// out of PractiScore's Html Results > Overall > Combined page on 5 August 2026.
// That copy is the only route a shooter has — the public results pages carry no
// download of any kind — and a browser puts a table on the clipboard TAB
// separated, which is why this fixture is tab-joined rather than a CSV.
//
// Identities are substituted because this repository is public, and a roster of
// seventy-eight competitors with their USPSA member numbers is a different thing
// in a source file than it is on a match results page. Nothing the parser reads
// depends on who the shooters are; it depends on the shapes below, and every one
// of these broke a parser at some point:
//   * 78 competitors, so a truncated read is visible rather than plausible.
//   * A Category cell full of COMMAS inside a TAB file ('Lady, Super Senior,
//     Law Enforcement, Distinguished Senior') — a comma reading shreds that row.
//   * Three '(DQ)' rows whose Match Pts and Match % cells are EMPTY.
//   * Rows with no member number, no class, or neither.
//   * Curly quotes, parentheses, all-caps and all-lower names, and lower-case
//     member-number prefixes.
//   * The single-cell 'Match Results - Combined' heading above the real header
//     row — a heading that does not split into columns means the separator is
//     wrong, which is what the structural check is for.
// Places, divisions, power factors, classes, points and percentages are the real
// posted figures and are unchanged. Division mix: O 16, LO 33, CO 19, L 2,
// PCC 7, SS 1.
export const GUN_CRAFT_2026_08_02 = [
  'Gun Craft Practical Shooters 1st Sunday August - 2026-08-02',
  '',
  'Match Results - Combined',
  ['Place', 'Name', 'No.', 'Class', 'Div', 'PF', 'Category', 'Match Pts', 'Match %'].join('\t'),
  ['1', 'Alder, Robin', 'A112912', 'G', 'O', 'Maj', '', '830.6178', '100.0000%'].join('\t'),
  ['2', 'Brandt, Casey', 'A227451', 'A', 'O', 'Maj', '', '712.2328', '85.7474%'].join('\t'),
  ['3', 'Nolan, Devin', 'A406894', 'M', 'LO', 'Min', '', '705.7027', '84.9612%'].join('\t'),
  ['4', 'Okonkwo, Sam', 'A24110', 'M', 'O', 'Maj', '', '692.7507', '83.4019%'].join('\t'),
  ['5', 'Prieto, Alex', '', '', 'CO', 'Min', '', '685.4327', '82.5208%'].join('\t'),
  ['6', 'Quill, Jordan', 'L3712', 'M', 'LO', 'Min', 'Law Enforcement', '659.9473', '79.4526%'].join('\t'),
  ['7', 'Rasmussen, Quinn', 'A294794', 'A', 'CO', 'Min', '', '654.1252', '78.7516%'].join('\t'),
  ['8', 'Sato, Reese', 'TY31057', 'M', 'L', 'Maj', 'Lady, Super Senior, Law Enforcement, Distinguished Senior', '651.4238', '78.4264%'].join('\t'),
  ['9', 'Tavares, Emery', 'A34894', 'G', 'O', 'Maj', 'Senior', '649.3026', '78.1710%'].join('\t'),
  ['10', 'UBALDI, ROWAN', 'A238401', '', 'LO', 'Min', '', '643.4311', '77.4642%'].join('\t'),
  ['11', 'Vance, Sage', 'TY24197', 'A', 'LO', 'Min', '', '641.7275', '77.2591%'].join('\t'),
  ['12', 'Whitlock, Blake', 'A582918', 'M', 'LO', 'Min', '', '636.0347', '76.5737%'].join('\t'),
  ['13', 'Xavier, Harper', 'A940164', 'U', 'LO', 'Min', '', '635.8881', '76.5560%'].join('\t'),
  ['14', 'Yardley, Kai', 'L3619', 'M', 'LO', 'Min', 'Senior', '631.4571', '76.0226%'].join('\t'),
  ['15', 'Zamora, Marley', 'A917376', 'A', 'CO', 'Min', '', '622.4404', '74.9370%'].join('\t'),
  ['16', 'Ashford, Noel', 'L1765', 'M', 'LO', 'Min', '', '621.5375', '74.8283%'].join('\t'),
  ['17', 'Beckett, Oakley', 'L2886', 'M', 'PCC', 'Min', '', '618.7169', '74.4888%'].join('\t'),
  ['18', 'Calloway, Payton', 'TY361935', 'A', 'LO', 'Min', '', '610.4616', '73.4949%'].join('\t'),
  ['19', 'Delgado, Remy', 'A322925', 'A', 'LO', 'Min', '', '583.7486', '70.2788%'].join('\t'),
  ['20', 'Everly, Skyler', 'A856887', 'A', 'CO', 'Min', '', '583.1275', '70.2041%'].join('\t'),
  ['21', 'Fontaine, Tatum', 'L3675', 'M', 'LO', 'Min', 'Lady', '576.7975', '69.4420%'].join('\t'),
  ['22', 'Granger, Vale', 'A83258', 'A', 'CO', 'Min', '', '575.7318', '69.3137%'].join('\t'),
  ['23', 'Holloway, Wren', 'TY16818', 'A', 'LO', 'Min', '', '574.7108', '69.1908%'].join('\t'),
  ['24', 'Ibarra, Zion', 'A401377', 'B', 'PCC', 'Min', '', '565.7579', '68.1129%'].join('\t'),
  ['25', 'Jessup Quiroga, Arden', 'A129293', 'B', 'PCC', 'Min', '', '563.9636', '67.8969%'].join('\t'),
  ['26', 'Kowalski, Bellamy', 'A265636', 'B', 'CO', 'Min', '', '553.5700', '66.6456%'].join('\t'),
  ['27', 'Lindqvist, Cameron', 'TY712414', 'U', 'CO', 'Min', '', '534.4425', '64.3428%'].join('\t'),
  ['28', 'Mercer, Darcy', 'A238331', 'A', 'CO', 'Min', '', '528.7088', '63.6525%'].join('\t'),
  ['29', 'Novak, Ellis', 'A536163', 'C', 'LO', 'Min', '', '528.3078', '63.6042%'].join('\t'),
  ['30', 'Ortega, Finley (Fin)', 'a26772', 'B', 'PCC', 'Min', 'Senior', '527.0392', '63.4515%'].join('\t'),
  ['31', 'Pemberton, Greer', 'L9256', 'A', 'LO', 'Min', 'Lady', '497.6156', '59.9091%'].join('\t'),
  ['32', 'Quiroga, Hollis', 'A291693', 'U', 'O', 'Min', '', '488.0703', '58.7599%'].join('\t'),
  ['33', 'Ridley, Indigo', 'A39786', 'B', 'PCC', 'Min', 'Senior', '478.7070', '57.6326%'].join('\t'),
  ['34', 'Solano, Jules', 'A83567', 'B', 'LO', 'Min', 'Law Enforcement', '476.7796', '57.4006%'].join('\t'),
  ['35', 'Thorne, Kendall', 'TY185402', 'B', 'O', 'Maj', '', '475.9330', '57.2987%'].join('\t'),
  ['36', 'ulrich, lane', 'A326768', 'B', 'LO', 'Min', '', '472.3821', '56.8712%'].join('\t'),
  ['37', 'Vergara, Merritt', 'A354753', 'B', 'CO', 'Min', '', '467.9530', '56.3379%'].join('\t'),
  ['38', 'Winslow, Nico', 'A355930', 'B', 'LO', 'Min', '', '465.4345', '56.0347%'].join('\t'),
  ['39', 'Yancey, Onyx', 'A181530', 'B', 'LO', 'Min', '', '457.2509', '55.0495%'].join('\t'),
  ['40', 'Zeller, Perry', 'a749089', '', 'O', 'Min', '', '452.0159', '54.4192%'].join('\t'),
  ['41', 'Abernathy, Quill', 'A29058', 'B', 'O', 'Maj', 'Lady', '431.8641', '51.9931%'].join('\t'),
  ['42', 'Bonneville, Riley', 'A360651', 'C', 'CO', 'Min', 'Lady', '427.7368', '51.4962%'].join('\t'),
  ['43', 'Castellanos, Shea', 'A160344', 'U', 'LO', 'Min', '', '422.1971', '50.8293%'].join('\t'),
  ['44', 'Draycott Kensington, Tobin', 'A275900', 'C', 'LO', 'Min', '', '422.0111', '50.8069%'].join('\t'),
  ['45', 'Ellsworth, Umber', 'Fy25791', 'M', 'O', 'Maj', 'Senior', '411.6662', '49.5614%'].join('\t'),
  ['46', 'Fairbanks, Vesper “VE”', 'a385718', 'C', 'CO', 'Min', 'Lady', '411.2369', '49.5098%'].join('\t'),
  ['47', 'Gallagher, Winter', 'A519725', 'C', 'O', 'Min', '', '403.9818', '48.6363%'].join('\t'),
  ['48', 'Hawthorne, Xen', 'A688197', 'U', 'CO', 'Min', '', '391.2056', '47.0981%'].join('\t'),
  ['49', 'Ingram, Yael', 'TY232535', 'C', 'LO', 'Min', 'Lady', '358.1685', '43.1207%'].join('\t'),
  ['50', 'Jankowski, Zephyr', 'A16411', 'D', 'LO', 'Min', 'Lady', '352.8396', '42.4792%'].join('\t'),
  ['51', 'Kensington, Ames', 'A206468', 'B', 'LO', 'Min', '', '352.7870', '42.4728%'].join('\t'),
  ['52', 'Lockhart, Briar', 'A379897', 'U', 'CO', 'Min', '', '340.1307', '40.9491%'].join('\t'),
  ['53', 'Marchetti, Cove', 'A335681', 'U', 'CO', 'Min', '', '334.3636', '40.2548%'].join('\t'),
  ['54', 'Nakamura, Dell', '', 'U', 'CO', 'Min', '', '327.6118', '39.4419%'].join('\t'),
  ['55', 'Oyelaran, Eden', 'A697126', 'B', 'LO', 'Min', '', '320.9986', '38.6458%'].join('\t'),
  ['56', 'Pritchard, Frost', 'FY238342', 'C', 'LO', 'Min', '', '319.6474', '38.4831%'].join('\t'),
  ['57', 'Quinlan, Gale', 'A163602', 'D', 'LO', 'Min', 'Lady', '309.3361', '37.2417%'].join('\t'),
  ['58', 'Rothschild, Haven', 'A402721', 'C', 'O', 'Min', '', '303.2618', '36.5104%'].join('\t'),
  ['59', 'Stavros, Isle', 'A371419', 'U', 'CO', 'Min', 'Military', '303.0320', '36.4827%'].join('\t'),
  ['60', 'Tremblay, June', 'A428377', 'D', 'LO', 'Min', 'Senior', '300.0022', '36.1180%'].join('\t'),
  ['61', 'Underwood, Kit “KI”', 'A723189', 'U', 'O', 'Min', '', '275.9018', '33.2165%'].join('\t'),
  ['62', 'Vasquez, Lark', 'A404301', 'C', 'PCC', 'Min', 'Distinguished Senior', '272.9998', '32.8671%'].join('\t'),
  ['63', 'Wexford, Moss', 'A158739', 'C', 'LO', 'Min', 'Senior', '261.2282', '31.4499%'].join('\t'),
  ['64', 'Yoshida, North', '', 'U', 'L', 'Min', '', '249.2360', '30.0061%'].join('\t'),
  ['65', 'Zimmerman, Ocean', '', 'U', 'CO', 'Min', '', '245.4801', '29.5539%'].join('\t'),
  ['66', 'Ashcroft, Pike', '', '', 'CO', 'Min', '', '210.5461', '25.3481%'].join('\t'),
  ['67', 'Barlowe, Quest', 'A373392', 'U', 'SS', 'Maj', 'Distinguished Senior', '192.7339', '23.2037%'].join('\t'),
  ['68', 'Cavendish, Reed', 'A950936', 'U', 'O', 'Min', '', '181.5609', '21.8585%'].join('\t'),
  ['69', 'Dunmore, Slate', 'A613613', 'U', 'LO', 'Min', '', '130.6413', '15.7282%'].join('\t'),
  ['70', 'Eastwick, Tide', '', '', 'O', 'Min', '', '119.5934', '14.3981%'].join('\t'),
  ['71', 'Fenwick, Vail', 'A110520', 'U', 'LO', 'Min', 'Lady', '118.3887', '14.2531%'].join('\t'),
  ['72', 'Grimaldi, Wells “WE”', 'a125543', 'U', 'CO', 'Min', '', '68.2399', '8.2156%'].join('\t'),
  ['73', 'Hargrove, York (Yor)', 'L116', 'A', 'O', 'Min', 'Distinguished Senior', '36.4961', '4.3938%'].join('\t'),
  ['74', 'Isherwood, Zane', 'A263057', 'D', 'O', 'Min', 'Senior', '10.2549', '1.2346%'].join('\t'),
  ['75', 'Jarvis, Ash', 'A636644', 'U', 'LO', 'Min', '', '0.0000', '0.0000%'].join('\t'),
  ['76', '(DQ) Kirkland, Bay', 'A357306', 'A', 'LO', 'Min', '', '', ''].join('\t'),
  ['77', '(DQ) Larkspur, Clay', 'A367480', 'A', 'LO', 'Min', '', '', ''].join('\t'),
  ['78', '(DQ) Montrose, Drew', 'A287572', 'G', 'PCC', 'Min', '', '', ''].join('\t'),
].join('\n') + '\n';
