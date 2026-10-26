// Shown at once while a portal page reads the database (file 04 section 6: loading state).
// The sidebar and top bar stay on screen; only the content area waits.
export default function Loading() {
  return (
    <div className="card" role="status" aria-live="polite">
      <p className="muted" style={{ margin: 0 }}>
        Loading…
      </p>
    </div>
  );
}
