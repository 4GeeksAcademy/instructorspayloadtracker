import { useEffect, useState } from "react";
import client from "../api/client";
import StatCard from "../components/StatCard.jsx";
import { money } from "./format";
import { errText } from "./useCosts.jsx";

const BLANK = {
  name: "", lender: "", kind: "Private", frequency: "weekly", payment: "", payment_day: "", start_date: "",
  end_date: "", original_amount: "", total_payback: "", balance_remaining: "", balance_as_of: "",
  paid_by: "4Geeks USA", status: "Active", notes: "",
};
const fmtDate = (d) => (d ? new Date(d + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "—");
const wk = (d) => new Date(d + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const mo = (d) => new Date(d + "T00:00").toLocaleDateString("en-US", { month: "short", year: "2-digit" });
const RANGES = [
  { key: "8", label: "8 weeks", q: "weeks=8" },
  { key: "12", label: "12 weeks", q: "weeks=12" },
  { key: "26", label: "6 months", q: "weeks=26" },
  { key: "2027", label: "To Dec 2027", q: "until=2027-12-31" },
];

function LoanForm({ initial, kinds, onSave, onCancel, saving }) {
  const [d, setD] = useState(initial);
  const set = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.value }));
  const num = (v) => (v === "" || v == null ? null : Number(v));
  const submit = (e) => {
    e.preventDefault();
    onSave({
      ...d,
      payment: Number(d.payment || 0),
      original_amount: num(d.original_amount), total_payback: num(d.total_payback), balance_remaining: num(d.balance_remaining),
      start_date: d.start_date || null, end_date: d.end_date || null, balance_as_of: d.balance_as_of || null,
    });
  };
  return (
    <form className="card editing-card" onSubmit={submit}>
      <h3>{initial.id ? `Edit ${initial.name}` : "Add a loan"}</h3>
      <div className="form-grid four">
        <div className="field"><label>Name</label><input value={d.name} onChange={set("name")} required /></div>
        <div className="field"><label>Lender</label><input value={d.lender || ""} onChange={set("lender")} /></div>
        <div className="field"><label>Kind</label>
          <select value={d.kind || ""} onChange={set("kind")}>{kinds.map((k) => <option key={k}>{k}</option>)}</select></div>
        <div className="field"><label>Status</label>
          <select value={d.status} onChange={set("status")}>{["Active", "Paused", "Paid off"].map((k) => <option key={k}>{k}</option>)}</select></div>
        <div className="field"><label>Payment</label><input type="number" step="0.01" value={d.payment} onChange={set("payment")} required /></div>
        <div className="field"><label>Every</label>
          <select value={d.frequency} onChange={set("frequency")}><option value="weekly">Week</option><option value="monthly">Month</option></select></div>
        <div className="field"><label>{d.frequency === "monthly" ? "Day of month" : "Debit day / how"}</label><input value={d.payment_day || ""} onChange={set("payment_day")} placeholder={d.frequency === "monthly" ? "1" : "Weekly ACH"} /></div>
        <div className="field"><label>Paid by</label><input value={d.paid_by} onChange={set("paid_by")} /></div>
        <div className="field"><label>First payment</label><input type="date" value={d.start_date || ""} onChange={set("start_date")} /></div>
        <div className="field"><label>Last payment</label><input type="date" value={d.end_date || ""} onChange={set("end_date")} /></div>
        <div className="field"><label>Balance left</label><input type="number" step="0.01" value={d.balance_remaining ?? ""} onChange={set("balance_remaining")} /></div>
        <div className="field"><label>Balance as of</label><input type="date" value={d.balance_as_of || ""} onChange={set("balance_as_of")} /></div>
        <div className="field"><label>Original amount</label><input type="number" step="0.01" value={d.original_amount ?? ""} onChange={set("original_amount")} /></div>
        <div className="field"><label>Total payback</label><input type="number" step="0.01" value={d.total_payback ?? ""} onChange={set("total_payback")} /></div>
        <div className="field span-2"><label>Notes</label><input value={d.notes || ""} onChange={set("notes")} /></div>
      </div>
      <div className="actions">
        <button className="primary" disabled={saving}>{saving ? "Saving…" : "Save loan"}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function CostsLoans() {
  const [meta, setMeta] = useState(null);
  const [loans, setLoans] = useState([]);
  const [sched, setSched] = useState(null);
  const [range, setRange] = useState("12");
  const [group, setGroup] = useState("week");
  const [next4, setNext4] = useState(null);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const load = () =>
    Promise.all([
      client.get("/costs/loans"),
      client.get(`/costs/loans/schedule?${RANGES.find((r) => r.key === range).q}&group=${group}`),
      client.get("/costs/loans/schedule?weeks=4"),
    ]).then(([l, s, n]) => {
      setLoans(l.data);
      setSched(s.data);
      setNext4(n.data);
    });
  useEffect(() => {
    client.get("/costs/meta").then((r) => setMeta(r.data));
  }, []);
  useEffect(() => {
    load();
  }, [range, group]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (payload) => {
    setSaving(true);
    setMsg("");
    try {
      if (payload.id) await client.patch(`/costs/loans/${payload.id}`, payload);
      else await client.post("/costs/loans", payload);
      setEditing(null);
      await load();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setSaving(false);
    }
  };
  const del = async (l) => {
    if (!window.confirm(`Delete ${l.name}?`)) return;
    await client.delete(`/costs/loans/${l.id}`);
    load();
  };

  if (!sched || !meta) return <div className="empty-state">Loading…</div>;
  const canEdit = meta.can_edit;
  const next4Total = next4 ? next4.totals.reduce((a, b) => a + b, 0) : 0;
  const byMonth = sched.group === "month";
  const colLabel = byMonth ? mo : wk;
  const rangeLabel = RANGES.find((r) => r.key === range).label;
  const peak = Math.max(...sched.totals);
  const peakIdx = sched.totals.indexOf(peak);
  const balance = loans.filter((l) => l.status === "Active").reduce((s, l) => s + Number(l.balance_remaining || 0), 0);
  const maxCell = Math.max(...sched.rows.flatMap((r) => r.cells), 1);
  const visibleRows = sched.rows.filter((r) => r.status === "Active" || r.total > 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Loans &amp; <em>weekly debits</em></h1>
          <p className="subhead">Every loan, card and payment plan: what leaves the account each week, what's left and when it ends.</p>
        </div>
        <div className="page-head-tools">
          <div className="seg">
            {RANGES.map((r) => (
              <button key={r.key} className={range === r.key ? "on" : ""}
                      onClick={() => { setRange(r.key); if (r.key === "2027") setGroup("month"); }}>{r.label}</button>
            ))}
          </div>
          <div className="seg">
            <button className={group === "week" ? "on" : ""} onClick={() => setGroup("week")}>By week</button>
            <button className={group === "month" ? "on" : ""} onClick={() => setGroup("month")}>By month</button>
          </div>
          {canEdit && !editing && <button className="primary" onClick={() => setEditing({ ...BLANK })}>+ Add loan</button>}
        </div>
      </div>

      <div className="grid cols-4">
        <StatCard tone="amber" label="Per month (all loans)" value={money(sched.per_month_total)} sub="weekly × 52 / 12 + monthly" />
        <StatCard tone="blue" label="Next 4 weeks" value={money(next4Total)} sub={`${money(sched.per_week_avg)} / week on average (${rangeLabel.toLowerCase()})`} />
        <StatCard tone="red" label={byMonth ? "Heaviest month" : "Heaviest week"} value={money(peak)} sub={byMonth ? mo(sched.weeks[peakIdx]) : `Week of ${wk(sched.weeks[peakIdx])}`} />
        <StatCard tone="gray" label={`Total out · ${rangeLabel.toLowerCase()}`} value={money(sched.window_total)} sub={`through ${fmtDate(sched.until)} · known balances ${money(balance)}`} />
      </div>

      {msg && <div className="banner">{msg}</div>}
      {editing && <LoanForm initial={editing} kinds={sched.kinds} onSave={save} onCancel={() => setEditing(null)} saving={saving} />}

      <div className="card">
        <div className="card-head">
          <h3>{byMonth ? "Month by month" : "Week by week"}</h3>
          <span className="small-muted">{byMonth ? "Each payment counted in the month it's debited" : "Weeks start Monday"} · darker = bigger debit</span>
        </div>
        <div className="table-scroll">
          <table className="week-table">
            <thead>
              <tr>
                <th className="sticky-col">Loan</th>
                {sched.weeks.map((w) => <th key={w} className="num">{colLabel(w)}</th>)}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => (
                <tr key={r.id}>
                  <td className="loan-name sticky-col">{r.name}<div className="small-muted">{money(r.payment)} / {r.frequency === "weekly" ? "week" : "month"}</div></td>
                  {r.cells.map((v, i) => (
                    <td key={i} className="num heat" style={v ? { background: `rgba(35,129,255,${0.12 + 0.55 * (v / maxCell)})`, color: v / maxCell > 0.6 ? "#fff" : "var(--ink)" } : undefined}>
                      {v ? money(v) : ""}
                    </td>
                  ))}
                  <td className="num strong">{money(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="total-row">
                <td className="sticky-col">Total out</td>
                {sched.totals.map((v, i) => <td key={i} className={`num${i === peakIdx ? " txt-up" : ""}`}>{money(v)}</td>)}
                <td className="num">{money(sched.totals.reduce((a, b) => a + b, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {sched.ending_in_window.length > 0 && (
          <p className="hint">Ending in this window: {sched.ending_in_window.map((r) => `${r.name} (${fmtDate(r.end_date)})`).join(", ")} — that cash frees up after.</p>
        )}
      </div>

      <div className="card">
        <h3>Loan register</h3>
        <div className="table-scroll">
          <table className="cmp-table">
            <thead>
              <tr><th>Loan</th><th>Kind</th><th className="num">Payment</th><th className="num">Per month</th><th>From → to</th><th className="num">Balance left</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {loans.map((l) => {
                const r = sched.rows.find((x) => x.id === l.id);
                return (
                  <tr key={l.id} className={l.status !== "Active" ? "row-muted" : ""}>
                    <td>{l.name}<div className="small-muted">{l.lender}{l.notes ? ` · ${l.notes}` : ""}</div></td>
                    <td className="muted-cell">{l.kind}</td>
                    <td className="num strong">{money(l.payment)}<span className="small-muted"> /{l.frequency === "weekly" ? "wk" : "mo"}</span></td>
                    <td className="num">{money(r?.per_month || 0)}</td>
                    <td className="muted-cell">{fmtDate(l.start_date)} → {fmtDate(l.end_date)}</td>
                    <td className="num">{l.balance_remaining != null ? money(l.balance_remaining) : "—"}{l.balance_as_of && <div className="small-muted">as of {fmtDate(l.balance_as_of)}</div>}</td>
                    <td><span className={`pill ${l.status === "Active" ? "admin_reviewed" : l.status === "Paid off" ? "paid" : "draft"}`}>{l.status}</span></td>
                    <td className="row-actions">
                      {canEdit && (
                        <>
                          <button className="icon-btn" title="Edit" onClick={() => setEditing({ ...BLANK, ...l })}>✎</button>
                          <button className="icon-btn" title="Delete" onClick={() => del(l)}>🗑</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="hint">Monthly totals in the dashboard come from the "Debt &amp; financing" lines of each month; this page is the weekly schedule. Balances are estimates — update them from each lender's statement.</p>
      </div>
    </>
  );
}
