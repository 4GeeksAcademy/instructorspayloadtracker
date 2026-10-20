import { currentPeriod } from "../api/periods.js";
import { useEffect, useState, useCallback } from "react";
import client from "../api/client";
import StatusPill from "../components/StatusPill.jsx";
import PeriodSelector from "../components/PeriodSelector.jsx";
import { useReviewEdit, ReviewEditCells, ReviewChanges } from "../components/useReviewEdit.jsx";

const TABS = [
  { status: "admin_reviewed", label: "Awaiting final approval", action: "approve", actionLabel: "Approve", editable: true },
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
      if (res.data.length) setPeriodId(currentPeriod(res.data).id);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const edit = useReviewEdit(load);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  async function reject(id) {
    await client.post(`/assignments/${id}/reject`, { reason: rejectReason });
    setRejectingId(null);
    setRejectReason("");
    load();
  }

  function switchTab(t) {
    edit.cancel();
    setRejectingId(null);
    setTab(t);
  }

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
            onClick={() => switchTab(t)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="card">
        {edit.error && <div className="banner">{edit.error}</div>}
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
                  <th>Rate</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th style={{ width: tab.editable ? 300 : undefined }}></th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id} className={edit.isEditing(a) ? "row-editing" : ""}>
                    <td>
                      {a.person.name}
                      <ReviewChanges a={a} />
                    </td>
                    <td>{a.program.code}</td>
                    <td>{a.role.name}</td>
                    <ReviewEditCells a={a} edit={edit} />
                    <td>${(edit.isEditing(a) ? edit.previewTotal(a) : a.total_amount).toFixed(2)}</td>
                    <td><StatusPill status={a.status} /></td>
                    <td>
                      {edit.isEditing(a) ? (
                        <div className="actions">
                          <button className="primary" onClick={() => edit.save(a)} disabled={edit.saving}>
                            {edit.saving ? "Saving..." : "Save"}
                          </button>
                          <button className="secondary" onClick={edit.cancel}>Cancel</button>
                        </div>
                      ) : rejectingId === a.id ? (
                        <div className="actions">
                          <input
                            placeholder="Reason"
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            style={{ width: 140 }}
                          />
                          <button className="danger" onClick={() => reject(a.id)}>Confirm</button>
                          <button className="secondary" onClick={() => setRejectingId(null)}>Cancel</button>
                        </div>
                      ) : (
                        <div className="actions">
                          {tab.editable && (
                            <button className="secondary" onClick={() => edit.start(a)} disabled={edit.editingId !== null}>
                              Edit
                            </button>
                          )}
                          <button className="primary" onClick={() => act(a.id)} disabled={edit.editingId !== null}>
                            {tab.actionLabel}
                          </button>
                          {tab.editable && (
                            <button className="danger" onClick={() => setRejectingId(a.id)} disabled={edit.editingId !== null}>
                              Reject
                            </button>
                          )}
                        </div>
                      )}
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
