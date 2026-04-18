// chart.jsx — Minimal SVG line/bar chart. No dependencies.
// Usage: <LineChart series={[{label, color, points:[{x, y}]}]} xLabels={[...]}/>

function LineChart({ series = [], xLabels = [], height = 160, valueLabel = '' }) {
  const pad = { top: 18, right: 12, bottom: 24, left: 32 };
  const W = 560, H = height;
  const iw = W - pad.left - pad.right;
  const ih = H - pad.top - pad.bottom;

  const allY = series.flatMap(s => s.points.map(p => p.y));
  const maxY = Math.max(1, ...allY);
  const maxX = Math.max(1, ...series.flatMap(s => s.points.length - 1));

  const xScale = (i) => pad.left + (maxX === 0 ? iw / 2 : (i / maxX) * iw);
  const yScale = (v) => pad.top + ih - (v / maxY) * ih;

  const gridY = [0, 0.25, 0.5, 0.75, 1].map(r => maxY * r);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ fontFamily: 'system-ui' }}>
      {gridY.map((v, i) => {
        const y = yScale(v);
        return (
          <g key={i}>
            <line x1={pad.left} x2={W - pad.right} y1={y} y2={y} stroke="#E8E2D6" strokeDasharray="3 3"/>
            <text x={pad.left - 6} y={y + 3} fontSize="9" fill="#8F877C" textAnchor="end">{Math.round(v)}</text>
          </g>
        );
      })}
      {series.map((s, si) => {
        if (!s.points.length) return null;
        const path = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)} ${yScale(p.y).toFixed(1)}`).join(' ');
        return (
          <g key={si}>
            <path d={path} fill="none" stroke={s.color || '#1F1B17'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            {s.points.map((p, i) => (
              <circle key={i} cx={xScale(i)} cy={yScale(p.y)} r="2.5" fill={s.color || '#1F1B17'}/>
            ))}
          </g>
        );
      })}
      {xLabels.map((l, i) => {
        if (i !== 0 && i !== xLabels.length - 1 && i !== Math.floor(xLabels.length / 2)) return null;
        return (
          <text key={i} x={xScale(i)} y={H - 8} fontSize="9" fill="#8F877C" textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}>{l}</text>
        );
      })}
      {series.length > 1 && (
        <g transform={`translate(${pad.left}, ${pad.top - 6})`}>
          {series.map((s, i) => (
            <g key={i} transform={`translate(${i * 80}, 0)`}>
              <rect width="8" height="8" fill={s.color || '#1F1B17'} rx="2"/>
              <text x="12" y="7" fontSize="10" fill="#3E3A34">{s.label}</text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

window.LineChart = LineChart;
