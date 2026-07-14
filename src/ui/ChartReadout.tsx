// F4: the one readout line under every tappable chart. Never invisible —
// Michael's condition on the tap-readout decision (session 62): the user is
// TOLD how to see the numbers, right where it works. Starts as a dim hint;
// a tap on a mark replaces it with the real date + value. aria-live so a
// screen reader hears the readout change too.
export function ChartReadout({ value, hint }: { value: string | null; hint: string }) {
  return (
    <p className="report-note chart-readout" aria-live="polite" style={{ marginTop: 6 }}>
      {value ?? hint}
    </p>
  );
}
