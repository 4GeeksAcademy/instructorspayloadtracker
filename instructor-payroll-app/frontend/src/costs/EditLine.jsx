import { useEffect, useState } from "react";
import client from "../api/client";
import { errText } from "./useCosts.jsx";

export const FREQS = ["Monthly", "Weekly", "Biweekly", "One-off", "Quarterly", "Yearly"];

// Category select with "+ New category…" — creates it on the server and selects it.
export function CategorySelect({ value, sections, onChange, onCreated, className = "", allowNew = true }) {
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [err, setErr] = useState("");
  if (creating) {
    return (
      <div className="newcat">
        <input autoFocus value={label} placeholder="New category name" onChange={(e) => setLabel(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), document.getElementById("newcat-ok")?.click())} />
        <button id="newcat-ok" type="button" className="primary sm" onClick={async () => {
          try {
            const r = await client.post("/costs/categories", { label });
            onCreated?.(r.data);
            onChange(r.data.key);
            setCreating(false);
            setLabel("");
          } catch (e) {
            setErr(errText(e));
          }
        }}>Add</button>
        <button type="button" className="secondary sm" onClick={() => setCreating(false)}>×</button>
        {err && <div className="small-muted" style={{ color: "var(--red)" }}>{err}</div>}
      </div>
    );
  }
  return (
    <select className={className} value={value || ""} onChange={(e) => (e.target.value === "__new" ? setCreating(true) : onChange(e.target.value))}>
      {sections.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      {value === "instructors_ref" && <option value="instructors_ref">Instructors (estimate)</option>}
      {allowNew && <option value="__new">+ New category…</option>}
    </select>
  );
}

const BLANK = {
  section: "people", division: "USA", department: "", name: "", amount: "", status: "Pendiente", method: "",
  frequency: "Monthly", paid_by: "4Geeks USA", priority: "", notes: "", due_date: "", paid_date: "", target_amount: "",
};

// Drawer to add a line, or edit the "structural" fields of one (name, category, role, notes, dates).
export default function EditLine({ entry, meta, periodLabel, onSave, onClose, onCategoryCreated, saving, error }) {
  const isNew = !entry?.id;
  const [d, setD] = useState(() => ({ ...BLANK, ...(entry || {}) }));
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const set = (k) => (e) => setD((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const submit = (e) => {
    e.preventDefault();
    const out = {
      ...d,
      amount: d.amount === "" ? 0 : Number(d.amount),
      target_amount: d.target_amount === "" || d.target_amount == null ? null : Number(d.target_amount),
      due_date: d.due_date || null,
      paid_date: d.paid_date || null,
      priority: d.priority || null,
      method: d.method || null,
    };
    onSave(out);
  };
  return (
    <div className="drawer-back" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <button className="drawer-x" onClick={onClose} aria-label="Close">×</button>
        <div className="small-muted">{periodLabel}</div>
        <h2>{isNew ? "New expense" : "Edit line"}</h2>
        <form onSubmit={submit} className="drawer-form">
          <div className="field"><label>Nombre completo / concepto</label><input value={d.name} onChange={set("name")} required autoFocus={isNew} /></div>
          <div className="field">
            <label>Category</label>
            <CategorySelect value={d.section} sections={meta.sections} onChange={set("section")} onCreated={onCategoryCreated} />
          </div>
          <div className="two">
            <div className="field"><label>Division</label>
              <select value={d.division || ""} onChange={set("division")}><option value="">—</option>{meta.divisions.map((x) => <option key={x}>{x}</option>)}</select></div>
            <div className="field"><label>Rol o departamento</label><input value={d.department || ""} onChange={set("department")} /></div>
          </div>
          <div className="two">
            <div className="field"><label>Monto</label><input type="number" step="0.01" value={d.amount} onChange={set("amount")} /></div>
            <div className="field"><label>Target (planned)</label><input type="number" step="0.01" value={d.target_amount ?? ""} onChange={set("target_amount")} /></div>
          </div>
          <div className="two">
            <div className="field"><label>Due date</label><input type="date" value={d.due_date || ""} onChange={set("due_date")} /></div>
            <div className="field"><label>Paid on</label><input type="date" value={d.paid_date || ""} onChange={set("paid_date")} /></div>
          </div>
          {isNew && (
            <>
              <div className="two">
                <div className="field"><label>Status</label>
                  <select value={d.status} onChange={set("status")}>{meta.statuses.map((x) => <option key={x}>{x}</option>)}</select></div>
                <div className="field"><label>Paga</label>
                  <select value={d.paid_by} onChange={set("paid_by")}>{meta.paid_by.map((x) => <option key={x}>{x}</option>)}</select></div>
              </div>
              <div className="two">
                <div className="field"><label>Método</label>
                  <select value={d.method || ""} onChange={set("method")}><option value="">—</option>{meta.methods.map((x) => <option key={x}>{x}</option>)}</select></div>
                <div className="field"><label>Frecuencia</label>
                  <select value={d.frequency || ""} onChange={set("frequency")}><option value="">—</option>{FREQS.map((x) => <option key={x}>{x}</option>)}</select></div>
              </div>
            </>
          )}
          <div className="field"><label>Notes</label><textarea rows={3} value={d.notes || ""} onChange={set("notes")} /></div>
          {error && <div className="banner">{error}</div>}
          <div className="actions">
            <button className="primary" disabled={saving || !d.name}>{saving ? "Saving…" : isNew ? "Add expense" : "Save"}</button>
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          </div>
          <p className="hint">Setting a "Paid on" date marks the line as Pagado.</p>
        </form>
      </aside>
    </div>
  );
}
