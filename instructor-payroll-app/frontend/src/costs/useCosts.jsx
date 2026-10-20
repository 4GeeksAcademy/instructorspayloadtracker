import { useCallback, useEffect, useMemo, useState } from "react";
import client from "../api/client";

const KEY = "costs_period_id";

function readSaved() {
  try {
    return Number(localStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
}

// Loads meta + month totals once per page and remembers the chosen month.
export function useCosts() {
  const [meta, setMeta] = useState(null);
  const [periods, setPeriods] = useState([]); // newest first
  const [periodId, setPeriodIdState] = useState(readSaved);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const [m, p] = await Promise.all([client.get("/costs/meta"), client.get("/costs/periods")]);
      setMeta(m.data);
      setPeriods(p.data);
      setPeriodIdState((cur) => {
        if (cur && p.data.some((x) => x.period_id === cur)) return cur;
        const today = new Date().toISOString().slice(0, 10);
        const current = p.data.find((x) => x.start_date <= today && x.entry_count > 0) || p.data[0];
        return current?.period_id || null;
      });
      setError("");
    } catch (e) {
      setError(e.response?.data?.detail || "Could not load the Costs Hub");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const setPeriodId = (id) => {
    setPeriodIdState(id);
    try {
      localStorage.setItem(KEY, String(id));
    } catch {
      /* per-viewer convenience only */
    }
  };

  const period = periods.find((p) => p.period_id === periodId) || null;
  const previous = useMemo(() => {
    const i = periods.findIndex((p) => p.period_id === periodId);
    return i >= 0 ? periods.slice(i + 1).find((p) => p.entry_count > 0) || null : null;
  }, [periods, periodId]);
  const sectionLabel = useMemo(() => {
    const out = { instructors: "Instructors", instructors_ref: "Instructors (estimate)" };
    (meta?.sections || []).forEach((s) => (out[s.key] = s.label));
    return out;
  }, [meta]);

  return { meta, periods, period, previous, periodId, setPeriodId, reload, loading, error, sectionLabel };
}

export function MonthPicker({ periods, value, onChange, label = "Month" }) {
  return (
    <div className="field month-picker">
      <label>{label}</label>
      <select value={value || ""} onChange={(e) => onChange(Number(e.target.value))}>
        {periods.map((p) => (
          <option key={p.period_id} value={p.period_id}>
            {p.label}
            {p.month_confirmed ? " ✓" : p.projection_count > 0 && p.projection_count >= p.entry_count / 2 ? " (projection)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

export function MonthBadge({ period }) {
  if (!period) return null;
  if (period.month_confirmed) return <span className="pill paid">Confirmed by Marcelo</span>;
  if (period.projection_count > 0 && period.projection_count >= period.entry_count / 2)
    return <span className="pill submitted">Projection</span>;
  return <span className="pill admin_reviewed">Open — editable</span>;
}

export function errText(e, fallback = "Something went wrong") {
  const d = e?.response?.data?.detail;
  if (Array.isArray(d)) return d.map((x) => x.msg).join("; ");
  return d || fallback;
}
