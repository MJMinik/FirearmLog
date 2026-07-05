// Reference library (spec §9) — maintenance guidance for the 15 approved
// manufacturers plus Atlas Gunworks. Ships with the app (read-only for now).
// Intervals are widely used starting points, NOT gospel — the owner's manual
// always wins, and every gun can be customized on its own page.

import type { GunCategory, Reference } from './types.ts';

export interface ReferenceEntry {
  id: string;
  name: string;
  category: GunCategory;
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
    id: 'ref-ruger-rifle', name: 'Ruger (Rifle)', category: 'Rifle',
    maintenance: { deepCleanRounds: 4000, note: '10/22s and bolt guns appreciate cleaner chambers than ARs.' },
    checklist: [
      'Clean the chamber — rimfire fouling builds fast',
      'Wipe the bolt and lube contact points lightly',
      'Inspect the extractor claw (10/22)',
      'Check action screws torque on bolt guns',
      'Verify scope base screws are tight'
    ],
    guidance: 'For 10/22s, the chamber and extractor do most of the complaining — keep them clean and the rifle runs forever. Bolt guns mostly need bore care and consistent action screw torque. Deep clean by about 4,000 rounds, sooner for rimfire.',
    links: [{ label: 'Ruger support', url: 'https://ruger.com' }]
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
export function suggestReferenceMatch(manufacturer: string, category: GunCategory, custom: Reference[]): ReferenceEntry | null {
  const make = normalizeName(manufacturer);
  if (!make) return null;
  const candidates = [...custom.filter((r) => r.category === category).map(toEntry), ...referencesForCategory(category)];
  for (const r of candidates) {
    const base = normalizeName(r.name);
    if (make === base || parentheticals(r.name).includes(make)) return r;
    if (make.length >= 3 && base.length >= 3 && (make.includes(base) || base.includes(make))) return r;
  }
  return null;
}
