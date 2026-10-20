import { useEffect, useState, useCallback, Fragment } from "react";
import client from "../api/client";
import PeriodSelector from "../components/PeriodSelector.jsx";
import StatCard from "../components/StatCard.jsx";

const money = (v) =>
  `$${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
  const [awaitingFinal, setAwaitingFinal] = useState({ count: 0, total: 0 });
  const [filter, setFilter] = useState(FILTERS[0]);
  const [expanded, setExpanded] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    client.get("/periods").then((res) => {
      setPeriods(res.data);
      if (res.data.length) setPeriodId(res.data[0].id);
    });
  }, []);

  const load = useCallback(async () => {
    if (!periodId) return;
    const res = await client.get("/assignments", { params: { period_id: periodId } });
    setRows(res.data.filter((a) => PAYMENT_STATUSES.includes(a.status)));
    const waiting = res.data.filter((a) => a.status === "admin_reviewed");
    setAwaitingFinal({ count: waiting.length, total: waiting.reduce((s, a) => s + a.total_amount, 0) });
  }, [periodId]);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(ids, status, key) {
    setBusy(key);
    setError("");
    try {
      await client.post("/assignments/payment-status", { assignment_ids: ids, status });
      await load();
    } catch (err) {
      setError(err.response?.data?.detail || "Could not update payment status");
    } finally {
      setBusy(null);
    }
  }

  // One entry per person: what they're owed this period and where it stands.
  const people = Object.values(
    rows.reduce((acc, a) => {
      const p = (acc[a.person.id] ||= { id: a.person.id, name: a.person.name, items: [] });
      p.items.push(a);
      return acc;
    }, {})
  )
    .map((p) => {
      const statuses = [...new Set(p.items.map((a) => a.status))];
      return {
        ...p,
        status: statuses.length === 1 ? statuses[0] : "mixed",
        hours: p.items.reduce((s, a) => s + Number(a.hours), 0),
        total: p.items.reduce((s, a) => s + a.total_amount, 0),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const visible = people.filter((p) => p.items.some((a) => filter.match(a.status)));
  const sumBy = (status) => rows.filter((a) => a.status === status).reduce((s, a) => s + a.total_amount, 0);

  function downloadCsv() {
    const header = ["Person", "Program", "Role", "Cohort / work", "Hours", "Rate", "Adjustment", "Total", "Status"];
    const lines = visible.flatMap((p) =>
      p.items
        .filter((a) => filter.match(a.status))
        .map((a) => [
          p.name, a.program.code, a.role.name, a.work_reference, a.hours, a.rate,
          a.adjustment_amount, a.total_amount.toFixed(2), STAGE_LABEL[a.status],
        ])
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
        Everything Marcelo has given final approval, grouped by person. Mark each one as it moves
        through payroll: pending → registered → paid.
      </p>

      {periods.length > 0 && <PeriodSelector periods={periods} value={periodId} onChange={setPeriodId} />}

      <div className="grid cols-4" style={{ marginBottom: 24 }}>
        <StatCard tone="amber" label="Pending payment" value={money(sumBy("approved"))} />
        <StatCard tone="blue" label="Registered" value={money(sumBy("registered"))} />
        <StatCard tone="green" label="Paid" value={money(sumBy("paid"))} />
        <StatCard
          tone="red"
          label="Waiting on final approval"
          value={money(awaitingFinal.total)}
          sub={`${awaitingFinal.count} item${awaitingFinal.count === 1 ? "" : "s"} with Marcelo`}
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
                <th>Total to pay</th>
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
                    <td>{p.items.length}</td>
                    <td>{p.hours.toLocaleString()}</td>
                    <td><strong>{money(p.total)}</strong></td>
                    <td>
                      <span className={`pill ${p.status === "mixed" ? "submitted" : p.status}`}>
                        {p.status === "mixed" ? "Mixed" : STAGE_LABEL[p.status]}
                      </span>
                    </td>
                    <td>
                      <StageButtons
                        current={p.status}
                        disabled={busy !== null}
                        onChange={(status) => setStatus(p.items.map((a) => a.id), status, `p${p.id}`)}
                      />
                    </td>
                  </tr>
                  {expanded[p.id] &&
                    p.items.map((a) => (
                      <tr key={a.id} className="detail-row">
                        <td></td>
                        <td className="small-muted">
                          {a.program.code} · {a.role.name} · {a.work_reference}
                        </td>
                        <td></td>
                        <td>{a.hours}h × ${Number(a.rate).toFixed(2)}</td>
                        <td>
                          {money(a.total_amount)}
                          {Number(a.adjustment_amount) !== 0 && (
                            <div className="small-muted">incl. adj. {money(a.adjustment_amount)}</div>
                          )}
                        </td>
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
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
        {visible.length > 0 && (
          <p className="small-muted" style={{ marginTop: 14 }}>
            {visible.length} {visible.length === 1 ? "person" : "people"} · total{" "}
            <strong>{money(visible.reduce((s, p) => s + p.total, 0))}</strong>
          </p>
        )}
      </div>
    </>
  );
}
