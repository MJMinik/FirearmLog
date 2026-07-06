// Shared multi-division classification grid — every division you hold a class in,
// shown as class + average% + division. Used on Home (read-only, a glance) and on
// Compete (selectable — tap a division to see its progress detail below). DRY: one
// source of truth so the two screens can never drift apart.
import type { ClassProgress } from '../lib/competition.ts';

export type DivisionClass = ClassProgress & { division: string };

export function ClassificationGrid({ divisions, selected, onSelect }: {
  divisions: DivisionClass[];
  /** When set, cells become buttons; the matching cell is highlighted. */
  selected?: string;
  onSelect?: (division: string) => void;
}) {
  if (divisions.length === 0) return null;
  return (
    <div className="stat-grid classification-grid">
      {divisions.map((d) => {
        const inner = (
          <>
            <div className="num">
              {d.currentClass}
              <span style={{ fontSize: 15, color: 'var(--text-dim)', marginLeft: 6 }}>
                {d.average?.toFixed(1)}%
              </span>
            </div>
            <div className="cap">{d.division}</div>
          </>
        );
        if (!onSelect) {
          return <div className="stat" key={d.division}>{inner}</div>;
        }
        return (
          <button
            type="button"
            className={`stat stat-tap${selected === d.division ? ' on' : ''}`}
            key={d.division}
            aria-pressed={selected === d.division}
            aria-label={`${d.division}: ${d.currentClass} class, ${d.average?.toFixed(1)} percent`}
            onClick={() => onSelect(d.division)}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
