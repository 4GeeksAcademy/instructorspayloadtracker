import { useEffect, useState, useCallback, Fragment } from "react";
import client from "../api/client";
import PeriodSelector from "../components/PeriodSelector.jsx";
import StatCard from "../components/StatCard.jsx";
import RowDrawer, { signed } from "../components/RowDrawer.jsx";
import { currentPeriod } from "../api/periods.js";

const paidAt = (a) => {
  const h = (a.history || []).filter((x) => x.action === "paid");
  return h.length ? h[h.length - 1].at : null;
};
const day = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

const money = (v) => {
  const n = Number(v || 0);
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Payment stages after Marcelo's final approval. "approved" in the data
// model is shown here as "Pending payment".
const STAGES = [
  { status: "approved", label: "Pending" },
  { status: "registered", label: "Registered" },
  { status: "paid", label: "Paid" },
];
const STAGE_LABEL = { approved: "Pending payment", registered: "Registered", paid: "Paid" };
const PAYMENT_STATUSES = STAGES.map((s) => s.status);

const FILTERS = [
  { key: "open", label: "To pay", match: (s) => s !== "paid" },
  { key: "paid", label: "Paid", match: (s) => s === "paid" },
  { key: "all", label: "All", match: () => true },
];

function StageButtons({ current, onChange, disabled }) {
  return (
    <div className="segmented">
      {STAGES.map((s) => (
        <button
          key={s.status}
          className={current === s.status ? `seg-on seg-${s.status}` : ""}
          onClick={() => current !== s.status && onChange(s.status)}
          disabled={disabled}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

export default function Payments() {
  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState(null);
  const [rows, setRows] = useState([]);
  const [corrections, setCorrections] = useState([]);
  const [otherCorr, setOtherCorr] = useState([]);
  const [drawer, setDrawer] = useState(null);
  const [awaitingFinal, setAwaitingFinal] = useState({ count: 0, total: 0 });
  const [filter, setFilter] = useState(FILTERS[0]);
  const [expanded, setExpanded] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    client.get("/periods").then((res) => {
      setPeriods(res.data);
      if (res.data.length) setPeriodId(currentPeriod(res.data).id);
    });
  }, []);

  const load = useCallback(async () => {
    if (!periodId) return;
    const [res, cr, open] = await Promise.all([
      client.get("/assignments", { params: { period_id: periodId } }),
      client.get("/corrections", { params: { period_id: periodId } }),
      client.get("/corrections", { params: { open_only: true } }),
    ]);
    setRows(res.data.filter((a) => PAYMENT_STATUSES.includes(a.status)));
    setCorrections(cr.data.filter((c) => PAYMENT_STATUSES.includes(c.status)));
    setOtherCorr(open.data.filter((c) => c.period_id !== periodId && PAYMENT_STATUSES.includes(c.status) && c.status !== "paid"));
    const waiting = res.data.filter((a) => a.status === "submitted" || a.status === "admin_reviewed");
    setAwaitingFinal({ count: waiting.length, total: waiting.reduce((s, a) => s + a.total_amount, 0) });
  }, [periodId]);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(ids, status, key, correctionIds = []) {
    setBusy(key);
    setError("");
    try {
      if (ids.length) await client.post("/assignments/payment-status", { assignment_ids: ids, status });
      if (correctionIds.length) await client.post("/corrections/payment-status", { correction_ids: correctionIds, status });
      await load();
    } catch (err) {
      setError(err.response?.data?.detail || "Could not update payment status");
    } finally {
      setBusy(null);
    }
  }

  // One entry per person: what they're owed this period and where it stands.
  const acc = {};
  const grp = (id, name) => (acc[id] ||= { id, name, items: [], corr: [] });
  rows.forEach((a) => grp(a.person.id, a.person.name).items.push(a));
  corrections.forEach((c) => grp(c.person_id, c.person_name).corr.push(c));
  const people = Object.values(acc)
    .map((p) => {
      const statuses = [...new Set([...p.items.map((a) => a.status), ...p.corr.map((c) => c.status)])];
      const all = [...p.items.map((a) => ({ s: a.status, v: a.total_amount })), ...p.corr.map((c) => ({ s: c.status, v: Number(c.amount) }))];
      const dates = [...p.items.map(paidAt), ...p.corr.map((c) => c.paid_at)].filter(Boolean).sort();
      return {
        ...p,
        status: statuses.length === 1 ? statuses[0] : "mixed",
        hours: p.items.reduce((s, a) => s + Number(a.hours), 0),
        total: all.reduce((s, x) => s + x.v, 0),
        paid: all.filter((x) => x.s === "paid").reduce((s, x) => s + x.v, 0),
        left: all.filter((x) => x.s !== "paid").reduce((s, x) => s + x.v, 0),
        lastPaid: dates[dates.length - 1],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const visible = people.filter(
    (p) => p.items.some((a) => filter.match(a.status)) || p.corr.some((c) => filter.match(c.status))
  );
  const sumBy = (status) =>
    rows.filter((a) => a.status === status).reduce((s, a) => s + a.total_amount, 0) +
    corrections.filter((c) => c.status === status).reduce((s, c) => s + Number(c.amount), 0);

  function downloadCsv() {
    const header = ["Person", "Program", "Role", "Cohort / work", "Hours", "Rate", "Adjustment", "Total", "Status"];
    const lines = visible.flatMap((p) =>
      p.items
        .filter((a) => filter.match(a.status))
        .map((a) => [
          p.name, a.program.code, a.role.name, a.work_reference, a.hours, a.rate,
          a.adjustment_amount, a.total_amount.toFixed(2), STAGE_LABEL[a.status],
        ])
        .concat(
          p.corr
            .filter((c) => filter.match(c.status))
            .map((c) => [p.name, "", "Correction", c.note, "", "", "", Number(c.amount).toFixed(2), STAGE_LABEL[c.status]])
        )
    );
    const csv = [header, ...lines]
      .map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const period = periods.find((p) => p.id === periodId)?.label || "period";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `payroll-${period.replace(/\s+/g, "-").toLowerCase()}-${filter.key}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <h1>
        Pay<em>ments</em>
      </h1>
      <p className="subhead">
        Everything approved, grouped by person — including approved corrections (a minus amount is
        an overpayment to deduct). Mark each one as it moves through payroll: pending → registered → paid.
        Click a line to see its history or add a correction, even after it's paid.
      </p>

      {periods.length > 0 && <PeriodSelector periods={periods} value={periodId} onChange={setPeriodId} />}

      <div className="grid cols-4" style={{ marginBottom: 24 }}>
        <StatCard tone="amber" label="Pending payment" value={money(sumBy("approved"))} />
        <StatCard tone="blue" label="Registered" value={money(sumBy("registered"))} />
        <StatCard tone="green" label="Paid" value={money(sumBy("paid"))} />
        <StatCard
          tone="red"
          label="Waiting approval"
          value={money(awaitingFinal.total)}
          sub={`${awaitingFinal.count} item${awaitingFinal.count === 1 ? "" : "s"} not approved yet`}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
        <div className="actions">
          {FILTERS.map((f) => (
            <button key={f.key} className={filter.key === f.key ? "primary" : "secondary"} onClick={() => setFilter(f)}>
              {f.label}
            </button>
          ))}
        </div>
        {visible.length > 0 && (
          <button className="secondary" onClick={downloadCsv}>
            Download list (CSV)
          </button>
        )}
      </div>

      {otherCorr.length > 0 && (
        <div className="banner warn" style={{ marginBottom: 12 }}>
          {otherCorr.length} approved correction{otherCorr.length === 1 ? "" : "s"} from other months still to settle (
          {[...new Set(otherCorr.map((c) => c.period_label))].join(", ")}): {money(otherCorr.reduce((s, c) => s + Number(c.amount), 0))}.
          Switch month above to settle them.
        </div>
      )}

      <div className="card">
        {error && <div className="banner">{error}</div>}
        {visible.length === 0 ? (
          <div className="empty-state">
            {rows.length === 0
              ? "Nothing has final approval for this period yet."
              : "Nothing in this view."}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>Person</th>
                <th>Items</th>
                <th>Hours</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Left</th>
                <th>Status</th>
                <th style={{ width: 280 }}>Mark all as</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <Fragment key={p.id}>
                  <tr>
                    <td>
                      <button
                        className="linklike"
                        onClick={() => setExpanded({ ...expanded, [p.id]: !expanded[p.id] })}
                        aria-label={expanded[p.id] ? "Hide details" : "Show details"}
                      >
                        {expanded[p.id] ? "▾" : "▸"}
                      </button>
                    </td>
                    <td><strong>{p.name}</strong></td>
                    <td>{p.items.length}{p.corr.length ? ` + ${p.corr.length} corr.` : ""}</td>
                    <td>{p.hours.toLocaleString()}</td>
                    <td>{money(p.total)}</td>
                    <td>
                      {p.paid ? <strong className="txt-green">{money(p.paid)}</strong> : <span className="small-muted">—</span>}
                      {p.lastPaid && <div className="small-muted">{day(p.lastPaid)}</div>}
                    </td>
                    <td>{p.left ? <strong>{money(p.left)}</strong> : <span className="small-muted">$0.00</span>}</td>
                    <td>
                      <span className={`pill ${p.status === "mixed" ? "submitted" : p.status}`}>
                        {p.status === "mixed" ? (p.paid ? "Partly paid" : "Mixed") : STAGE_LABEL[p.status]}
                      </span>
                    </td>
                    <td>
                      <StageButtons
                        current={p.status}
                        disabled={busy !== null}
                        onChange={(status) => setStatus(p.items.map((a) => a.id), status, `p${p.id}`, p.corr.map((c) => c.id))}
                      />
                    </td>
                  </tr>
                  {expanded[p.id] &&
                    p.items.map((a) => (
                      <tr key={a.id} className="detail-row">
                        <td></td>
                        <td className="small-muted">
                          <button className="linklike" onClick={() => setDrawer(a)}>
                            {a.program.code} · {a.role.name} · {a.work_reference}
                          </button>
                        </td>
                        <td></td>
                        <td>{a.hours}h × ${Number(a.rate).toFixed(2)}</td>
                        <td>
                          {money(a.total_amount)}
                          {Number(a.adjustment_amount) !== 0 && (
                            <div className="small-muted">incl. adj. {money(a.adjustment_amount)}</div>
                          )}
                        </td>
                        <td>{a.status === "paid" ? <span className="small-muted">{day(paidAt(a))}</span> : ""}</td>
                        <td>{a.status !== "paid" ? money(a.total_amount) : ""}</td>
                        <td><span className={`pill ${a.status}`}>{STAGE_LABEL[a.status]}</span></td>
                        <td>
                          <StageButtons
                            current={a.status}
                            disabled={busy !== null}
                            onChange={(status) => setStatus([a.id], status, `a${a.id}`)}
                          />
                        </td>
                      </tr>
                    ))}
                  {expanded[p.id] &&
                    p.corr.map((c) => (
                      <tr key={`c${c.id}`} className="detail-row corr-row">
                        <td></td>
                        <td className="small-muted">
                          Correction · {c.assignment_label}
                          <div>{c.note}</div>
                        </td>
                        <td></td>
                        <td className="small-muted">{c.created_by_name}</td>
                        <td><strong>{signed(c.amount)}</strong></td>
                        <td>{c.status === "paid" ? <span className="small-muted">{day(c.paid_at)}</span> : ""}</td>
                        <td>{c.status !== "paid" ? signed(c.amount) : ""}</td>
                        <td><span className={`pill ${c.status}`}>{STAGE_LABEL[c.status]}</span></td>
                        <td>
                          <StageButtons
                            current={c.status}
                            disabled={busy !== null}
                            onChange={(status) => setStatus([], status, `c${c.id}`, [c.id])}
                          />
                        </td>
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
        {visible.length > 0 && (
          <p className="small-muted" style={{ marginTop: 14 }}>
            {visible.length} {visible.length === 1 ? "person" : "people"} · total{" "}
            <strong>{money(visible.reduce((s, p) => s + p.total, 0))}</strong> · paid{" "}
            <strong className="txt-green">{money(visible.reduce((s, p) => s + p.paid, 0))}</strong> · left{" "}
            <strong>{money(visible.reduce((s, p) => s + p.left, 0))}</strong>
          </p>
        )}
      </div>
      {drawer && <RowDrawer assignment={drawer} onClose={() => setDrawer(null)} onChanged={load} />}
    </>
  );
}
