import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import client from "../api/client";
import { money, SECTION_ORDER, STATUS_TONE, downloadCsv } from "./format";
import { useCosts, MonthPicker, MonthBadge, errText } from "./useCosts.jsx";
import LineInsight from "./LineInsight.jsx";

const BLANK = {
  section: "people", division: "USA", department: "", name: "", amount: "", status: "Pendiente",
  method: "", frequency: "Monthly", paid_by: "4Geeks USA", priority: "", notes: "",
};
const FREQS = ["Monthly", "Weekly", "Biweekly", "One-off", "Quarterly", "Yearly"];

function Select({ value, options, onChange, blank }) {
  return (
    <select className="cell-input" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      {blank && <option value="">—</option>}
      {options.map((o) => (typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.key} value={o.key}>{o.label}</option>))}
    </select>
  );
}

function EditRow({ draft, setDraft, meta, onSave, onCancel, saving, isNew }) {
  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <tr className="row-editing">
      <td />
      <td><Select value={draft.division} options={meta.divisions} onChange={set("division")} blank /></td>
      <td><input className="cell-input" value={draft.department || ""} onChange={(e) => set("department")(e.target.value)} placeholder="Rol / departamento" /></td>
      <td>
        <input className="cell-input" value={draft.name} onChange={(e) => set("name")(e.target.value)} placeholder="Nombre completo / concepto" autoFocus />
        <input className="cell-input" style={{ marginTop: 6 }} value={draft.notes || ""} onChange={(e) => set("notes")(e.target.value)} placeholder="Notes (optional)" />
        {isNew && (
          <div style={{ marginTop: 6 }}>
            <Select value={draft.section} options={meta.sections} onChange={set("section")} />
          </div>
        )}
      </td>
      <td><input className="cell-input num" type="number" step="0.01" value={draft.amount} onChange={(e) => set("amount")(e.target.value)} /></td>
      <td><Select value={draft.status} options={meta.statuses} onChange={set("status")} /></td>
      <td><Select value={draft.method} options={meta.methods} onChange={set("method")} blank /></td>
      <td><Select value={draft.frequency} options={FREQS} onChange={set("frequency")} blank /></td>
      <td><Select value={draft.paid_by} options={meta.paid_by} onChange={set("paid_by")} /></td>
      <td><Select value={draft.priority} options={meta.priorities} onChange={set("priority")} blank /></td>
      <td className="row-actions">
        <button className="primary sm" disabled={saving || !draft.name} onClick={onSave}>{saving ? "…" : "Save"}</button>
        <button className="secondary sm" onClick={onCancel}>Cancel</button>
      </td>
    </tr>
  );
}

export default function CostsEntries() {
  const { meta, periods, period, periodId, setPeriodId, reload, loading, error, sectionLabel } = useCosts();
  const [entries, setEntries] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [f, setF] = useState({ section: "", division: "", status: "", paid_by: "", priority: "", q: "" });
  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [adding, setAdding] = useState(false);
  const [insightFor, setInsightFor] = useState(null);
  const [showLog, setShowLog] = useState(false);
  const [log, setLog] = useState([]);

  const load = () =>
    periodId && client.get(`/costs/entries?period_id=${periodId}`).then((r) => setEntries(r.data));
  useEffect(() => {
    setEditId(null);
    setAdding(false);
    load();
  }, [periodId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (showLog && periodId) client.get(`/costs/log?period_id=${periodId}`).then((r) => setLog(r.data));
  }, [showLog, periodId, entries]);

  const owner = !!meta?.is_owner;
  const locked = !!period?.month_confirmed;
  const canEditMonth = !!meta?.can_edit && (!locked || owner);
  const canEditLine = (e) => canEditMonth && (!e.confirmed || owner);

  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (!f.section || e.section === f.section) &&
        (!f.division || e.division === f.division) &&
        (!f.status || e.status === f.status) &&
        (!f.paid_by || e.paid_by === f.paid_by) &&
        (!f.priority || e.priority === f.priority) &&
        (!q || `${e.name} ${e.department || ""} ${e.notes || ""}`.toLowerCase().includes(q))
    );
  }, [entries, f]);

  const groups = useMemo(() => {
    const order = [...SECTION_ORDER, "instructors_ref"];
    const by = {};
    filtered.forEach((e) => (by[e.section] = by[e.section] || []).push(e));
    return Object.keys(by)
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .map((k) => ({ key: k, rows: by[k].sort((a, b) => Number(b.amount) - Number(a.amount)) }));
  }, [filtered]);

  const total = filtered.reduce((s, e) => s + Number(e.amount), 0);
  const totalUsa = filtered.filter((e) => e.paid_by === "4Geeks USA").reduce((s, e) => s + Number(e.amount), 0);

  async function run(fn, ok) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ ok: true, text: ok });
      await Promise.all([load(), reload()]);
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  const clean = (d) => ({ ...d, amount: d.amount === "" ? 0 : Number(d.amount), priority: d.priority || null, method: d.method || null });
  const saveEdit = () => run(async () => { await client.patch(`/costs/entries/${editId}`, clean(draft)); setEditId(null); });
  const saveNew = () => run(async () => { await client.post("/costs/entries", { ...clean(draft), period_id: periodId }); setAdding(false); }, "Line added.");
  const del = (e) => window.confirm(`Delete “${e.name}”?`) && run(() => client.delete(`/costs/entries/${e.id}`));
  const toggleConfirm = (e) => run(() => client.post(`/costs/entries/${e.id}/${e.confirmed ? "unconfirm" : "confirm"}`));
  const confirmMonth = () =>
    window.confirm(`Confirm ${period.label}? All lines lock and Kevin can no longer edit them.`) &&
    run(() => client.post(`/costs/periods/${periodId}/confirm`), `${period.label} confirmed and locked.`);
  const unlockMonth = () => run(() => client.post(`/costs/periods/${periodId}/unlock?unconfirm_lines=true`), "Month unlocked.");
  const copyForward = async () => {
    setBusy(true);
    setMsg(null);
    try {
      let r;
      try {
        r = await client.post(`/costs/periods/${periodId}/copy-forward`);
      } catch (e) {
        if (e.response?.status === 400 && window.confirm(`${errText(e)}\n\nReplace the next month's lines with a fresh copy of ${period.label}?`)) {
          r = await client.post(`/costs/periods/${periodId}/copy-forward?replace=true`);
        } else throw e;
      }
      await reload();
      setMsg({ ok: true, text: `${r.data.lines} lines copied to ${r.data.target_label} as projections.` });
    } catch (e) {
      if (e.response?.status !== 400) setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  const exportCsv = () =>
    downloadCsv(`costs-${period.label.replace(" ", "-")}.csv`, [
      ["Mes", "Sección", "Division", "Rol o Departamento", "Nombre completo", "Monto", "Status", "Método", "Frecuencia", "Paga", "Priority", "Confirmado", "Notas"],
      ...filtered.map((e) => [period.label, sectionLabel[e.section] || e.section, e.division, e.department, e.name, Number(e.amount).toFixed(2), e.status, e.method, e.frequency, e.paid_by, e.priority, e.confirmed ? "Sí" : "No", e.notes]),
    ]);

  if (loading || !meta) return <div className="empty-state">Loading…</div>;
  if (error) return <div className="banner">{error}</div>;

  const instructorsTotal = period?.by_section?.instructors || 0;
  const fset = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Monthly <em>costs</em></h1>
          <p className="subhead">Same fields as the sheet. Kevin edits until Marcelo confirms the month.</p>
        </div>
        <div className="page-head-tools">
          <MonthPicker periods={periods} value={periodId} onChange={setPeriodId} />
          <MonthBadge period={period} />
        </div>
      </div>

      {locked && (
        <div className="banner info">
          {period.label} is confirmed by Marcelo. {owner ? "You can still edit, or unlock the month." : "It's read only now — ask Marcelo to unlock it if something changed."}
        </div>
      )}
      {msg && <div className={`banner${msg.ok ? " ok" : ""}`}>{msg.text}</div>}

      <div className="toolbar">
        <div className="filters">
          <input placeholder="Search name, role, notes…" value={f.q} onChange={fset("q")} />
          <select value={f.section} onChange={fset("section")}>
            <option value="">All categories</option>
            {meta.sections.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            <option value="instructors_ref">Instructors (estimate)</option>
          </select>
          <select value={f.division} onChange={fset("division")}>
            <option value="">All divisions</option>
            {meta.divisions.map((d) => <option key={d}>{d}</option>)}
          </select>
          <select value={f.status} onChange={fset("status")}>
            <option value="">All status</option>
            {meta.statuses.map((d) => <option key={d}>{d}</option>)}
          </select>
          <select value={f.paid_by} onChange={fset("paid_by")}>
            <option value="">Anyone pays</option>
            {meta.paid_by.map((d) => <option key={d}>{d}</option>)}
          </select>
          <select value={f.priority} onChange={fset("priority")}>
            <option value="">All priority</option>
            {meta.priorities.map((d) => <option key={d}>{d}</option>)}
          </select>
        </div>
        <div className="actions">
          {canEditMonth && <button className="primary" disabled={busy} onClick={() => { setAdding(true); setEditId(null); setDraft({ ...BLANK, section: f.section && f.section !== "instructors_ref" ? f.section : "people" }); }}>+ Add line</button>}
          {meta.can_edit && <button className="secondary" disabled={busy} onClick={copyForward}>Copy to next month</button>}
          <button className="secondary" onClick={exportCsv}>Export CSV</button>
          {owner && !locked && <button className="primary dark" disabled={busy} onClick={confirmMonth}>Confirm month</button>}
          {owner && locked && <button className="danger" disabled={busy} onClick={unlockMonth}>Unlock month</button>}
        </div>
      </div>

      <div className="card table-card">
        <div className="table-scroll">
          <table className="cost-table">
            <thead>
              <tr>
                <th title="Confirmed by Marcelo">✓</th>
                <th>Division</th>
                <th>Rol o Departamento</th>
                <th>Nombre completo</th>
                <th className="num">Monto</th>
                <th>Status</th>
                <th>Método</th>
                <th>Frecuencia</th>
                <th>Paga</th>
                <th>Priority</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {adding && <EditRow draft={draft} setDraft={setDraft} meta={meta} onSave={saveNew} onCancel={() => setAdding(false)} saving={busy} isNew />}
              {(!f.section || f.section === "instructors") && instructorsTotal > 0 && period?.instructors_source === "assignments" && (
                <>
                  <tr className="group-row"><td colSpan={11}><span>Instructors</span><strong>{money(instructorsTotal)}</strong></td></tr>
                  <tr className="ref-row">
                    <td />
                    <td colSpan={3}>Instructors' hours for {period.label} — managed in the <Link to="/">Instructors section</Link>, not duplicated here.</td>
                    <td className="num">{money(instructorsTotal)}</td>
                    <td colSpan={6} />
                  </tr>
                </>
              )}
              {groups.map((g) => {
                const sub = g.rows.reduce((s, e) => s + Number(e.amount), 0);
                return (
                  <Fragment key={g.key}>
                    <tr className="group-row">
                      <td colSpan={11}>
                        <span>{sectionLabel[g.key] || g.key}</span>
                        <span className="small-muted">{g.rows.length} lines</span>
                        <strong>{money(sub)}</strong>
                      </td>
                    </tr>
                    {g.rows.map((e) =>
                      editId === e.id ? (
                        <EditRow key={e.id} draft={draft} setDraft={setDraft} meta={meta} onSave={saveEdit} onCancel={() => setEditId(null)} saving={busy} />
                      ) : (
                        <tr key={e.id} className={`${e.confirmed ? "row-confirmed" : ""}${e.is_projection ? " row-projection" : ""}`}>
                          <td>
                            {owner ? (
                              <input type="checkbox" className="chk" checked={e.confirmed} disabled={busy} onChange={() => toggleConfirm(e)} title={e.confirmed ? "Unconfirm" : "Confirm this line"} />
                            ) : e.confirmed ? <span title="Confirmed by Marcelo">🔒</span> : null}
                          </td>
                          <td>{e.division}</td>
                          <td className="muted-cell">{e.department}</td>
                          <td>
                            <div className="name-cell">{e.name}</div>
                            {e.notes && <div className="small-muted note-line">{e.notes}</div>}
                            {e.is_projection && <span className="tag">projection</span>}
                            {e.target_amount != null && <span className="tag target">target {money(e.target_amount)}</span>}
                          </td>
                          <td className={`num strong${Number(e.amount) < 0 ? " txt-down" : ""}`}>{money(e.amount, { cents: true })}</td>
                          <td><span className={`pill ${STATUS_TONE[e.status] || "draft"}`}>{e.status}</span></td>
                          <td className="muted-cell">{e.method}</td>
                          <td className="muted-cell">{e.frequency}</td>
                          <td className={e.paid_by !== "4Geeks USA" ? "other-payer" : "muted-cell"}>{e.paid_by}</td>
                          <td>{e.priority && <span className={`prio prio-${e.priority}`}>{e.priority}</span>}</td>
                          <td className="row-actions">
                            <button className="icon-btn" title="How to lower or improve this cost" onClick={() => setInsightFor(e)}>💡</button>
                            {canEditLine(e) && (
                              <>
                                <button className="icon-btn" title="Edit" onClick={() => { setAdding(false); setEditId(e.id); setDraft({ ...BLANK, ...e, amount: Number(e.amount) }); }}>✎</button>
                                <button className="icon-btn" title="Delete" onClick={() => del(e)}>🗑</button>
                              </>
                            )}
                          </td>
                        </tr>
                      )
                    )}
                  </Fragment>
                );
              })}
              {!groups.length && !adding && (
                <tr><td colSpan={11}><div className="empty-state">No lines match these filters.</div></td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="total-row">
                <td colSpan={4}>Total shown ({filtered.length} lines){!f.section && period?.instructors_source === "assignments" ? " + instructors" : ""}</td>
                <td className="num">{money(total + (!f.section && period?.instructors_source === "assignments" ? instructorsTotal : 0))}</td>
                <td colSpan={6} className="small-muted">Paid by 4Geeks USA: {money(totalUsa + (!f.section && period?.instructors_source === "assignments" ? instructorsTotal : 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Change history</span>
        <button className="linklike" onClick={() => setShowLog((v) => !v)}>{showLog ? "Hide" : "Show"}</button>
      </div>
      {showLog && (
        <div className="card">
          {log.length === 0 ? <div className="empty-state">No changes logged for this month.</div> : (
            <ul className="log-list">
              {log.map((l) => (
                <li key={l.id}>
                  <span className="small-muted">{new Date(l.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                  <strong>{l.user}</strong>
                  <span>{l.action.replace(/_/g, " ")}</span>
                  <span className="small-muted">{l.details}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {insightFor && <LineInsight entry={insightFor} sectionLabel={sectionLabel} onClose={() => setInsightFor(null)} />}
    </>
  );
}
