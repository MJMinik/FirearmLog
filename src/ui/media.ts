// Turn stored photo bytes into something an <img> tag can show.
// URLs are cached so the same photo isn't rebuilt on every render.
import type { Media } from '../lib/types.ts';

const cache = new Map<string, string>();

export function mediaUrl(m: Media): string {
  let url = cache.get(m.id);
  if (!url) {
    url = URL.createObjectURL(new Blob([m.data], { type: m.mime }));
    cache.set(m.id, url);
  }
  return url;
}

/** P-2 (Reports-media diagnosis memo, 2026-08-24; fixed session 138): this
 *  cache held a live object URL for every photo ever viewed, forever — even
 *  after the record was deleted. Deletion paths call this so the browser can
 *  actually free the bytes. The db-layer cascade deletes (a gun taking its
 *  photos with it) don't reach up into this UI cache by design — those
 *  entries cost memory until the next full-cache clear or page load, which is
 *  bounded and beats the layering violation. */
export function revokeMediaUrl(id: string): void {
  const url = cache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    cache.delete(id);
  }
}

/** After a restore replaces every record, a cached URL can show a PRE-restore
 *  photo for a reused id — stale bytes, not just leaked ones. The restore's
 *  safe-zone caller clears the whole cache; renders rebuild URLs on demand. */
export function clearMediaUrlCache(): void {
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
}

/**
 * The accessible name for a media thumbnail. A video tile and a photo tile
 * used to be announced identically — the play badge fixes that for sighted
 * users, so the name has to carry the same fact for everyone else. It is only
 * appended when the shooter's own caption does not already say it, because
 * stage videos are routinely called things like "Stage 4 video" and
 * "Stage 4 video (video)" is worse than saying nothing.
 */
export function mediaLabel(m: Media): string {
  if (m.kind !== 'video') return m.name;
  return /video/i.test(m.name) ? m.name : `${m.name} (video)`;
}
