import { useState } from "react";
import { kmoney, money, shortMonth } from "./format";

// Monthly columns: net USA (solid brand blue) with gross as a pale back
// column. Projection months are hatched so actuals vs. forecasts read at a
// glance. Hover shows exact values.
export function MonthColumns({ months, height = 220, onPick, activeId }) {
  const [hover, setHover] = useState(null);
  if (!months?.length) return <div className="empty-state">No months yet.</div>;
  const max = Math.max(...months.map((m) => Math.max(m.gross, m.net_usa)), 1);
  const W = 640, H = height, padL = 44, padB = 28, padT = 14;
  const innerW = W - padL - 8, innerH = H - padB - padT;
  const step = innerW / months.length;
  const colW = Math.min(46, step * 0.62);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const y = (v) => padT + innerH - (v / max) * innerH;
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label="Monthly costs">
        <defs>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--blue)" opacity="0.55" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#fff" strokeWidth="2.2" opacity="0.7" />
          </pattern>
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray={i ? "3 4" : ""} />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="chart-tick">{kmoney(t)}</text>
          </g>
        ))}
        {months.map((m, i) => {
          const cx = padL + step * i + step / 2;
          const proj = m.projection_count > 0 && m.projection_count >= m.entry_count / 2;
          const active = activeId === m.period_id;
          return (
            <g key={m.period_id} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
               onClick={() => onPick?.(m.period_id)} style={{ cursor: onPick ? "pointer" : "default" }}>
              <rect x={cx - colW / 2} y={y(m.gross)} width={colW} height={Math.max(innerH - (y(m.gross) - padT), 0)}
                    rx="6" fill="var(--blue-soft)" />
              <rect x={cx - colW / 2 + 6} y={y(m.net_usa)} width={colW - 12}
                    height={Math.max(innerH - (y(m.net_usa) - padT), 0)} rx="5"
                    fill={proj ? "url(#hatch)" : "var(--blue)"} stroke={active ? "var(--ink)" : "none"} strokeWidth="1.5" />
              <text x={cx} y={H - 9} textAnchor="middle" className={`chart-tick${active ? " strong" : ""}`}>
                {shortMonth(m.label)}
              </text>
              <rect x={cx - step / 2} y={padT} width={step} height={innerH} fill="transparent" />
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="chart-tip" style={{ left: `${((padL + step * hover + step / 2) / W) * 100}%` }}>
          <strong>{months[hover].label}</strong>
          <div>Net USA {money(months[hover].net_usa)}</div>
          <div className="small-muted">Gross {money(months[hover].gross)}</div>
          {months[hover].projection_count > 0 && <div className="small-muted">{months[hover].projection_count} projected lines</div>}
          {months[hover].month_confirmed && <div className="small-muted">Confirmed ✓</div>}
        </div>
      )}
      <div className="chart-legend">
        <span><i style={{ background: "var(--blue)" }} /> Net cost to 4Geeks USA</span>
        <span><i style={{ background: "var(--blue-soft)" }} /> Gross (incl. Spain/LATAM paid)</span>
        <span><i className="hatch" /> Projection</span>
      </div>
    </div>
  );
}

// Tiny trend line for tables / drawers.
export function Sparkline({ values, width = 120, height = 32, highlight }) {
  const vals = values.map(Number);
  if (vals.length < 2) return null;
  const max = Math.max(...vals), min = Math.min(...vals, 0);
  const span = max - min || 1;
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * (width - 6) + 3, height - 4 - ((v - min) / span) * (height - 8)]);
  return (
    <svg width={width} height={height} className="spark">
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={i === highlight ? 3.5 : 2} fill={i === highlight ? "var(--ink)" : "var(--blue)"} />
      ))}
    </svg>
  );
}

// Who pays the gross: one stacked bar, direct-labeled underneath.
export function SplitBar({ parts }) {
  const total = parts.reduce((s, p) => s + Math.max(p.value, 0), 0) || 1;
  const shades = ["var(--blue)", "#7fb3ff", "#bcd7ff", "var(--amber)", "var(--muted)"];
  return (
    <div>
      <div className="split-bar">
        {parts.map((p, i) => (
          <div key={p.label} title={`${p.label}: ${money(p.value)}`}
               style={{ width: `${(Math.max(p.value, 0) / total) * 100}%`, background: shades[i % shades.length] }} />
        ))}
      </div>
      <div className="split-legend">
        {parts.map((p, i) => (
          <div key={p.label}>
            <i style={{ background: shades[i % shades.length] }} />
            <span>{p.label}</span>
            <strong>{money(p.value)}</strong>
            <span className="small-muted">{Math.round((Math.max(p.value, 0) / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Diverging delta bar for Compare: right = more expensive, left = cheaper.
export function DeltaBar({ value, max }) {
  const w = max ? Math.min(Math.abs(value) / max, 1) * 50 : 0;
  return (
    <div className="delta-track">
      <div className="delta-mid" />
      <div className={`delta-fill ${value > 0 ? "up" : "down"}`}
           style={value > 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />
    </div>
  );
}
