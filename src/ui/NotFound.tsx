// M7: a record opened by a stale id (deleted, or a dead deep-link) must land on a
// clear "this no longer exists" screen with a way back — never an endless blank
// spinner. Shared by the match and gun detail screens.
export function NotFound({ what, onBack }: { what: string; onBack: () => void }) {
  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
      </div>
      <div className="card">
        <p className="empty">{what}</p>
      </div>
    </div>
  );
}
