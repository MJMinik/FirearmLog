// A3 (batch 2): the ONE tappable match-summary row — name (or match type) with a
// date · division sub-line, and the match percent or division place on the right.
// Extracted because the Compete tab's Matches card and the Log screen's filtered
// Matches card rendered this identical row verbatim; a single component keeps the
// two reading as one system (and one place to change the shape).
import type { Match } from '../lib/types.ts';
import { formatDayKey } from '../lib/dates.ts';

export function MatchRow({ match, onTap }: { match: Match; onTap: () => void }) {
  return (
    <button className="row-tap" onClick={onTap}>
      <span className="label">
        {match.name || match.matchType}
        <div className="row-sub">{formatDayKey(match.date)} · {match.division}</div>
      </span>
      <span className="value">
        {match.matchPercent != null
          ? `${match.matchPercent}%`
          : match.divisionPlace != null
            ? `#${match.divisionPlace}`
            : '›'}
      </span>
    </button>
  );
}
