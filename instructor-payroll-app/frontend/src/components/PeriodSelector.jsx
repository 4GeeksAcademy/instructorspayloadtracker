export default function PeriodSelector({ periods, value, onChange }) {
  return (
    <div className="field" style={{ maxWidth: 260, marginBottom: 20 }}>
      <label>Pay period</label>
      <select value={value || ""} onChange={(e) => onChange(Number(e.target.value))}>
        {periods.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </div>
  );
}
