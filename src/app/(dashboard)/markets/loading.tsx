export default function Loading() {
  return (
    <div style={{ padding: 24, color: "#9ca3af" }}>
      <h1 style={{ fontSize: 22, marginBottom: 16, color: "#e5e7eb" }}>Markets</h1>
      {[72, 120, 56, 160, 220].map((h, i) => (
        <div
          key={i}
          style={{
            height: h,
            background: "#0d131c",
            border: "1px solid #1f2937",
            borderRadius: 8,
            marginBottom: 20,
          }}
        />
      ))}
    </div>
  )
}
