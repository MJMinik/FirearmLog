// A grid thumbnail. For a marked-up photo it overlays the drawn circles (no
// labels — just the circles, so you can see at a glance what's marked); the
// image keeps its natural aspect so the % positioned circles line up. Plain
// photos and videos render as the usual square cover thumbnail.
import type { Media } from '../lib/types.ts';
import { mediaUrl } from './media.ts';
import { VideoFrame } from './VideoFrame.tsx';

export function MarkThumb({ media }: { media: Media }) {
  const marks = media.marks ?? [];
  if (media.kind === 'video') {
    return <VideoFrame src={mediaUrl(media)} showBadge label={media.name} />;
  }
  if (marks.length === 0) {
    return <img src={mediaUrl(media)} alt={media.name} loading="lazy" />;
  }
  return (
    <span className="mark-thumb">
      <img src={mediaUrl(media)} alt={media.name} loading="lazy" />
      {marks.map((mk) => (
        <span key={mk.id} className="markup-circle" style={{
          left: `${(mk.cx - mk.rx) * 100}%`, top: `${(mk.cy - mk.ry) * 100}%`,
          width: `${mk.rx * 2 * 100}%`, height: `${mk.ry * 2 * 100}%`, borderColor: mk.color,
        }} />
      ))}
    </span>
  );
}
