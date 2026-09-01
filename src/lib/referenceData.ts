// Reference library (spec §9) — built-in maintenance guidance, one guide per
// manufacturer per category, plus model-scoped guides where one model dominates
// (the SCSA expansion, decisions 48/49, session 138). Ships with the app
// (read-only for now). No guide count is written here on purpose — it went
// stale the first time the list grew.
// Intervals are widely used starting points, NOT gospel — the owner's manual
// always wins, and every gun can be customized on its own page.

import type { GunCategory, Reference } from './types.ts';

export interface ReferenceEntry {
  id: string;
  name: string;
  category: GunCategory;
  /** Model aliases for the MODEL-AWARE suggestion (decision 49, session 138).
   *  Present only on model-scoped guides (e.g. the 10/22 guide); a guide
   *  without this field is the manufacturer's GENERAL guide for the category
   *  and wins whenever no alias matches the gun's model. Compared in compact
   *  form (lowercase, all punctuation and spaces removed), so '10/22',
   *  '10-22' and '1022' all hit the same alias. */
  models?: string[];
  maintenance: {
    deepCleanRounds: number;
    recoilSpringRounds?: number;
    note: string;
  };
  checklist: string[];
  guidance: string;
  links: { label: string; url: string }[];
}

export const REFERENCES: ReferenceEntry[] = [
  // ---------- Pistols ----------
  {
    id: 'ref-atlas', name: 'Atlas Gunworks (2011)', category: 'Pistol',
    maintenance: { deepCleanRounds: 3000, recoilSpringRounds: 5000, note: 'Atlas guns run wet — lube is cheaper than parts.' },
    checklist: [
      'Field strip and wipe the rails after every live session',
      'Oil rails, barrel hood, and lugs generously',
      'Check grip screws and mag release tension',
      'Inspect the recoil spring for kinks or set',
      'Confirm sight/optic screws are tight'
    ],
    guidance: 'A fitted 2011 likes to be clean and very wet. Wipe and re-oil after each range day, deep clean around every 3,000 rounds, and treat the recoil spring as a consumable — most 2011 shooters swap it about every 5,000 rounds. Your build sheet and Atlas’s guidance win over anything here.',
    links: [{ label: 'Atlas Gunworks support', url: 'https://atlasgunworks.com' }]
  },
  {
    id: 'ref-glock', name: 'Glock', category: 'Pistol',
    maintenance: { deepCleanRounds: 10000, recoilSpringRounds: 10000, note: 'Famously low-maintenance, but springs still wear.' },
    checklist: [
      'Field strip and wipe the barrel, slide, and frame rails',
      'One drop of oil per rail cut, barrel hood, and connector',
      'Check the recoil spring assembly for separation',
      'Inspect magazine springs and followers',
      'Confirm sight screws / optic plate are tight'
    ],
    guidance: 'Glocks tolerate neglect better than most, but a quick field strip after range trips and a real deep clean by 10,000 rounds keeps them running right. Replace the recoil spring assembly around 10,000 rounds (sooner on compensated or competition guns). Light oil — Glocks run drier than 1911-pattern guns.',
    links: [{ label: 'Glock US support', url: 'https://us.glock.com' }]
  },
  {
    id: 'ref-sig', name: 'SIG Sauer', category: 'Pistol',
    maintenance: { deepCleanRounds: 5000, recoilSpringRounds: 5000, note: 'P320/P365 manuals suggest spring service near 5,000 rounds.' },
    checklist: [
      'Field strip; wipe slide, barrel, and the FCU rails',
      'Light oil on rails, barrel, and locking surfaces',
      'Inspect the recoil spring assembly',
      'Check striker channel is clean and DRY',
      'Confirm optic and sight screws are tight'
    ],
    guidance: 'SIG recommends cleaning regularly and replacing recoil springs on the P320/P365 family in the neighborhood of 5,000 rounds. Keep the striker channel dry — oil there causes light strikes. Deep clean by 5,000 rounds or sooner if it gets dunked or dusty.',
    links: [{ label: 'SIG Sauer support', url: 'https://www.sigsauer.com' }]
  },
  {
    id: 'ref-sw-pistol', name: 'Smith & Wesson (Pistol)', category: 'Pistol',
    maintenance: { deepCleanRounds: 5000, recoilSpringRounds: 5000, note: 'M&P series guidance; revolvers differ.' },
    checklist: [
      'Field strip; clean barrel and slide internals',
      'Oil rails, barrel hood, and outside of barrel',
      'Inspect recoil spring and guide rod',
      'Check takedown lever and sear deactivation lever',
      'Confirm sight/optic screws are tight'
    ],
    guidance: 'M&P pistols are happy with a field strip and wipe-down after each session and a deep clean by about 5,000 rounds. Recoil springs are commonly replaced around 5,000 rounds for hard-use guns. For S&W revolvers, focus on bore, cylinder charge holes, and the ejector star instead.',
    links: [{ label: 'Smith & Wesson support', url: 'https://www.smith-wesson.com' }]
  },
  {
    id: 'ref-staccato', name: 'Staccato (2011)', category: 'Pistol',
    maintenance: { deepCleanRounds: 3000, recoilSpringRounds: 5000, note: 'Staccato publishes a 5,000-round recoil spring interval.' },
    checklist: [
      'Field strip and wipe after every live session',
      'Oil rails, barrel, bushing/comp area generously',
      'Replace recoil spring on schedule — keep a spare',
      'Check grip and mag catch screws',
      'Inspect extractor tension if you see erratic ejection'
    ],
    guidance: 'Staccato’s own guidance: keep it lubricated, clean it regularly, and replace the recoil spring about every 5,000 rounds. Like all 2011s it rewards running wet. Deep clean around 3,000 rounds, especially the breech face and under the extractor.',
    links: [{ label: 'Staccato support', url: 'https://staccato2011.com' }]
  },
  {
    id: 'ref-cz', name: 'CZ', category: 'Pistol',
    maintenance: { deepCleanRounds: 5000, recoilSpringRounds: 4000, note: 'Shadow 2 competition guns often get springs at 3–5k.' },
    checklist: [
      'Field strip; clean barrel, slide rails (they ride inside the frame)',
      'Oil the full length of the frame rails',
      'Inspect recoil and hammer springs',
      'Check slide stop for peening',
      'Confirm grip and sight screws are tight'
    ],
    guidance: 'CZ75-pattern guns carry the slide inside the frame, so grit hides in the rails — flush and re-oil them at every cleaning. Competition Shadows commonly get recoil springs every 3,000–5,000 rounds. Deep clean by 5,000 rounds and keep an eye on the slide stop.',
    links: [{ label: 'CZ-USA support', url: 'https://cz-usa.com' }]
  },
  {
    id: 'ref-ruger-markiv', name: 'Ruger (Mark IV / 22/45)', category: 'Pistol',
    models: ['Mark IV', 'MK IV', 'MKIV', '22/45'],
    maintenance: { deepCleanRounds: 1000, note: 'Ruger sets no round count — clean at regular intervals and after dust, sand or moisture. Rimfire runs dirty; err early.' },
    checklist: [
      'Field strip with the one-button takedown and wipe the bolt face and chamber',
      'Run a lightly oiled patch through the bore, then a dry one',
      'Wipe surfaces with a lightly oiled cloth — light, Ruger warns excess oil collects grit',
      'Clean magazines whenever they look dirty',
      'Confirm sight or optic screws are tight'
    ],
    guidance: 'Ruger\u2019s manual gives no round count: clean at regular intervals, always after adverse conditions, and a wipe-down after each range day keeps a .22 honest — rimfire fouling builds faster than centerfire. The one-button takedown makes the field strip a no-tool job. Oil goes on light and sparing, and any oil left in the bore comes out before firing — both straight from the manual. The 1,000-round deep clean here is a common starting point, not Ruger\u2019s number; the manual wins.',
    links: [{ label: 'Ruger Mark IV manual (PDF)', url: 'https://ruger-docs.s3.amazonaws.com/_manuals/Mark-IV-Pc4tS28s.pdf' }]
  },
  {
    id: 'ref-browning-buckmark', name: 'Browning (Buck Mark)', category: 'Pistol',
    models: ['Buck Mark', 'Buckmark'],
    maintenance: { deepCleanRounds: 1000, note: 'Browning\u2019s own cadence: clean after every day of shooting; magazines every 500\u20131,000 rounds.' },
    checklist: [
      'Clean after every day of shooting — Browning\u2019s own instruction',
      'Light film of quality gun oil on moving parts, the slide contact and the spring guide',
      'Keep oil away from wood grips — Browning warns it softens them',
      'Clean magazines every 500\u20131,000 rounds with a polymer-safe solvent',
      'No disassembly beyond the manual — deeper service goes to a gunsmith or Browning'
    ],
    guidance: 'Browning is unusually plain about the cadence: clean the pistol after every day of shooting, more often if it gets filthy, and give the magazines a solvent clean every 500 to 1,000 rounds — their figures, not ours. Lubrication is a very light film, sparingly; extra oil migrates into wood grips and can interfere with function. The manual draws a hard line at its own takedown steps, so anything deeper is a gunsmith job. The 1,000-round deep clean is a starting point in the same spirit as their day-of-shooting rule.',
    links: [{ label: 'Browning Buck Mark owner\u2019s manual (PDF)', url: 'https://www.browning.com/content/dam/browning/support/owners-manuals/2021/21-BFA-009_Buck_Mark_Pistol_OM_WEB.pdf' }]
  },
  {
    id: 'ref-sw22-victory', name: 'Smith & Wesson (SW22 Victory)', category: 'Pistol',
    models: ['SW22', 'Victory'],
    maintenance: { deepCleanRounds: 1000, note: 'S&W gives no round count; a single drop at the marked points is the manual\u2019s own lubrication rule.' },
    checklist: [
      'Take down with the hex wrench on the takedown screw, muzzle up, barrel assembly forward and off',
      'One drop of lubricant at the marked points: top of the bolt, both rail sides, extractor',
      'Wipe off any excess — S&W warns it collects carbon and powder',
      'Leave the recoil spring in the bolt for normal cleaning; it releases under real force',
      'Confirm sight or optic screws are tight'
    ],
    guidance: 'S&W sets no round count for the Victory — clean before first use, after firing, and after any dust or moisture. Their lubrication instruction is exact and worth taking literally: a single drop at each marked point, no more, because excess collects carbon. The takedown screw wants its hex wrench, and the recoil spring stays put during a normal clean — it is compressed in the bolt and comes out fast if uncontrolled. The 1,000-round deep clean is a rimfire community starting point, not S&W\u2019s figure.',
    links: [{ label: 'S&W SW22 Victory manual (PDF)', url: 'https://assets.contentstack.io/v3/assets/bltb61dcb3c40854cd9/blt617aba344182ac2d/636c0431358231185a7a8bdb/SW22_Victory_PC_3010478_080118.pdf' }]
  },

  // ---------- Rifles ----------
  {
    id: 'ref-dd', name: 'Daniel Defense', category: 'Rifle',
    maintenance: { deepCleanRounds: 5000, note: 'AR-pattern: lube beats scrubbing.' },
    checklist: [
      'Wipe and re-lube the bolt carrier group after each trip',
      'Check gas rings (bolt should not collapse under its own weight when stood on the bolt face)',
      'Clean the chamber and lugs with a chamber brush',
      'Inspect the extractor and ejector springs',
      'Check castle nut staking and optic mounts'
    ],
    guidance: 'AR-15s run fine dirty but not dry — generous lube on the bolt carrier group matters more than a spotless bore. Deep clean around 5,000 rounds: chamber, lugs, gas key, buffer tube. Replace gas rings and the extractor spring when they show wear.',
    links: [{ label: 'Daniel Defense support', url: 'https://danieldefense.com' }]
  },
  {
    id: 'ref-bcm', name: 'Bravo Company (BCM)', category: 'Rifle',
    maintenance: { deepCleanRounds: 5000, note: 'Mil-spec guidance: keep the BCG wet.' },
    checklist: [
      'Lube the bolt carrier group — four pads, cam pin, rings',
      'Wipe the inside of the upper receiver',
      'Chamber brush the chamber and locking lugs',
      'Inspect the action spring and buffer',
      'Check all witness marks on fasteners'
    ],
    guidance: 'BCM builds duty rifles and their advice matches the military’s: keep it lubed, shoot it, and do a proper cleaning around every 5,000 rounds. Watch the gas rings, extractor spring, and action spring as the round count climbs.',
    links: [{ label: 'BCM support', url: 'https://bravocompanyusa.com' }]
  },
  {
    /* Decision 49 (session 138): this guide's rimfire content moved to the new
       Ruger (10/22) guide; this one now serves the centerfire Ruger rifles that
       land on it under model-aware matching. Same id on purpose — guns link by
       id, so every existing link survives the rename. */
    id: 'ref-ruger-rifle', name: 'Ruger (Centerfire Rifle)', category: 'Rifle',
    maintenance: { deepCleanRounds: 2000, note: 'Ruger\u2019s own words: \u201cthere is no fixed rule\u201d — condition sets the schedule.' },
    checklist: [
      'Bore with solvent, brush and patches, finished with a dry patch; chamber wiped dry',
      'A drop of oil, very sparingly, at the bolt components, trigger pivots, safety, bolt stop and magazine latch — the American manual\u2019s own list',
      'On the AR-556, clear gas-system residue from the mechanism with solvent',
      'Never stretch or modify the buffer spring — the AR-556 manual\u2019s explicit caution',
      'Check action screw torque on bolt guns; scope base screws on everything'
    ],
    guidance: 'Ruger\u2019s centerfire manuals decline to give a schedule — the American Rifle manual says plainly that \u201cthere is no fixed rule as to how frequently the cleaning should be carried out\u201d — so condition decides: clean after each session, after any dust or moisture, and whenever accuracy or feeding says so. Bolt guns are mostly bore care, a dry chamber, and consistent action-screw torque; the AR-556 adds gas-system residue to the list and a firm warning to leave the buffer spring alone. Oil goes at the manual\u2019s named points, very sparingly. The 2,000-round deep clean here is a starting point, not Ruger\u2019s number.',
    links: [
      { label: 'Ruger American Rifle manual (PDF)', url: 'https://ruger-docs.s3.amazonaws.com/_manuals/americanRifle.pdf' },
      { label: 'Ruger AR-556 manual (PDF)', url: 'https://ruger-docs.s3.amazonaws.com/_manuals/AR-556-Mt92d8ha1p5g.pdf' }
    ]
  },
  {
    id: 'ref-sw-rifle', name: 'Smith & Wesson (Rifle)', category: 'Rifle',
    maintenance: { deepCleanRounds: 5000, note: 'M&P15 follows standard AR-pattern care.' },
    checklist: [
      'Lube the bolt carrier group after each trip',
      'Check gas rings and extractor spring',
      'Chamber brush the chamber and lugs',
      'Inspect the buffer and action spring',
      'Check handguard and optic fasteners'
    ],
    guidance: 'M&P15s are standard AR-pattern rifles: prioritize lube over scrubbing, deep clean around 5,000 rounds, and replace gas rings/extractor springs as wear appears.',
    links: [{ label: 'Smith & Wesson support', url: 'https://www.smith-wesson.com' }]
  },
  {
    id: 'ref-aero', name: 'Aero Precision', category: 'Rifle',
    maintenance: { deepCleanRounds: 5000, note: 'Builders’ platform — check YOUR parts list.' },
    checklist: [
      'Lube the bolt carrier group generously',
      'Verify gas key staking and gas block screws',
      'Chamber brush chamber and lugs',
      'Inspect springs: action, extractor, ejector',
      'Re-check torque on barrel nut and mounts after first 200 rounds'
    ],
    guidance: 'Aero rifles are often self-built, so the maintenance story depends on your parts. The AR fundamentals hold: wet bolt carrier group, deep clean near 5,000 rounds, and a hard look at fastener torque early in the rifle’s life.',
    links: [{ label: 'Aero Precision support', url: 'https://aeroprecisionusa.com' }]
  },
  {
    id: 'ref-ruger-1022', name: 'Ruger (10/22)', category: 'Rifle',
    models: ['10/22', '10-22', '1022'],
    maintenance: { deepCleanRounds: 1500, note: 'Ruger\u2019s focus is the chamber and extractor — \u201cas often as necessary.\u201d A feeding complaint is the rifle asking early.' },
    checklist: [
      'Clean the chamber — Ruger\u2019s manual makes it the first job, and rimfire fouling builds fast',
      'Clean the extractor \u201cas often as necessary to prevent the accumulation of grease and dirt\u201d',
      'Lightly oiled patch through the bore, then dry; light oil only on the action',
      'Read a failure to feed or extract as a dirty chamber before suspecting anything else',
      'Verify scope base screws are tight'
    ],
    guidance: 'Ruger\u2019s 10/22 manual points at two places: the chamber and the extractor, cleaned as often as necessary — and it names failures to feed or extract as the tell that necessary has arrived. Beyond that it is the standard Ruger rhythm: clean at regular intervals, after each range session, and after any dust or moisture, with oil light and sparing. The 1,500-round deep clean here is a common starting point for a 10/22 that gets regular chamber attention; the manual\u2019s own answer is condition, not a number.',
    links: [{ label: 'Ruger 10/22 manual (PDF)', url: 'https://ruger-docs.s3.amazonaws.com/_manuals/Ruger_1022.pdf' }]
  },
  {
    id: 'ref-sw-mp1522', name: 'Smith & Wesson (M&P15-22)', category: 'Rifle',
    models: ['M&P15-22', '15-22', 'MP15-22'],
    maintenance: { deepCleanRounds: 1000, note: 'S&W\u2019s own words: cleaning matters \u201ceven more\u201d on .22 rimfire rifles.' },
    checklist: [
      'Clean after firing — S&W flags rimfire rifles as needing more attention than centerfire',
      'Wipe the bolt and rails; leave a light film of oil on all metal parts, inside and out',
      'Run several boxes of quality ammunition before trusting it in a match — the manual\u2019s advice',
      'Use a lighter-weight oil in cold weather, per the manual',
      'Leave internal components alone beyond the manual\u2019s own steps'
    ],
    guidance: 'S&W says it directly: cleaning is essential, and \u201cthis is of even more importance with 22 rimfire caliber rifles.\u201d The care itself is simple — clean after firing, a light film of quality oil on all metal inside and out, lighter oil when it is cold. The manual also gives match shooters a genuinely useful instruction: put several boxes of good ammunition through the rifle before relying on it, because rimfire ignition earns trust rather than assuming it. No round count is published; the 1,000 here is a rimfire starting point, not S&W\u2019s.',
    links: [{ label: 'S&W M&P15-22 manual (PDF)', url: 'https://assets.contentstack.io/v3/assets/bltb61dcb3c40854cd9/blt484b89d2ae4eeadd/65d518a7bdb22a85b5c23612/M&P1522_Rifle_113022_3005746.pdf' }]
  },

  // ---------- Shotguns ----------
  {
    id: 'ref-remington', name: 'Remington', category: 'Shotgun',
    maintenance: { deepCleanRounds: 2000, note: '870s thrive on simple, regular care.' },
    checklist: [
      'Swab the bore and chamber after each outing',
      'Wipe carrier, bolt, and action bars; light oil',
      'Scrub the gas system (1100/V3) or action tube (870)',
      'Inspect the magazine spring and follower',
      'Check the barrel ring and magazine cap are snug'
    ],
    guidance: 'Pump guns like the 870 just need bore care and a wipe-down to run for generations. Gas autoloaders need their gas systems scrubbed on schedule. Shotgun fouling is heavy — deep clean by 2,000 rounds or after any wet outing.',
    links: [{ label: 'RemArms support', url: 'https://remarms.com' }]
  },
  {
    id: 'ref-mossberg', name: 'Mossberg', category: 'Shotgun',
    maintenance: { deepCleanRounds: 2000, note: '500/590 series: keep the action bars smooth.' },
    checklist: [
      'Swab bore and chamber after each outing',
      'Wipe action bars and elevator; light oil',
      'Check the cartridge interrupter and stop for fouling',
      'Inspect magazine spring and follower',
      'Verify stock and sling fasteners are tight'
    ],
    guidance: 'Mossberg pumps tolerate dirt but feel terrible when the action bars gum up — a wipe and light oil keeps them slick. Deep clean around 2,000 rounds, and check the elevator area where wads leave residue.',
    links: [{ label: 'Mossberg support', url: 'https://www.mossberg.com' }]
  },
  {
    id: 'ref-beretta', name: 'Beretta', category: 'Shotgun',
    maintenance: { deepCleanRounds: 2000, note: 'A300/A400 gas guns: the piston is the schedule.' },
    checklist: [
      'Swab bore; clean choke threads',
      'Pull and scrub the gas piston and cylinder',
      'Wipe and lightly oil the bolt and rails',
      'Inspect the recoil spring (in stock) per manual',
      'Grease hinge points on over/unders'
    ],
    guidance: 'Beretta gas autoloaders run soft but collect carbon in the piston — scrub it every few hundred rounds of heavy loads and deep clean by 2,000. Over/unders are simpler: bores, chokes, and a dab of grease on the hinge.',
    links: [{ label: 'Beretta support', url: 'https://www.beretta.com' }]
  },
  {
    id: 'ref-benelli', name: 'Benelli', category: 'Shotgun',
    maintenance: { deepCleanRounds: 2000, note: 'Inertia guns run clean — but not dry.' },
    checklist: [
      'Swab bore and chamber',
      'Wipe the bolt body and rotating head; light oil',
      'Clean the recoil spring tube per manual interval',
      'Inspect the inertia spring',
      'Check fore-end nut and choke tightness'
    ],
    guidance: 'Benelli’s inertia system stays remarkably clean, so most care is bore work and a lightly oiled bolt. The hidden chore is the recoil spring tube in the stock — clean it on the manual’s schedule or when cycling feels lazy. Deep clean by 2,000 rounds.',
    links: [{ label: 'Benelli USA support', url: 'https://www.benelliusa.com' }]
  },
  {
    id: 'ref-browning', name: 'Browning', category: 'Shotgun',
    maintenance: { deepCleanRounds: 2000, note: 'Citori hinges live on grease; A5s on clean rails.' },
    checklist: [
      'Swab bore; clean choke tubes and threads',
      'Grease the hinge pin and locking lug (over/unders)',
      'Wipe and oil action rails (autoloaders)',
      'Inspect ejectors and springs',
      'Check fore-end latch tension'
    ],
    guidance: 'Citori-style over/unders want clean bores and a thin film of grease on the hinge — that’s the whole secret to their longevity. Autoloaders follow gas/inertia care per the manual. Deep clean by 2,000 rounds.',
    links: [{ label: 'Browning support', url: 'https://www.browning.com' }]
  },

  // ---------- PCC ----------
  {
    id: 'ref-ruger-pcc', name: 'Ruger (PC Carbine)', category: 'PCC',
    models: ['PC Carbine', 'PC9'],
    maintenance: { deepCleanRounds: 2000, note: 'Ruger\u2019s one published number: verify charging-handle torque every 1,000 rounds.' },
    checklist: [
      'Verify charging-handle torque every 1,000 rounds, or whenever the handle comes off — Ruger\u2019s own interval',
      'Split at the takedown, lock the bolt back, and clean barrel assembly and action',
      'Light oil only; keep grease out of the chamber',
      'Check magazine follower tension frequently, per the manual',
      'Confirm optic screws are tight'
    ],
    guidance: 'The PC Carbine manual carries the standard Ruger rhythm — clean after each range session, at regular intervals, and after any dust or moisture — plus one genuinely numeric instruction: verify the charging-handle torque every 1,000 rounds, and any time the handle is removed. The takedown split is the whole field strip for routine cleaning. Ruger also asks for frequent checks of magazine follower tension. The 2,000-round deep clean is a starting point for a 9mm carbine; the 1,000-round torque check is Ruger\u2019s.',
    links: [{ label: 'Ruger PC Carbine manual (PDF)', url: 'https://ruger-docs.s3.amazonaws.com/_manuals/PC-Carbine.pdf' }]
  },
  {
    id: 'ref-jp-gmr15', name: 'JP Enterprises (GMR-15)', category: 'PCC',
    models: ['GMR-15', 'GMR15'],
    maintenance: { deepCleanRounds: 1000, note: 'JP publishes real numbers: oil the bolt every 200\u2013300 rounds in long sessions; inspect at 1,000\u20132,000.' },
    checklist: [
      'Oil the bolt and carrier before every use — low-to-medium viscosity oil, per JP',
      'On long sessions, re-oil the bolt through the ejection port every 200\u2013300 rounds — JP\u2019s figure',
      'Clean the compensator and crown after every use if possible; 9mm lead fouls them fast',
      'If fired, clean within 24 hours and recheck for corrosion a few days later — JP\u2019s instruction',
      'Inspect the captured-spring bumper and check anti-walk pins about every 1,000 rounds'
    ],
    guidance: 'JP\u2019s manual is specific, so this guide can be too: the bolt and carrier get oiled before every use, and on a long match or practice day re-oiled through the ejection port every 200 to 300 rounds. The compensator and crown want cleaning after every use because 9mm lead builds fast there. A fired gun gets cleaned within 24 hours, then rechecked for corrosion a few days on. Inspection of the captured-spring bumper and the anti-walk pins sits at about 1,000 rounds, with broader service in JP\u2019s 1,000\u20132,000-round window — the deep-clean number here is the bottom of JP\u2019s own range.',
    links: [{ label: 'JP GMR-15 manual (PDF)', url: 'https://www.jprifles.com/document_pdfs/JP%20GMR15%20Manual_806.pdf' }]
  },

  // ---------- Revolvers ----------
  {
    id: 'ref-sw-617', name: 'Smith & Wesson (Model 617)', category: 'Revolver',
    models: ['617'],
    maintenance: { deepCleanRounds: 1000, note: 'Sourced from S&W\u2019s revolver-family manual — S&W publishes no 617-specific document, and this guide says so.' },
    checklist: [
      'Clean the bore and every chamber of the cylinder after firing',
      'Scrub carbon off the cylinder face — rimfire builds it fast',
      'Light coat of quality gun oil on metal parts, internal and external, per the manual',
      'Use a lighter-weight oil in cold weather, per the manual',
      'Leave the internals closed — S&W routes internal work to a qualified gunsmith with genuine parts'
    ],
    guidance: 'S&W publishes one manual for this whole revolver family rather than a 617-specific document, so that family manual is the source here, and it sets no interval: clean before first use, after firing, and after any dust or moisture, then a light coat of quality oil inside and out. What the manual leaves unsaid, range experience adds and is labelled as such: a .22 revolver builds carbon on the cylinder face and in the chambers faster than centerfire, and sticky extraction is the usual first complaint. The 1,000-round deep clean is that community starting point, not an S&W figure.',
    links: [{ label: 'S&W revolver family manual (PDF)', url: 'https://assets.contentstack.io/v3/assets/bltb61dcb3c40854cd9/bltde0363f919659521/636c0539f5f6d3155a6cfe22/S&W_JKLN_Revolver_Manual_112119_416560000.pdf' }]
  }
];

export function getReference(id: string | null): ReferenceEntry | undefined {
  return id ? REFERENCES.find((r) => r.id === id) : undefined;
}

export function referencesForCategory(category: GunCategory): ReferenceEntry[] {
  return REFERENCES.filter((r) => r.category === category);
}

/** A user-made guide, dressed in the same shape as the built-ins. */
export function toEntry(r: Reference): ReferenceEntry {
  return {
    id: r.id, name: r.name, category: r.category,
    maintenance: {
      deepCleanRounds: r.deepCleanRounds,
      recoilSpringRounds: r.recoilSpringRounds ?? undefined,
      note: 'Your own guide.'
    },
    checklist: r.checklist,
    guidance: r.guidance,
    links: r.links
  };
}

export function isCustomRefId(id: string | null): boolean {
  return !!id && id.startsWith('refx');
}

/** One lookup over built-ins AND the user's own guides. */
export function buildRefLookup(custom: Reference[]): (id: string | null) => ReferenceEntry | undefined {
  return (id) => {
    if (!id) return undefined;
    if (isCustomRefId(id)) {
      const r = custom.find((c) => c.id === id);
      return r ? toEntry(r) : undefined;
    }
    return getReference(id);
  };
}

/** Lowercases, drops "(...)" notes, and collapses punctuation to spaces for loose name matching. */
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Pulls out parenthetical text (e.g. "(BCM)" -> "bcm"), normalized. */
function parentheticals(s: string): string[] {
  const out: string[] = [];
  const re = /\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const inner = normalizeName(m[1]);
    if (inner) out.push(inner);
  }
  return out;
}

/**
 * Suggests a maintenance guide whose name looks like it matches the gun's
 * manufacturer, scoped to its category (so the two Smith & Wesson guides
 * don't collide). Returns null if nothing looks like a fit — this powers a
 * one-tap suggestion, never an automatic link.
 */
export function suggestReferenceMatch(manufacturer: string, category: GunCategory, custom: Reference[], model?: string): ReferenceEntry | null {
  const make = normalizeName(manufacturer);
  if (!make) return null;
  const candidates = [...custom.filter((r) => r.category === category).map(toEntry), ...referencesForCategory(category)];
  /* Pass 1 — every guide whose NAME looks like the manufacturer, in candidate
     order (the shooter's own guides first). This is the original matching,
     kept byte-for-byte in spirit; what changed (decision 49) is only how a
     WINNER is picked from the matches. */
  const matches: ReferenceEntry[] = [];
  for (const r of candidates) {
    const base = normalizeName(r.name);
    if (make === base || parentheticals(r.name).includes(make)) { matches.push(r); continue; }
    if (make.length >= 3 && base.length >= 3 && (make.includes(base) || base.includes(make))) matches.push(r);
  }
  if (matches.length === 0) return null;
  /* Pass 2 — MODEL-AWARE pick (decision 49, session 138, Michael's 1a): a gun
     whose model text hits a guide's alias gets that guide; otherwise the
     manufacturer's GENERAL guide (the first match without a models list); and
     if the manufacturer only ships model-scoped guides, the first match stands
     — a one-tap suggestion, never an automatic link, so a near-miss costs one
     glance. Compact comparison so 10/22, 10-22 and 1022 are the same word. */
  const compact = (v: string) => normalizeName(v).replace(/ /g, '');
  const gunModel = compact(model ?? '');
  if (gunModel) {
    for (const r of matches) {
      if (r.models?.some((a) => { const c = compact(a); return c.length >= 3 && gunModel.includes(c); })) return r;
    }
  }
  return matches.find((r) => !r.models) ?? matches[0];
}
