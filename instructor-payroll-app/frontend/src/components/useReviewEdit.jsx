import { useState } from "react";
import client from "../api/client";

/**
 * Inline editing of cohort name, hours and rate for items already in review.
 * Used by the Admin Review and Final Approval queues. The backend logs every
 * change (before -> after) and returns it as `review_changes`.
 */
export function useReviewEdit(onSaved) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({ work_reference: "", hours: "", rate: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function start(a) {
    setError("");
    setEditingId(a.id);
    setDraft({ work_reference: a.work_reference, hours: String(a.hours), rate: String(a.rate) });
  }

  function cancel() {
    setEditingId(null);
    setError("");
  }

  async function save(a) {
    const body = {};
    if (draft.work_reference.trim() !== a.work_reference) body.work_reference = draft.work_reference.trim();
    if (Number(draft.hours) !== Number(a.hours)) body.hours = Number(draft.hours || 0);
    if (Number(draft.rate) !== Number(a.rate)) body.rate = Number(draft.rate || 0);
    if (Object.keys(body).length === 0) {
      cancel();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await client.patch(`/assignments/${a.id}`, body);
      setEditingId(null);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.detail || "Could not save changes");
    } finally {
      setSaving(false);
    }
  }

  const isEditing = (a) => editingId === a.id;
  const previewTotal = (a) =>
    Number(draft.hours || 0) * Number(draft.rate || 0) + Number(a.adjustment_amount || 0);

  return { editingId, draft, setDraft, saving, error, start, cancel, save, isEditing, previewTotal };
}

/** Cohort / hours / rate cells — plain text, or inputs while editing. */
export function ReviewEditCells({ a, edit }) {
  if (!edit.isEditing(a)) {
    return (
      <>
        <td>{a.work_reference}</td>
        <td>{a.hours}</td>
        <td>${Number(a.rate).toFixed(2)}</td>
      </>
    );
  }
  const { draft, setDraft } = edit;
  return (
    <>
      <td>
        <input
          className="cell-input"
          value={draft.work_reference}
          onChange={(e) => setDraft({ ...draft, work_reference: e.target.value })}
          style={{ minWidth: 140 }}
        />
      </td>
      <td>
        <input
          className="cell-input"
          type="number"
          step="0.01"
          min="0"
          value={draft.hours}
          onChange={(e) => setDraft({ ...draft, hours: e.target.value })}
          style={{ width: 80 }}
        />
      </td>
      <td>
        <input
          className="cell-input"
          type="number"
          step="0.01"
          min="0"
          value={draft.rate}
          onChange={(e) => setDraft({ ...draft, rate: e.target.value })}
          style={{ width: 90 }}
        />
      </td>
    </>
  );
}

/** Small note under the person name listing reviewer edits, so the next approver sees them. */
export function ReviewChanges({ a }) {
  if (!a.review_changes?.length) return null;
  return (
    <div className="review-changes">
      {a.review_changes.map((c, i) => (
        <div key={i}>✎ {c}</div>
      ))}
    </div>
  );
}
