export default function Loading() {
  return (
    <div style={{ padding: 24, color: "#9ca3af" }}>
      <h1 className="text-sm font-medium tracking-[0.15em] text-primary uppercase mb-4">Markets</h1>
      {[72, 120, 56, 160, 220].map((h, i) => (
        <div
          key={i}
          className="animate-pulse rounded border mb-5"
          style={{ height: h, background: "var(--card)" }}
        />
      ))}
    </div>
  )
}
