/** Curva suave: cuadrática a través de puntos medios, técnica clásica de sparklines. */
function buildSmoothPath(points: { x: number; y: number }[]): string {
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    const midX = (curr.x + next.x) / 2;
    const midY = (curr.y + next.y) / 2;
    d += ` Q ${curr.x},${curr.y} ${midX},${midY}`;
  }
  const last = points[points.length - 1];
  d += ` T ${last.x},${last.y}`;
  return d;
}

export function Sparkline({ points, id }: { points: number[]; id: string }) {
  if (points.length < 2) {
    return <span className="text-xs text-text-muted">—</span>;
  }

  const width = 84;
  const height = 28;
  const pad = 3;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = (width - pad * 2) / (points.length - 1);

  const coords = points.map((point, i) => ({
    x: pad + i * step,
    y: pad + (height - pad * 2) * (1 - (point - min) / range),
  }));

  const linePath = buildSmoothPath(coords);
  const areaPath = `${linePath} L ${coords[coords.length - 1].x},${height} L ${coords[0].x},${height} Z`;

  const trendingUp = points[points.length - 1] >= points[0];
  const color = trendingUp ? "var(--win)" : "var(--loss)";
  const gradientId = `sparkline-fill-${id}`;
  const last = coords[coords.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last.x} cy={last.y} r={2.25} fill={color} />
    </svg>
  );
}
