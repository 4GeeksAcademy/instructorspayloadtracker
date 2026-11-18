import { currentPeriod } from "../api/periods.js";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import client from "../api/client";
import { useAuth } from "../api/auth.jsx";
import PeriodSelector from "../components/PeriodSelector.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusPill from "../components/StatusPill.jsx";
import RowDrawer, { CorrectionCard, actionLabel, money, signed } from "../components/RowDrawer.jsx";

const IN_PROGRESS = ["draft", "rejected"];
const WAITING = ["submitted", "admin_reviewed"];
const TO_PAY = ["approved", "registered"];
const C_TO_PAY = ["approved", "registered"];

const day = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
const when = (d) =>
  d ? new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

/** When a row was last marked paid, from its history. */
function paidAt(a) {
  const h = (a.history || []).filter((x) => x.action === "paid");
  return h.length ? h[h.length - 1].at : null;
}

/**
 * The whole picture for one month. Everyone gets the same page; program leads
 * only ever see their own data (the API filters it). Per person:
 * entered → waiting approval → approved/to pay → paid, plus corrections,
 * and the one number that matters: how much is still left to pay.
 */
export default function Overview() {
  const { user } = useAuth();
  const isReviewer = user.role === "admin" || user.role === "owner";
  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState(null);
  const [rows, setRows] = useState([]);
  const [corrections, setCorrections] = useState([]);
  const [activity, setActivity] = useState([]);
  const [otherOpen, setOtherOpen] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [drawer, setDrawer] = useState(null);
  const [view, setView] = useState("all"); // all | left | paid
  const [loading, setLoading] = useState(true);
  const [allActivity, setAllActivity] = useState(false);

  useEffect(() => {
    client.get("/periods").then((res) => {
      setPeriods(res.data);
      if (res.data.length) setPeriodId(currentPeriod(res.data).id);
    });
  }, []);

  const load = useCallback(async () => {
    if (!periodId) return;
    setLoading(true);
    const [a, c, act, open] = await Promise.all([
      client.get("/assignments", { params: { period_id: periodId } }),
      client.get("/corrections", { params: { period_id: periodId } }),
      client.get("/assignments/activity", { params: { period_id: periodId, limit: 60 } }),
      client.get("/corrections", { params: { open_only: true } }),
    ]);
    setRows(a.data);
    setCorrections(c.data);
    setActivity(act.data);
    setOtherOpen(open.data.filter((x) => x.period_id !== periodId));
    setLoading(false);
  }, [periodId]);
  useEffect(() => { load(); }, [load]);

  const people = useMemo(() => {
    const map = {};
    const get = (id, name) => (map[id] ||= {
      id, name, items: [], corrections: [],
      entered: 0, waiting: 0, toPay: 0, paid: 0, inProgress: 0, cToPay: 0, cPaid: 0, cOpen: 0, hours: 0, lastPaid: null,
    });
    for (const a of rows) {
      const p = get(a.person.id, a.person.name);
      p.items.push(a);
      p.entered += a.total_amount;
      p.hours += Number(a.hours);
      if (IN_PROGRESS.includes(a.status)) p.inProgress += a.total_amount;
      if (WAITING.includes(a.status)) p.waiting += a.total_amount;
      if (TO_PAY.includes(a.status)) p.toPay += a.total_amount;
      if (a.status === "paid") {
        p.paid += a.total_amount;
        const at = paidAt(a);
        if (at && (!p.lastPaid || at > p.lastPaid)) p.lastPaid = at;
      }
    }
    for (const c of corrections) {
      const p = get(c.person_id, c.person_name);
      p.corrections.push(c);
      const amt = Number(c.amount);
      if (C_TO_PAY.includes(c.status)) p.cToPay += amt;
      if (c.status === "paid") {
        p.cPaid += amt;
        if (c.paid_at && (!p.lastPaid || c.paid_at > p.lastPaid)) p.lastPaid = c.paid_at;
      }
      if (c.status === "open") p.cOpen += 1;
    }
    return Object.values(map)
      .map((p) => {
        const left = p.toPay + p.cToPay;
        const paidTotal = p.paid + p.cPaid;
        const pending = p.waiting + p.inProgress;
        let state = "nothing";
        if (left === 0 && pending === 0 && paidTotal !== 0) state = "done";
        else if (left < 0 && pending === 0) state = "overpaid";
        else if (left !== 0) state = left > 0 ? "to_pay" : "overpaid";
        else if (p.waiting) state = "waiting";
        else if (p.inProgress) state = "in_progress";
        return { ...p, left, paidTotal, pending, state };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, corrections]);

  const t = people.reduce(
    (s, p) => ({
      entered: s.entered + p.entered,
      inProgress: s.inProgress + p.inProgress,
      waiting: s.waiting + p.waiting,
      left: s.left + p.left,
      paid: s.paid + p.paidTotal,
      cOpen: s.cOpen + p.cOpen,
      peoplePaid: s.peoplePaid + (p.state === "done" ? 1 : 0),
      peopleLeft: s.peopleLeft + (p.left !== 0 ? 1 : 0),
    }),
    { entered: 0, inProgress: 0, waiting: 0, left: 0, paid: 0, cOpen: 0, peoplePaid: 0, peopleLeft: 0 }
  );
  const committed = t.left + t.paid;
  const paidPct = committed ? Math.round((t.paid / committed) * 100) : 0;
  const openCorrections = corrections.filter((c) => c.status === "open");

  const visible = people.filter((p) =>
    view === "left" ? p.left !== 0 || p.pending !== 0 : view === "paid" ? p.paidTotal !== 0 : true
  );

  const STATE = {
    done: <span className="pill paid">Paid in full</span>,
    to_pay: <span className="pill approved">To pay</span>,
    overpaid: <span className="pill rejected">Overpaid — deduct</span>,
    waiting: <span className="pill submitted">Waiting approval</span>,
    in_progress: <span className="pill draft">Being entered</span>,
    nothing: <span className="pill draft">—</span>,
  };

  return (
    <>
      <h1>Over<em>view</em></h1>
      <p className="subhead">
        {isReviewer
          ? "The whole month in one place: what was entered, what's waiting for approval, who's been paid, and what's still left to pay."
          : "Everything you've entered this month and where it stands — from submitted to paid."}
      </p>

      {periods.length > 0 && <PeriodSelector periods={periods} value={periodId} onChange={setPeriodId} />}

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <StatCard tone="green" label="Paid" value={money(t.paid)} sub={`${t.peoplePaid} ${t.peoplePaid === 1 ? "person" : "people"} paid in full`} />
        <StatCard tone="blue" label="Left to pay (approved)" value={money(t.left)} sub={`${t.peopleLeft} ${t.peopleLeft === 1 ? "person" : "people"} still owed`} />
        <StatCard tone="amber" label="Waiting approval" value={money(t.waiting)} sub={t.inProgress ? `+ ${money(t.inProgress)} still being entered` : "submitted, not approved yet"} />
        <StatCard tone="red" label="Open corrections" value={String(t.cOpen)} sub={t.cOpen ? (isReviewer ? "need a decision" : "waiting on Kevin") : "nothing pending"} />
      </div>

      {committed > 0 && (
        <div className="card progress-card" style={{ marginBottom: 20 }}>
          <div className="progress-head">
            <strong>{paidPct}% of approved pay is out the door</strong>
            <span className="small-muted">{money(t.paid)} paid of {money(committed)} approved</span>
          </div>
          <div className="progress-bar">
            <div className="pb-paid" style={{ width: `${paidPct}%` }} />
          </div>
          <div className="small-muted" style={{ marginTop: 6 }}>
            Total entered this month (all stages): {money(t.entered)}
          </div>
        </div>
      )}

      {isReviewer && (openCorrections.length > 0 || otherOpen.length > 0) && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Corrections that need you</h3>
          {openCorrections.map((c) => (
            <CorrectionCard key={c.id} c={c} isReviewer me={user} showRow onChanged={load} />
          ))}
          {otherOpen.length > 0 && (
            <p className="hint">
              Also {otherOpen.length} open or unpaid correction{otherOpen.length === 1 ? "" : "s"} from other months (
              {[...new Set(otherOpen.map((c) => c.period_label))].join(", ")}) — switch month above to see them.
            </p>
          )}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
        <div className="actions">
          {[["all", "Everyone"], ["left", "Still to pay"], ["paid", "Paid"]].map(([k, l]) => (
            <button key={k} className={view === k ? "primary" : "secondary"} onClick={() => setView(k)}>{l}</button>
          ))}
        </div>
        {isReviewer && t.left !== 0 && <Link to="/payments" className="small-muted">Go to Payments →</Link>}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="empty-state">Nothing here for this month.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>Person</th>
                <th>Hours</th>
                <th>Waiting approval</th>
                <th>Paid</th>
                <th>Corrections</th>
                <th>Left to pay</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <Fragment key={p.id}>
                  <tr className={p.state === "done" ? "row-done" : ""}>
                    <td>
                      <button className="linklike" onClick={() => setExpanded({ ...expanded, [p.id]: !expanded[p.id] })}>
                        {expanded[p.id] ? "▾" : "▸"}
                      </button>
                    </td>
                    <td><strong>{p.name}</strong><div className="small-muted">{p.items.length} item{p.items.length === 1 ? "" : "s"}</div></td>
                    <td>{p.hours.toLocaleString()}</td>
                    <td>{p.pending ? money(p.pending) : <span className="small-muted">—</span>}</td>
                    <td>
                      {p.paidTotal ? <strong className="txt-green">{money(p.paidTotal)}</strong> : <span className="small-muted">—</span>}
                      {p.lastPaid && <div className="small-muted">last on {day(p.lastPaid)}</div>}
                    </td>
                    <td>
                      {p.corrections.length === 0 ? (
                        <span className="small-muted">—</span>
                      ) : (
                        <>
                          {p.cToPay + p.cPaid !== 0 && <div>{signed(p.cToPay + p.cPaid)}</div>}
                          <div className="small-muted">
                            {p.corrections.length} item{p.corrections.length === 1 ? "" : "s"}{p.cOpen ? ` · ${p.cOpen} open` : ""}
                          </div>
                        </>
                      )}
                    </td>
                    <td>
                      {p.left ? <strong className={p.left < 0 ? "txt-red" : ""}>{money(p.left)}</strong> : <span className="small-muted">$0.00</span>}
                      {p.left < 0 && <div className="small-muted">to deduct next time</div>}
                    </td>
                    <td>{STATE[p.state]}</td>
                  </tr>
                  {expanded[p.id] && (
                    <>
                      {p.items.map((a) => (
                        <tr key={a.id} className="detail-row clickable" onClick={() => setDrawer(a)}>
                          <td></td>
                          <td className="small-muted">{a.program.code} · {a.role.name} · {a.work_reference}</td>
                          <td>{a.hours}h × ${Number(a.rate).toFixed(2)}</td>
                          <td>{[...IN_PROGRESS, ...WAITING].includes(a.status) ? money(a.total_amount) : ""}</td>
                          <td>
                            {a.status === "paid" && (
                              <>
                                <span className="txt-green">{money(a.total_amount)}</span>
                                {paidAt(a) && <div className="small-muted">{day(paidAt(a))}</div>}
                              </>
                            )}
                          </td>
                          <td className="small-muted">
                            {p.corrections.filter((c) => c.assignment_id === a.id).map((c) => (
                              <div key={c.id}>{Number(c.amount) ? signed(c.amount) : "note"} · {c.status === "paid" ? "settled" : c.status}</div>
                            ))}
                          </td>
                          <td>
                            {TO_PAY.includes(a.status) ? money(a.total_amount) : ""}
                            <div><span className="linklike">Details / fix</span></div>
                          </td>
                          <td><StatusPill status={a.status} /></td>
                        </tr>
                      ))}
                    </>
                  )}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td></td>
                <td><strong>Total</strong></td>
                <td></td>
                <td>{money(t.waiting + t.inProgress)}</td>
                <td><strong className="txt-green">{money(t.paid)}</strong></td>
                <td></td>
                <td><strong>{money(t.left)}</strong></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>What happened this month</h3>
        {activity.length === 0 ? (
          <div className="empty-state">No activity yet.</div>
        ) : (
          <ol className="timeline">
            {(allActivity ? activity : activity.slice(0, 12)).map((e) => (
              <li key={e.id}>
                <div>
                  <strong>{actionLabel(e.action)}</strong> · {e.person}
                  <span className="small-muted"> ({e.work_reference}){e.user && ` · by ${e.user}`}</span>
                </div>
                {e.details && <div className="small-muted">{e.details}</div>}
                <div className="tl-when">{when(e.at)}</div>
              </li>
            ))}
          </ol>
        )}
        {activity.length > 12 && (
          <button className="linklike" onClick={() => setAllActivity(!allActivity)}>
            {allActivity ? "Show less" : `Show all ${activity.length}`}
          </button>
        )}
      </div>

      {drawer && <RowDrawer assignment={drawer} onClose={() => setDrawer(null)} onChanged={load} />}
    </>
  );
}
