import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import client from "../api/client";
import { money, SECTION_ORDER, STATUS_TONE, downloadCsv } from "./format";
import { useCosts, MonthPicker, MonthBadge, errText } from "./useCosts.jsx";
import LineInsight from "./LineInsight.jsx";
import EditLine, { CategorySelect, FREQS } from "./EditLine.jsx";

const withValue = (opts, v) => (v && !opts.includes(v) ? [...opts, v] : opts);
const shortDate = (d) => (d ? new Date(d + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

// Dropdown that saves as soon as it changes.
function Cell({ value, options, onSave, disabled, blank, className = "" }) {
  if (disabled) return <span className={className}>{value || ""}</span>;
  const opts = withValue(options, value);
  return (
    <select className={`inline-select ${className}`} value={value || ""} onChange={(e) => onSave(e.target.value || null)}>
      {blank && <option value="">—</option>}
      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function AmountCell({ value, onSave, disabled }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  if (disabled) return <span>{money(value, { cents: true })}</span>;
  return (
    <input className={`inline-amount${Number(v) < 0 ? " txt-down" : ""}`} type="number" step="0.01" value={v}
           onChange={(e) => setV(e.target.value)}
           onBlur={() => Number(v) !== Number(value) && onSave(v === "" ? 0 : Number(v))}
           onKeyDown={(e) => e.key === "Enter" && e.target.blur()} />
  );
}

function DateCell({ value, onSave, disabled }) {
  if (disabled) return <span className="muted-cell">{shortDate(value)}</span>;
  return <input className="inline-date" type="date" value={value || ""} onChange={(e) => onSave(e.target.value || null)} />;
}

const NO_FILTER = { section: "", division: "", status: "", paid_by: "", priority: "", paid: "", q: "", dateBasis: "due", from: "", to: "" };

export default function CostsEntries() {
  const { meta, periods, period, periodId, setPeriodId, reload, loading, error, sectionLabel } = useCosts();
  const [entries, setEntries] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [f, setF] = useState(NO_FILTER);
  const [sel, setSel] = useState(() => new Set());
  const [editing, setEditing] = useState(null); // entry object, or {} for new
  const [editErr, setEditErr] = useState("");
  const [insightFor, setInsightFor] = useState(null);
  const [showLog, setShowLog] = useState(false);
  const [log, setLog] = useState([]);
  const reloadTimer = useRef(null);

  const load = useCallback(
    () => periodId && client.get(`/costs/entries?period_id=${periodId}`).then((r) => setEntries(r.data)),
    [periodId]
  );
  useEffect(() => {
    setSel(new Set());
    load();
  }, [load]);
  useEffect(() => {
    if (showLog && periodId) client.get(`/costs/log?period_id=${periodId}`).then((r) => setLog(r.data));
  }, [showLog, periodId, entries]);

  // Month totals refresh lazily after inline edits.
  const softReload = () => {
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(reload, 800);
  };

  const owner = !!meta?.is_owner;
  const locked = !!period?.month_confirmed;
  const canEditMonth = !!meta?.can_edit && (!locked || owner);
  const canEditLine = (e) => canEditMonth && (!e.confirmed || owner);

  const methods = useMemo(() => [...new Set([...(meta?.methods || []), ...entries.map((e) => e.method).filter(Boolean)])], [meta, entries]);
  const freqs = useMemo(() => [...new Set([...FREQS, ...entries.map((e) => e.frequency).filter(Boolean)])], [entries]);

  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return entries.filter((e) => {
      const d = f.dateBasis === "paid" ? e.paid_date : f.dateBasis === "either" ? e.paid_date || e.due_date : e.due_date;
      return (
        (!f.section || e.section === f.section) &&
        (!f.division || e.division === f.division) &&
        (!f.status || e.status === f.status) &&
        (!f.paid_by || e.paid_by === f.paid_by) &&
        (!f.priority || e.priority === f.priority) &&
        (!f.paid || (f.paid === "paid" ? e.status === "Pagado" : e.status !== "Pagado")) &&
        (!f.from || (d && d >= f.from)) &&
        (!f.to || (d && d <= f.to)) &&
        (!q || `${e.name} ${e.department || ""} ${e.notes || ""}`.toLowerCase().includes(q))
      );
    });
  }, [entries, f]);
  const filtersOn = Object.keys(NO_FILTER).some((k) => k !== "dateBasis" && f[k]);

  const groups = useMemo(() => {
    const order = [...SECTION_ORDER, ...(meta?.sections || []).map((s) => s.key), "instructors_ref"];
    const by = {};
    filtered.forEach((e) => (by[e.section] = by[e.section] || []).push(e));
    return Object.keys(by)
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .map((k) => ({ key: k, rows: by[k].sort((a, b) => Number(b.amount) - Number(a.amount)) }));
  }, [filtered, meta]);

  const sums = (rows) => {
    const t = { n: rows.length, total: 0, usa: 0, paid: 0, unpaid: 0 };
    rows.forEach((e) => {
      const a = Number(e.amount);
      t.total += a;
      if (e.paid_by === "4Geeks USA") t.usa += a;
      if (e.status === "Pagado") t.paid += a;
      else t.unpaid += a;
    });
    return t;
  };
  const fs = sums(filtered);
  const selRows = entries.filter((e) => sel.has(e.id));
  const ss = sums(selRows);

  const toggle = (ids, on) =>
    setSel((s) => {
      const n = new Set(s);
      ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
      return n;
    });

  async function patch(e, changes) {
    setMsg(null);
    try {
      const r = await client.patch(`/costs/entries/${e.id}`, changes);
      setEntries((list) => list.map((x) => (x.id === e.id ? r.data : x)));
      softReload();
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    }
  }
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
  const bulk = (changes, ok) => run(() => client.post("/costs/entries/bulk", { ids: [...sel], ...changes }), ok);

  async function saveLine(d) {
    setBusy(true);
    setEditErr("");
    try {
      if (d.paid_date && d.status !== "Pagado") d.status = "Pagado";
      if (!d.paid_date && d.status === "Pagado" && editing?.paid_date) d.status = "Pendiente";
      if (editing?.id) {
        const { name, section, division, department, notes, amount, target_amount, due_date, paid_date, status } = d;
        await client.patch(`/costs/entries/${editing.id}`, { name, section, division, department, notes, amount, target_amount, due_date, paid_date, status });
      } else {
        await client.post("/costs/entries", { ...d, period_id: periodId });
      }
      setEditing(null);
      await Promise.all([load(), reload()]);
    } catch (e) {
      setEditErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

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
      ["Mes", "Categoría", "Division", "Rol o Departamento", "Nombre completo", "Monto", "Status", "Vence", "Pagado el", "Método", "Frecuencia", "Paga", "Priority", "Confirmado", "Notas"],
      ...(sel.size ? selRows : filtered).map((e) => [period.label, sectionLabel[e.section] || e.section, e.division, e.department, e.name, Number(e.amount).toFixed(2), e.status, e.due_date, e.paid_date, e.method, e.frequency, e.paid_by, e.priority, e.confirmed ? "Sí" : "No", e.notes]),
    ]);

  if (loading || !meta) return <div className="empty-state">Loading…</div>;
  if (error) return <div className="banner">{error}</div>;

  const instructorsTotal = period?.by_section?.instructors || 0;
  const showInstr = (!f.section || f.section === "instructors") && !filtersOn && instructorsTotal > 0 && period?.instructors_source === "instructors section";
  const fset = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const allIds = filtered.map((e) => e.id);
  const allSel = allIds.length > 0 && allIds.every((id) => sel.has(id));
  const COLS = 13;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Monthly <em>costs</em></h1>
          <p className="subhead">Change status, amount, method or who pays right in the table. ✎ edits name, category and notes. Tick rows to add them up.</p>
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
          <select value={f.paid} onChange={fset("paid")}>
            <option value="">Paid or not</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Not paid yet</option>
          </select>
          <select value={f.status} onChange={fset("status")}>
            <option value="">All status</option>
            {meta.statuses.map((d) => <option key={d}>{d}</option>)}
          </select>
          <select value={f.division} onChange={fset("division")}>
            <option value="">All divisions</option>
            {meta.divisions.map((d) => <option key={d}>{d}</option>)}
          </select>
          <select value={f.paid_by} onChange={fset("paid_by")}>
            <option value="">Anyone pays</option>
            {meta.paid_by.map((d) => <option key={d}>{d}</option>)}
          </select>
          <select value={f.priority} onChange={fset("priority")}>
            <option value="">All priority</option>
            {meta.priorities.map((d) => <option key={d}>{d}</option>)}
          </select>
          <div className="date-filter">
            <select value={f.dateBasis} onChange={fset("dateBasis")} title="Which date to filter on">
              <option value="due">Due</option>
              <option value="paid">Paid on</option>
              <option value="either">Due or paid</option>
            </select>
            <input type="date" value={f.from} onChange={fset("from")} title="From" />
            <span>→</span>
            <input type="date" value={f.to} onChange={fset("to")} title="To" />
          </div>
          {filtersOn && <button className="linklike" onClick={() => setF(NO_FILTER)}>Clear filters</button>}
        </div>
        <div className="actions">
          {canEditMonth && <button className="primary" disabled={busy} onClick={() => { setEditErr(""); setEditing({ section: f.section && f.section !== "instructors_ref" ? f.section : "people" }); }}>+ New expense</button>}
          {meta.can_edit && <button className="secondary" disabled={busy} onClick={copyForward}>Copy to next month</button>}
          <button className="secondary" onClick={exportCsv}>Export CSV{sel.size ? ` (${sel.size})` : ""}</button>
          {owner && !locked && <button className="primary dark" disabled={busy} onClick={confirmMonth}>Confirm month</button>}
          {owner && locked && <button className="danger" disabled={busy} onClick={unlockMonth}>Unlock month</button>}
        </div>
      </div>

      <div className="sum-strip">
        <div><span className="small-muted">{filtersOn ? "Filtered" : "All lines"}</span><strong>{fs.n}</strong></div>
        <div><span className="small-muted">Total</span><strong>{money(fs.total)}</strong></div>
        <div><span className="small-muted">Paid by 4Geeks USA</span><strong>{money(fs.usa)}</strong></div>
        <div><span className="small-muted">Paid</span><strong className="txt-down">{money(fs.paid)}</strong></div>
        <div><span className="small-muted">Still to pay</span><strong className="txt-up">{money(fs.unpaid)}</strong></div>
        {f.from || f.to ? null : !filtersOn && instructorsTotal > 0 && <div><span className="small-muted">+ Instructors</span><strong>{money(instructorsTotal)}</strong></div>}
      </div>

      <div className="card table-card">
        <div className="table-scroll">
          <table className="cost-table">
            <thead>
              <tr>
                <th><input type="checkbox" className="chk" checked={allSel} onChange={() => toggle(allIds, !allSel)} title="Select all shown" /></th>
                <th title="Paid">Paid</th>
                <th>Vence</th>
                <th>Division</th>
                <th>Nombre completo</th>
                <th className="num">Monto</th>
                <th>Status</th>
                <th>Método</th>
                <th>Frecuencia</th>
                <th>Paga</th>
                <th>Priority</th>
                <th title="Confirmed by Marcelo">🔒</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {showInstr && (
                <>
                  <tr className="group-row"><td colSpan={COLS}><span>Instructors</span><strong>{money(instructorsTotal)}</strong></td></tr>
                  <tr className="ref-row">
                    <td colSpan={4} />
                    <td colSpan={1}>Instructors' hours for {period.label} — managed in the <Link to="/">Instructors section</Link>.</td>
                    <td className="num">{money(instructorsTotal)}</td>
                    <td colSpan={7} />
                  </tr>
                </>
              )}
              {groups.map((g) => {
                const sub = sums(g.rows);
                const gIds = g.rows.map((e) => e.id);
                const gAll = gIds.every((id) => sel.has(id));
                return (
                  <Fragment key={g.key}>
                    <tr className="group-row">
                      <td><input type="checkbox" className="chk" checked={gAll} onChange={() => toggle(gIds, !gAll)} title="Select this category" /></td>
                      <td colSpan={COLS - 1}>
                        <span>{sectionLabel[g.key] || g.key}</span>
                        <span className="small-muted">{g.rows.length} lines · paid {money(sub.paid)} · to pay {money(sub.unpaid)}</span>
                        <strong>{money(sub.total)}</strong>
                      </td>
                    </tr>
                    {g.rows.map((e) => {
                      const ed = canEditLine(e);
                      const isPaid = e.status === "Pagado";
                      return (
                        <tr key={e.id} className={`${sel.has(e.id) ? "row-selected" : ""}${e.confirmed ? " row-confirmed" : ""}`}>
                          <td><input type="checkbox" className="chk" checked={sel.has(e.id)} onChange={() => toggle([e.id], !sel.has(e.id))} /></td>
                          <td>
                            <button className={`paid-toggle${isPaid ? " on" : ""}`} disabled={!ed}
                                    title={isPaid ? `Paid${e.paid_date ? " on " + shortDate(e.paid_date) : ""} — click to mark unpaid` : "Mark as paid today"}
                                    onClick={() => patch(e, { status: isPaid ? "Pendiente" : "Pagado" })}>
                              {isPaid ? "✓" : ""}
                            </button>
                            {isPaid && e.paid_date && <div className="tiny">{shortDate(e.paid_date)}</div>}
                          </td>
                          <td><DateCell value={e.due_date} disabled={!ed} onSave={(v) => patch(e, { due_date: v })} /></td>
                          <td><Cell value={e.division} options={meta.divisions} blank disabled={!ed} onSave={(v) => patch(e, { division: v })} /></td>
                          <td className="name-col">
                            <div className="name-cell">{e.name}</div>
                            <div className="small-muted">{e.department}{e.notes ? ` · ${e.notes}` : ""}</div>
                            {e.target_amount != null && <span className="tag target">target {money(e.target_amount)}</span>}
                          </td>
                          <td className="num strong"><AmountCell value={Number(e.amount)} disabled={!ed} onSave={(v) => patch(e, { amount: v })} /></td>
                          <td><Cell value={e.status} options={meta.statuses} disabled={!ed} className={`st-${STATUS_TONE[e.status] || "draft"}`} onSave={(v) => patch(e, { status: v })} /></td>
                          <td><Cell value={e.method} options={methods} blank disabled={!ed} onSave={(v) => patch(e, { method: v })} /></td>
                          <td><Cell value={e.frequency} options={freqs} blank disabled={!ed} onSave={(v) => patch(e, { frequency: v })} /></td>
                          <td><Cell value={e.paid_by} options={meta.paid_by} disabled={!ed} className={e.paid_by !== "4Geeks USA" ? "other-payer" : ""} onSave={(v) => patch(e, { paid_by: v })} /></td>
                          <td><Cell value={e.priority} options={meta.priorities} blank disabled={!ed} className={e.priority ? `prio-${e.priority}` : ""} onSave={(v) => patch(e, { priority: v })} /></td>
                          <td>
                            {owner ? (
                              <button className={`lock-btn${e.confirmed ? " on" : ""}`} disabled={busy} onClick={() => toggleConfirm(e)} title={e.confirmed ? "Confirmed — click to unconfirm" : "Confirm this line"}>{e.confirmed ? "🔒" : "🔓"}</button>
                            ) : e.confirmed ? <span title="Confirmed by Marcelo">🔒</span> : null}
                          </td>
                          <td className="row-actions">
                            <button className="icon-btn" title="How to lower or improve this cost" onClick={() => setInsightFor(e)}>💡</button>
                            {ed && <button className="icon-btn" title="Edit name, category, notes" onClick={() => { setEditErr(""); setEditing(e); }}>✎</button>}
                            {ed && <button className="icon-btn" title="Delete" onClick={() => del(e)}>🗑</button>}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
              {!groups.length && (
                <tr><td colSpan={COLS}><div className="empty-state">No lines match these filters.{(f.from || f.to) && " Lines without a date are hidden while a date filter is on."}</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {sel.size > 0 && (
        <div className="selection-bar">
          <div className="sel-sums">
            <strong>{ss.n} selected</strong>
            <span>Sum <b>{money(ss.total, { cents: true })}</b></span>
            <span>USA pays <b>{money(ss.usa)}</b></span>
            <span>Paid <b>{money(ss.paid)}</b></span>
            <span>To pay <b>{money(ss.unpaid)}</b></span>
          </div>
          <div className="sel-actions">
            {canEditMonth && (
              <>
                <button className="primary sm" disabled={busy} onClick={() => bulk({ paid: true }, `${ss.n} lines marked as paid.`)}>Mark paid</button>
                <button className="secondary sm" disabled={busy} onClick={() => bulk({ paid: false }, `${ss.n} lines marked as not paid.`)}>Mark not paid</button>
                <CategorySelect value="" className="sel-cat" sections={[{ key: "", label: "Move to category…" }, ...meta.sections]}
                                onCreated={reload}
                                onChange={(k) => k && bulk({ section: k }, `${ss.n} lines moved to ${meta.sections.find((s) => s.key === k)?.label || "the new category"}.`)} />
              </>
            )}
            <button className="linklike" onClick={() => setSel(new Set())}>Clear</button>
          </div>
        </div>
      )}

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

      {editing && (
        <EditLine entry={editing} meta={meta} periodLabel={period?.label} saving={busy} error={editErr}
                  onCategoryCreated={reload} onSave={saveLine} onClose={() => setEditing(null)} />
      )}
      {insightFor && <LineInsight entry={insightFor} sectionLabel={sectionLabel} onClose={() => setInsightFor(null)} />}
    </>
  );
}
