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
