import { useEffect, useState } from "react";
import client from "../api/client";
import { useAuth } from "../api/auth.jsx";
import StatusPill from "./StatusPill.jsx";

export const money = (v) => {
  const n = Number(v || 0);
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
export const signed = (v) => (Number(v) > 0 ? `+${money(v)}` : money(v));

export const CORRECTION_LABEL = {
  noted: "Note",
  open: "Waiting approval",
  approved: "Approved — to pay",
  registered: "Registered",
  paid: "Settled",
  rejected: "Rejected",
};
const CORRECTION_PILL = {
  noted: "draft", open: "submitted", approved: "approved", registered: "registered", paid: "paid", rejected: "rejected",
};
export function CorrectionPill({ status }) {
  return <span className={`pill ${CORRECTION_PILL[status] || "draft"}`}>{CORRECTION_LABEL[status] || status}</span>;
}

const ACTION_LABEL = {
  created: "Entered",
  edited: "Edited",
  submitted: "Submitted for approval",
  admin_reviewed: "Reviewed",
  review_edit: "Changed during review",
  approved: "Approved for payment",
  rejected: "Sent back",
  registered: "Registered in payroll",
  paid: "Marked paid",
  payment_pending: "Set back to pending payment",
  record_fix: "Record fixed after approval",
  note_added: "Note added",
  correction_added: "Correction raised",
  correction_edited: "Correction edited",
  correction_approved: "Correction approved",
  correction_rejected: "Correction rejected",
  correction_payment: "Correction payment",
  correction_withdrawn: "Correction withdrawn",
};
export const actionLabel = (a) => ACTION_LABEL[a] || a.replace(/_/g, " ");

const when = (d) =>
  d ? new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

const AFTER_APPROVAL = ["approved", "registered", "paid"];

/**
 * Side panel for one pay row: what it is, where it stands, every change made
 * to it, and its corrections. Everyone who can see the row can add a note or
 * a correction (also after it's paid). Kevin and Marcelo can also approve /
 * reject corrections and fix the record itself after approval.
 */
export default function RowDrawer({ assignment, onClose, onChanged }) {
  const { user } = useAuth();
  const isReviewer = user.role === "admin" || user.role === "owner";
  const [row, setRow] = useState(assignment);
  const [corrections, setCorrections] = useState([]);
  const [mode, setMode] = useState(null); // "note" | "money" | "fix"
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function reload() {
    const [a, c] = await Promise.all([
      client.get("/assignments", { params: { period_id: assignment.period.id } }),
      client.get("/corrections", { params: { period_id: assignment.period.id } }),
    ]);
    const fresh = a.data.find((x) => x.id === assignment.id);
    if (fresh) setRow(fresh);
    setCorrections(c.data.filter((x) => x.assignment_id === assignment.id));
  }
  useEffect(() => {
    setRow(assignment);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment.id]);

  function open(m) {
    setError("");
    setMode(m);
    if (m === "fix") {
      setForm({
        work_reference: row.work_reference,
        hours: String(row.hours),
        rate: String(row.rate),
        adjustment_amount: String(row.adjustment_amount || 0),
        edit_reason: "",
      });
    } else {
      setForm({ direction: "owe", amount: "", note: "" });
    }
  }

  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setMode(null);
      await reload();
      onChanged?.();
    } catch (err) {
      const d = err.response?.data?.detail;
      setError(Array.isArray(d) ? d.map((x) => x.msg).join("; ") : d || "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const saveCorrection = () =>
    run(() => {
      const amt = mode === "note" ? 0 : Math.abs(Number(form.amount || 0)) * (form.direction === "owe" ? 1 : -1);
      if (mode === "money" && !amt) throw { response: { data: { detail: "Enter the amount" } } };
      return client.post("/corrections", { assignment_id: row.id, amount: amt, note: form.note });
    });

  const saveFix = () =>
    run(() => {
      const body = { edit_reason: form.edit_reason };
      if (form.work_reference.trim() !== row.work_reference) body.work_reference = form.work_reference.trim();
      if (Number(form.hours) !== Number(row.hours)) body.hours = Number(form.hours || 0);
      if (Number(form.rate) !== Number(row.rate)) body.rate = Number(form.rate || 0);
      if (Number(form.adjustment_amount) !== Number(row.adjustment_amount || 0))
        body.adjustment_amount = Number(form.adjustment_amount || 0);
      return client.patch(`/assignments/${row.id}`, body);
    });

  const fixPreview =
    mode === "fix" ? Number(form.hours || 0) * Number(form.rate || 0) + Number(form.adjustment_amount || 0) : 0;
  const netCorrections = corrections
    .filter((c) => ["approved", "registered", "paid"].includes(c.status))
    .reduce((s, c) => s + Number(c.amount), 0);

  return (
    <div className="drawer-back" onClick={onClose}>
      <div className="drawer wide" onClick={(e) => e.stopPropagation()}>
        <button className="drawer-x" onClick={onClose} aria-label="Close">×</button>
        <div className="small-muted">{row.period.label} · {row.program.code} · {row.role.name}</div>
        <h2>{row.person.name}</h2>
        <div className="small-muted" style={{ marginBottom: 12 }}>{row.work_reference}</div>

        <div className="drawer-amount">
          {money(row.total_amount)}{" "}
          <span className="small-muted">
            {row.hours}h × ${Number(row.rate).toFixed(2)}
            {Number(row.adjustment_amount) !== 0 && ` ${signed(row.adjustment_amount)} adj.`}
          </span>
          <div style={{ marginTop: 6 }}><StatusPill status={row.status} /></div>
          {netCorrections !== 0 && (
            <div className="small-muted" style={{ marginTop: 8 }}>
              With approved corrections: <strong>{money(row.total_amount + netCorrections)}</strong> ({signed(netCorrections)})
            </div>
          )}
        </div>

        {row.notes && <p className="hint">Notes: {row.notes}</p>}

        <div className="drawer-block">
          <h4>Fix something</h4>
          {mode === null && (
            <div className="actions" style={{ flexWrap: "wrap" }}>
              <button className="secondary sm" onClick={() => open("note")}>Add a note</button>
              <button className="secondary sm" onClick={() => open("money")}>Payment difference</button>
              {isReviewer && AFTER_APPROVAL.includes(row.status) && (
                <button className="secondary sm" onClick={() => open("fix")}>Fix the record</button>
              )}
            </div>
          )}
          {mode === null && (
            <p className="hint" style={{ marginTop: 10 }}>
              <strong>Note</strong>: leaves a comment, no money moves. <strong>Payment difference</strong>: we still owe
              something, or paid too much — {isReviewer ? "once approved it goes" : "Kevin approves it and it goes"} to
              Payments.{" "}
              {isReviewer && AFTER_APPROVAL.includes(row.status) && (
                <>
                  <strong>Fix the record</strong>: the numbers on file are wrong but the payment itself was right (e.g. a
                  typo) — no new payment is created.
                </>
              )}
            </p>
          )}

          {(mode === "note" || mode === "money") && (
            <div className="drawer-form">
              {mode === "money" && (
                <div className="two">
                  <div className="field">
                    <label>What happened</label>
                    <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
                      <option value="owe">We still owe them</option>
                      <option value="over">We paid too much</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Amount ($)</label>
                    <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} autoFocus />
                  </div>
                </div>
              )}
              <div className="field">
                <label>{mode === "note" ? "Note" : "Why (what was missed or wrong)"}</label>
                <textarea rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder={mode === "note" ? "e.g. Hours confirmed with the instructor on Nov 3" : "e.g. 3 grading hours from Oct 28 were not included"} />
              </div>
              {mode === "money" && form.amount && (
                <p className="hint">
                  {form.direction === "owe"
                    ? `${money(form.amount)} will be added to what ${row.person.name} is paid.`
                    : `${money(form.amount)} will be deducted from a future payment to ${row.person.name}.`}
                </p>
              )}
              <div className="actions">
                <button className="primary sm" disabled={busy || (form.note || "").trim().length < 3} onClick={saveCorrection}>
                  {busy ? "Saving…" : mode === "note" ? "Save note" : "Send correction"}
                </button>
                <button className="secondary sm" onClick={() => setMode(null)}>Cancel</button>
              </div>
            </div>
          )}

          {mode === "fix" && (
            <div className="drawer-form">
              <div className="banner warn">
                This changes the record only. If money is still owed or was overpaid, use <strong>Payment difference</strong> instead.
              </div>
              <div className="field">
                <label>Cohort / work</label>
                <input value={form.work_reference} onChange={(e) => setForm({ ...form, work_reference: e.target.value })} />
              </div>
              <div className="two">
                <div className="field"><label>Hours</label><input type="number" step="0.01" min="0" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} /></div>
                <div className="field"><label>Rate</label><input type="number" step="0.01" min="0" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></div>
              </div>
              <div className="field"><label>Adjustment ($, + or -)</label><input type="number" step="0.01" value={form.adjustment_amount} onChange={(e) => setForm({ ...form, adjustment_amount: e.target.value })} /></div>
              <p className="hint">New total: <strong>{money(fixPreview)}</strong> (was {money(row.total_amount)})</p>
              <div className="field">
                <label>Why are you changing it?</label>
                <textarea rows={2} value={form.edit_reason} onChange={(e) => setForm({ ...form, edit_reason: e.target.value })} placeholder="Required — it's saved in the history" />
              </div>
              <div className="actions">
                <button className="primary sm" disabled={busy || !form.edit_reason.trim()} onClick={saveFix}>
                  {busy ? "Saving…" : "Save fix"}
                </button>
                <button className="secondary sm" onClick={() => setMode(null)}>Cancel</button>
              </div>
            </div>
          )}
          {error && <div className="banner" style={{ marginTop: 10 }}>{error}</div>}
        </div>

        <div className="drawer-block">
          <h4>Corrections &amp; notes ({corrections.length})</h4>
          {corrections.length === 0 ? (
            <p className="small-muted">None.</p>
          ) : (
            corrections.map((c) => (
              <CorrectionCard key={c.id} c={c} isReviewer={isReviewer} me={user}
                onChanged={async () => { await reload(); onChanged?.(); }} />
            ))
          )}
        </div>

        <div className="drawer-block">
          <h4>History</h4>
          <ol className="timeline">
            {[...(row.history || [])].reverse().map((h, i) => (
              <li key={i}>
                <div><strong>{actionLabel(h.action)}</strong>{h.user && <span className="small-muted"> · {h.user}</span>}</div>
                {h.details && <div className="small-muted">{h.details}</div>}
                <div className="tl-when">{when(h.at)}</div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

/** One correction, with approve / reject / settle / withdraw where allowed. */
export function CorrectionCard({ c, isReviewer, me, onChanged, showRow }) {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  async function act(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.detail || "Could not update");
    } finally {
      setBusy(false);
    }
  }
  const mine = me && c.created_by_name === me.name;

  return (
    <div className={`correction-card ${Number(c.amount) < 0 ? "neg" : Number(c.amount) > 0 ? "pos" : ""}`}>
      <div className="cc-top">
        <strong>{Number(c.amount) === 0 ? "Note" : signed(c.amount)}</strong>
        <CorrectionPill status={c.status} />
      </div>
      {showRow && <div className="small-muted">{c.person_name} · {c.assignment_label} · {c.period_label}</div>}
      <div className="cc-note">{c.note}</div>
      <div className="small-muted">
        {c.created_by_name || "Someone"} · {when(c.created_at)} · row was {c.assignment_status.replace("_", " ")}
      </div>
      {c.resolution && <div className="small-muted">Reason: {c.resolution}</div>}
      {error && <div className="banner" style={{ marginTop: 6 }}>{error}</div>}
      {rejecting ? (
        <div className="actions" style={{ marginTop: 8 }}>
          <input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: 1 }} />
          <button className="danger sm" disabled={busy} onClick={() => act(() => client.post(`/corrections/${c.id}/reject`, { reason }))}>Reject</button>
          <button className="secondary sm" onClick={() => setRejecting(false)}>Cancel</button>
        </div>
      ) : (
        <div className="actions" style={{ marginTop: 8, flexWrap: "wrap" }}>
          {isReviewer && c.status === "open" && (
            <button className="primary sm" disabled={busy} onClick={() => act(() => client.post(`/corrections/${c.id}/approve`))}>Approve</button>
          )}
          {isReviewer && ["approved", "registered"].includes(c.status) && (
            <button className="primary sm" disabled={busy}
              onClick={() => act(() => client.post("/corrections/payment-status", { correction_ids: [c.id], status: "paid" }))}>
              {Number(c.amount) < 0 ? "Mark deducted" : "Mark paid"}
            </button>
          )}
          {isReviewer && c.status === "paid" && (
            <button className="secondary sm" disabled={busy}
              onClick={() => act(() => client.post("/corrections/payment-status", { correction_ids: [c.id], status: "approved" }))}>
              Undo settle
            </button>
          )}
          {isReviewer && ["open", "approved"].includes(c.status) && (
            <button className="danger sm" disabled={busy} onClick={() => setRejecting(true)}>Reject</button>
          )}
          {(isReviewer || mine) && ["open", "noted", "rejected"].includes(c.status) && (
            <button className="linklike" disabled={busy} onClick={() => act(() => client.delete(`/corrections/${c.id}`))}>Withdraw</button>
          )}
        </div>
      )}
    </div>
  );
}
