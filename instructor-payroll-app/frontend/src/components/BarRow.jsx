// Single-hue magnitude bar with a direct label and value -- per the dataviz
// method, a ranked-magnitude comparison doesn't need categorical hue
// diversity when every row is already labeled. Keeps every bar on-brand
// (blue is the only saturated color used at scale).
export default function BarRow({ label, value, max, formatValue, sub }) {
  const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 2 : 0) : 0;
  return (
    <div className="bar-row">
      <div className="bar-label" title={label}>{label}</div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div>
        <div className="bar-value">{formatValue ? formatValue(value) : value}</div>
        {sub && <div className="bar-sub">{sub}</div>}
      </div>
    </div>
  );
}
