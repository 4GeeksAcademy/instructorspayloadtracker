import { currentPeriod } from "../api/periods.js";
import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import client from "../api/client";
import { useAuth } from "../api/auth.jsx";
import StatusPill from "../components/StatusPill.jsx";
import PeriodSelector from "../components/PeriodSelector.jsx";
import RowDrawer, { CorrectionCard, money } from "../components/RowDrawer.jsx";
import { useReviewEdit, ReviewEditCells, ReviewChanges } from "../components/useReviewEdit.jsx";

/**
 * Approvals (Kevin and Marcelo). One step: what Loreto / Diego submit is
 * approved here and goes straight to Payments. Edit fixes cohort, hours or
 * rate before approving (logged). Open corrections are decided here too.
 */
export default function ReviewQueue() {
  const { user } = useAuth();
  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [corrections, setCorrections] = useState([]);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState(null);

  const load = useCallback(async () => {
    if (!periodId) return;
    const [res, c] = await Promise.all([
      client.get("/assignments", { params: { period_id: periodId } }),
      client.get("/corrections", { params: { open_only: true } }),
    ]);
    setAssignments(res.data.filter((a) => a.status === "submitted" || a.status === "admin_reviewed"));
    setCorrections(c.data.filter((x) => x.status === "open"));
  }, [periodId]);

  useEffect(() => {
    client.get("/periods").then((res) => {
      setPeriods(res.data);
      if (res.data.length) setPeriodId(currentPeriod(res.data).id);
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  const edit = useReviewEdit(load);

  async function approve(ids) {
    setBusy(true);
    try {
      for (const id of ids) await client.post(`/assignments/${id}/approve`);
    } finally {
      setBusy(false);
      load();
    }
  }

  async function reject(id) {
    await client.post(`/assignments/${id}/reject`, { reason: rejectReason });
    setRejectingId(null);
    setRejectReason("");
    load();
  }

  const total = assignments.reduce((s, a) => s + a.total_amount, 0);

  return (
    <>
      <h1>Appro<em>vals</em></h1>
      <p className="subhead">
        What Loreto and Diego submitted, waiting for a decision. Approve and it goes straight to{" "}
        <Link to="/payments">Payments</Link>. Use <strong>Edit</strong> to fix the cohort, hours or rate first — every
        change is saved in the row's history.
      </p>

      {periods.length > 0 && <PeriodSelector periods={periods} value={periodId} onChange={setPeriodId} />}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>
            Hours waiting approval{" "}
            <span className="small-muted">({assignments.length} · {money(total)})</span>
          </h3>
          {assignments.length > 1 && (
            <button className="primary" disabled={busy || edit.editingId !== null} onClick={() => approve(assignments.map((a) => a.id))}>
              {busy ? "Approving…" : `Approve all ${assignments.length}`}
            </button>
          )}
        </div>
        {edit.error && <div className="banner">{edit.error}</div>}
        {assignments.length === 0 ? (
          <div className="empty-state">Nothing waiting for approval this month.</div>
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
                    <button className="linklike" onClick={() => setDrawer(a)}>{a.person.name}</button>
                    <ReviewChanges a={a} />
                  </td>
                  <td>{a.program.code}</td>
                  <td>{a.role.name}</td>
                  <ReviewEditCells a={a} edit={edit} />
                  <td>{money(edit.isEditing(a) ? edit.previewTotal(a) : a.total_amount)}</td>
                  <td>{a.hours_verified ? "Yes" : "No"}</td>
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
                        <input placeholder="Reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} style={{ width: 140 }} />
                        <button className="danger" onClick={() => reject(a.id)}>Send back</button>
                        <button className="secondary" onClick={() => setRejectingId(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div className="actions">
                        <button className="secondary" onClick={() => edit.start(a)} disabled={edit.editingId !== null}>Edit</button>
                        <button className="primary" onClick={() => approve([a.id])} disabled={busy || edit.editingId !== null}>Approve</button>
                        <button className="danger" onClick={() => setRejectingId(a.id)}>Reject</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>
          Corrections waiting approval <span className="small-muted">(all months · {corrections.length})</span>
        </h3>
        {corrections.length === 0 ? (
          <div className="empty-state">No corrections waiting.</div>
        ) : (
          corrections.map((c) => <CorrectionCard key={c.id} c={c} isReviewer me={user} showRow onChanged={load} />)
        )}
      </div>

      {drawer && <RowDrawer assignment={drawer} onClose={() => setDrawer(null)} onChanged={load} />}
    </>
  );
}
