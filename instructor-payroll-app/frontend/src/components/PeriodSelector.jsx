import { useState } from "react";

export default function PeriodSelector({ periods, value, onChange, canCreate = false, onCreate }) {
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!label || !startDate || !endDate) return;
    setSaving(true);
    setError("");
    try {
      await onCreate({ label, start_date: startDate, end_date: endDate });
      setLabel("");
      setStartDate("");
      setEndDate("");
      setShowForm(false);
    } catch (err) {
      setError(err.response?.data?.detail || "Could not create period");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
        <div className="field" style={{ maxWidth: 260, marginBottom: 0 }}>
          <label>Pay period</label>
          <select value={value || ""} onChange={(e) => onChange(Number(e.target.value))}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        {canCreate && !showForm && (
          <button type="button" className="secondary" onClick={() => setShowForm(true)}>
            + New period
          </button>
        )}
      </div>

      {canCreate && showForm && (
        <form
          onSubmit={submit}
          style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginTop: 12 }}
        >
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Label</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="September 2026"
              style={{ width: 170 }}
              required
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Start date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>End date</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
          </div>
          <button className="primary" disabled={saving}>
            {saving ? "Creating…" : "Create period"}
          </button>
          <button type="button" className="secondary" onClick={() => setShowForm(false)}>
            Cancel
          </button>
        </form>
      )}
      {error && (
        <div className="banner" style={{ marginTop: 12, marginBottom: 0 }}>
          {error}
        </div>
      )}
    </div>
  );
}
