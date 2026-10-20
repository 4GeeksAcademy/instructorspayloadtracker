import { useEffect, useState, useCallback } from "react";
import client from "../api/client";
import StatusPill from "../components/StatusPill.jsx";
import PeriodSelector from "../components/PeriodSelector.jsx";
import { useReviewEdit, ReviewEditCells, ReviewChanges } from "../components/useReviewEdit.jsx";

export default function ReviewQueue() {
  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    if (!periodId) return;
    const res = await client.get("/assignments", {
      params: { period_id: periodId, status_filter: "submitted" },
    });
    setAssignments(res.data);
  }, [periodId]);

  useEffect(() => {
    client.get("/periods").then((res) => {
      setPeriods(res.data);
      if (res.data.length) setPeriodId(res.data[0].id);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const edit = useReviewEdit(load);

  async function approve(id) {
    await client.post(`/assignments/${id}/admin-review`);
    load();
  }

  async function reject(id) {
    await client.post(`/assignments/${id}/reject`, { reason: rejectReason });
    setRejectingId(null);
    setRejectReason("");
    load();
  }

  return (
    <>
      <h1>
        Admin <em>review</em>
      </h1>
      <p className="subhead">
        Financial / academic review — the second of three approval tiers, before
        Marcelo's final sign-off. Use <strong>Edit</strong> to correct the cohort
        name, hours or rate first — changes are logged and shown at final approval.
      </p>

      {periods.length > 0 && (
        <PeriodSelector periods={periods} value={periodId} onChange={setPeriodId} />
      )}

      <div className="card">
        {edit.error && <div className="banner">{edit.error}</div>}
        {assignments.length === 0 ? (
          <div className="empty-state">Nothing waiting on admin review.</div>
        ) : (
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
                <th>Verified</th>
                <th>Status</th>
                <th style={{ width: 300 }}></th>
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
                  <td>{a.hours_verified ? "Yes" : "No"}</td>
                  <td><StatusPill status={a.status} /></td>
                  <td>
                    {edit.isEditing(a) ? (
                      <div className="actions">
                        <button className="primary" onClick={() => edit.save(a)} disabled={edit.saving}>
                          {edit.saving ? "Saving..." : "Save"}
                        </button>
                        <button className="secondary" onClick={edit.cancel}>
                          Cancel
                        </button>
                      </div>
                    ) : rejectingId === a.id ? (
                      <div className="actions">
                        <input
                          placeholder="Reason"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          style={{ width: 140 }}
                        />
                        <button className="danger" onClick={() => reject(a.id)}>
                          Confirm
                        </button>
                        <button className="secondary" onClick={() => setRejectingId(null)}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="actions">
                        <button className="secondary" onClick={() => edit.start(a)} disabled={edit.editingId !== null}>
                          Edit
                        </button>
                        <button className="primary" onClick={() => approve(a.id)} disabled={edit.editingId !== null}>
                          Approve for final review
                        </button>
                        <button className="danger" onClick={() => setRejectingId(a.id)}>
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
