import { useEffect, useState, useCallback } from "react";
import client from "../api/client";
import StatusPill from "../components/StatusPill.jsx";
import PeriodSelector from "../components/PeriodSelector.jsx";

const TABS = [
  { status: "admin_reviewed", label: "Awaiting final approval", action: "approve", actionLabel: "Approve" },
  { status: "approved", label: "Approved — ready for payroll", action: "register", actionLabel: "Mark registered" },
  { status: "registered", label: "Registered — awaiting payment", action: "mark-paid", actionLabel: "Mark paid" },
];

export default function ApprovalQueue() {
  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState(null);
  const [tab, setTab] = useState(TABS[0]);
  const [assignments, setAssignments] = useState([]);

  const load = useCallback(async () => {
    if (!periodId) return;
    const res = await client.get("/assignments", {
      params: { period_id: periodId, status_filter: tab.status },
    });
    setAssignments(res.data);
  }, [periodId, tab]);

  useEffect(() => {
    client.get("/periods").then((res) => {
      setPeriods(res.data);
      if (res.data.length) setPeriodId(res.data[0].id);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(id) {
    await client.post(`/assignments/${id}/${tab.action}`);
    load();
  }

  const total = assignments.reduce((sum, a) => sum + a.total_amount, 0);

  return (
    <>
      <h1>
        Final <em>approval</em>
      </h1>
      <p className="subhead">
        Marcelo's sign-off, then payroll registration and payment tracking —
        mirrors what the "Kevin" status column used to track.
      </p>

      {periods.length > 0 && (
        <PeriodSelector periods={periods} value={periodId} onChange={setPeriodId} />
      )}

      <div className="nav" style={{ marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t.status}
            className={tab.status === t.status ? "primary" : "secondary"}
            onClick={() => setTab(t)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="card">
        {assignments.length === 0 ? (
          <div className="empty-state">Nothing in this stage.</div>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Program</th>
                  <th>Role</th>
                  <th>Work reference</th>
                  <th>Hours</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id}>
                    <td>{a.person.name}</td>
                    <td>{a.program.code}</td>
                    <td>{a.role.name}</td>
                    <td>{a.work_reference}</td>
                    <td>{a.hours}</td>
                    <td>${a.total_amount.toFixed(2)}</td>
                    <td><StatusPill status={a.status} /></td>
                    <td>
                      <button className="primary" onClick={() => act(a.id)}>
                        {tab.actionLabel}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small-muted" style={{ marginTop: 14 }}>
              Stage total: <strong>${total.toFixed(2)}</strong>
            </p>
          </>
        )}
      </div>
    </>
  );
}
