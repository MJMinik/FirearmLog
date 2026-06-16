// Read-only display of a photo with its drawn labeled circles + a legend below.
// Used wherever a marked-up photo is shown (PhotoSheet, NewPhotoSheet preview).
import type { Mark } from '../lib/types.ts';

export function MarkedImage({ url, alt, marks }: { url: string; alt: string; marks: Mark[] }) {
  return (
    <>
      <div className="markup-canvas">
        <img src={url} alt={alt} />
        {marks.map((mk, i) => (
          <div key={mk.id} className="markup-circle" style={{
            left: `${(mk.cx - mk.rx) * 100}%`, top: `${(mk.cy - mk.ry) * 100}%`,
            width: `${mk.rx * 2 * 100}%`, height: `${mk.ry * 2 * 100}%`, borderColor: mk.color,
          }}>
            <span className="markup-num" style={{ background: mk.color }}>{i + 1}</span>
          </div>
        ))}
      </div>
      {marks.some((m) => m.label.trim()) && (
        <ol className="markup-legend">
          {marks.map((mk) => <li key={mk.id}>{mk.label.trim() || '(unlabeled)'}</li>)}
        </ol>
      )}
    </>
  );
}
