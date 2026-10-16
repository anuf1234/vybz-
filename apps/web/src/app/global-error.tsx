"use client";

/** Last resort when the root layout itself fails. No app styles can be assumed here. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: "#0b0614", color: "#f4f0fb", fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100dvh", margin: 0 }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <p style={{ fontSize: 56, fontWeight: 700, color: "#8b5cf6", margin: 0 }}>500</p>
          <h1 style={{ fontSize: 24, margin: "8px 0" }}>VYBZ hit a problem</h1>
          <p style={{ color: "#a59cbb", fontSize: 14 }}>Try again in a moment.{error.digest ? ` Reference: ${error.digest}` : ""}</p>
          <button onClick={reset} style={{ marginTop: 16, background: "#8b5cf6", color: "white", border: 0, borderRadius: 999, padding: "10px 20px", fontWeight: 600 }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
