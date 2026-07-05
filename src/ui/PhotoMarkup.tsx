// Draw labeled circles on a photo. Drag on the image to draw a circle in the
// chosen color; each circle is auto-numbered and you type a label for it. Marks
// are stored as fractions (0..1) of the image so they scale to any size and to
// the printed report. Shared by every place a photo can be marked up (DRY).
import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { Sheet } from './Sheet.tsx';
import { Icon } from './Icon.tsx';
import { noAutofillProps } from './SuggestField.tsx';
import { newId } from '../lib/id.ts';
import type { Mark } from '../lib/types.ts';

const COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ffffff'];

interface Draft { cx: number; cy: number; rx: number; ry: number; }

export function PhotoMarkup({ url, initial, onSave, onClose }: {
  url: string;
  initial: Mark[];
  onSave: (marks: Mark[]) => void;
  onClose: () => void;
}) {
  const [marks, setMarks] = useState<Mark[]>(initial);
  const [color, setColor] = useState(COLORS[0]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  function at(e: PointerEvent<HTMLDivElement>): { x: number; y: number } {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }
  function down(e: PointerEvent<HTMLDivElement>): void {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const p = at(e);
    start.current = p;
    setDraft({ cx: p.x, cy: p.y, rx: 0, ry: 0 });
  }
  function move(e: PointerEvent<HTMLDivElement>): void {
    const s = start.current;
    if (!s) return;
    const p = at(e);
    setDraft({ cx: (s.x + p.x) / 2, cy: (s.y + p.y) / 2, rx: Math.abs(p.x - s.x) / 2, ry: Math.abs(p.y - s.y) / 2 });
  }
  function up(): void {
    if (draft && draft.rx > 0.015 && draft.ry > 0.015) {
      setMarks((m) => [...m, { id: newId('mk'), cx: draft.cx, cy: draft.cy, rx: draft.rx, ry: draft.ry, color, label: '' }]);
    }
    setDraft(null);
    start.current = null;
  }

  const shown: Mark[] = draft
    ? [...marks, { id: 'draft', cx: draft.cx, cy: draft.cy, rx: draft.rx, ry: draft.ry, color, label: '' }]
    : marks;

  return (
    <Sheet title="Mark up photo" onClose={onClose}>
      <div className="markup-colors">
        {COLORS.map((c) => (
          <button key={c} aria-label={`Pen color ${c}`}
            className={'markup-swatch' + (c === color ? ' on' : '')}
            style={{ background: c }} onClick={() => setColor(c)} />
        ))}
      </div>
      <div ref={boxRef} className="markup-canvas"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <img src={url} alt="" draggable={false} />
        {shown.map((mk, i) => (
          <div key={mk.id} className="markup-circle" style={{
            left: `${(mk.cx - mk.rx) * 100}%`, top: `${(mk.cy - mk.ry) * 100}%`,
            width: `${mk.rx * 2 * 100}%`, height: `${mk.ry * 2 * 100}%`, borderColor: mk.color,
          }}>
            {mk.id !== 'draft' && <span className="markup-num" style={{ background: mk.color }}>{i + 1}</span>}
          </div>
        ))}
      </div>
      <p className="report-note" style={{ marginTop: 8 }}>Drag on the photo to draw a circle, then label each one.</p>
      {marks.map((mk, i) => (
        <div key={mk.id} className="markup-row">
          <span className="markup-num" style={{ background: mk.color }}>{i + 1}</span>
          <input value={mk.label} placeholder="Label (e.g. Bill Drill)" {...noAutofillProps} name="mark-label"
            onChange={(e) => setMarks((m) => m.map((x) => (x.id === mk.id ? { ...x, label: e.target.value } : x)))} />
          <button className="thumb-x" style={{ position: 'static' }} aria-label="Remove circle"
            onClick={() => setMarks((m) => m.filter((x) => x.id !== mk.id))}><Icon name="close" size={16} /></button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {marks.length > 0 && (
          <button className="button secondary" style={{ flex: 1 }} onClick={() => setMarks((m) => m.slice(0, -1))}>Undo last</button>
        )}
        <button className="button" style={{ flex: 1 }} onClick={() => { onSave(marks); onClose(); }}>Done</button>
      </div>
    </Sheet>
  );
}
