// Shared loading + error states for a screen, so every screen fails the SAME
// safe, recoverable way instead of hanging blank (pro-grade audit T1-1).

// A quiet placeholder while a screen's data loads. Matches the old
// `<div className="screen" />` blank, kept as one component for consistency.
export function ScreenLoading() {
  return <div className="screen" aria-busy="true" />;
}

// A recoverable error card: tells the user their data is safe and offers Retry.
// Never leaves them stranded on a blank screen.
export function ScreenError({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="screen">
      <div className="card">
        <h2>Couldn't load this screen</h2>
        <p className="report-note" style={{ marginBottom: 12 }}>
          Something didn't finish loading. Your saved data is safe on this device — this is
          usually a momentary hiccup.
        </p>
        {onRetry && (
          <button className="button" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
