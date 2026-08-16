export function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) {
    return <span className="text-xs text-text-muted">—</span>;
  }

  const width = 72;
  const height = 24;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = width / (points.length - 1);

  const path = points
    .map((point, i) => {
      const x = i * step;
      const y = height - ((point - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const trendingUp = points[points.length - 1] >= points[0];
  const color = trendingUp ? "var(--win)" : "var(--loss)";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
