import { useEffect, useState, useCallback } from "react";
import client from "../api/client";
import { useAuth } from "../api/auth.jsx";
import StatusPill from "../components/StatusPill.jsx";
import PeriodSelector from "../components/PeriodSelector.jsx";

const EMPTY_FORM = {
  person_name: "",
  program_id: "",
  role_id: "",
  work_reference: "",
  work_category: "",
  rate: "",
  hours: "",
  adjustment_amount: "0",
  adjustment_reason: "",
  hours_verified: false,
  notes: "",
};

const CATEGORY_SHORT = {
  cohort_class: "Cohort/Class",
  mentorship_private: "Mentorship",
  overhead_admin: "Overhead",
};

const CATEGORY_OPTIONS = [
  { value: "", label: "Auto-detect from cohort/work reference" },
  { value: "cohort_class", label: "Cohort / Class Instruction" },
  { value: "mentorship_private", label: "Mentorship / Private Sessions" },
  { value: "overhead_admin", label: "Overhead / Admin" },
];

export default function SubmitHours() {
  const { user } = useAuth();
  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState(null);
  const [programs, setPrograms] = useState([]);
  const [roles, setRoles] = useState([]);
  const [people, setPeople] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const loadReference = useCallback(async () => {
    const [p, prog, r, ppl] = await Promise.all([
      client.get("/periods"),
      client.get("/programs"),
      client.get("/roles"),
      client.get("/people"),
    ]);
    setPeriods(p.data);
    setPrograms(prog.data);
    setRoles(r.data);
    setPeople(ppl.data);
    if (p.data.length && !periodId) setPeriodId(p.data[0].id);
    if (user.program_id) setForm((f) => ({ ...f, program_id: user.program_id }));
  }, [periodId, user.program_id]);

  const loadAssignments = useCallback(async () => {
    if (!periodId) return;
    const res = await client.get("/assignments", { params: { period_id: periodId } });
    setAssignments(res.data);
  }, [periodId]);

  useEffect(() => {
    loadReference();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  async function findOrCreatePerson(name) {
    const existing = people.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
    if (existing) return existing.id;
    const res = await client.post("/people", { name: name.trim() });
    setPeople((prev) => [...prev, res.data]);
    return res.data.id;
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    if (!periodId) return;
    setSaving(true);
    try {
      const personId = await findOrCreatePerson(form.person_name);
      await client.post("/assignments", {
        person_id: personId,
        program_id: Number(form.program_id),
        role_id: Number(form.role_id),
        period_id: periodId,
        work_reference: form.work_reference,
        work_category: form.work_category || null,
        rate: Number(form.rate),
        hours: Number(form.hours || 0),
        adjustment_amount: Number(form.adjustment_amount || 0),
        adjustment_reason: form.adjustment_reason || null,
        hours_verified: form.hours_verified,
        notes: form.notes || null,
      });
      setForm({ ...EMPTY_FORM, program_id: user.program_id || "" });
      loadAssignments();
    } catch (err) {
      setError(err.response?.data?.detail || "Could not save assignment");
    } finally {
      setSaving(false);
    }
  }

  async function submitForReview(id) {
    await client.post(`/assignments/${id}/submit`);
    loadAssignments();
  }

  const editable = assignments.filter((a) => ["draft", "rejected"].includes(a.status));
  const inFlight = assignments.filter((a) => !["draft", "rejected"].includes(a.status));

  const monthTotal = assignments.reduce((sum, a) => sum + a.total_amount, 0);

  return (
    <>
      <h1>
        Submit instructor <em>hours</em>
      </h1>
      <p className="subhead">
        Add one row per person + role + program/cohort. Someone with more than one
        role this period gets more than one row.
      </p>

      {periods.length > 0 && (
        <PeriodSelector periods={periods} value={periodId} onChange={setPeriodId} />
      )}

      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>New assignment</h3>
        {error && <div className="banner">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="form-grid">
            <div className="field">
              <label>Person</label>
              <input
                list="people-list"
                value={form.person_name}
                onChange={(e) => setForm({ ...form, person_name: e.target.value })}
                placeholder="Full name"
                required
              />
              <datalist id="people-list">
                {people.map((p) => (
                  <option key={p.id} value={p.name} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label>Program</label>
              <select
                value={form.program_id}
                onChange={(e) => setForm({ ...form, program_id: e.target.value })}
                required
                disabled={!!user.program_id}
              >
                <option value="">Select...</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Role</label>
              <select
                value={form.role_id}
                onChange={(e) => setForm({ ...form, role_id: e.target.value })}
                required
              >
                <option value="">Select...</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field" style={{ gridColumn: "span 2" }}>
              <label>Cohort / work reference</label>
              <input
                value={form.work_reference}
                onChange={(e) => setForm({ ...form, work_reference: e.target.value })}
                placeholder='e.g. "ft-ai-eng-1", "AI All", or "Extra hours / grading"'
                required
              />
            </div>
            <div className="field">
              <label>Cost category</label>
              <select
                value={form.work_category}
                onChange={(e) => setForm({ ...form, work_category: e.target.value })}
              >
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <div className="hint">Drives the dashboard's cost breakdown. Leave on auto-detect unless it's wrong.</div>
            </div>
            <div className="field">
              <label>Rate ($/hr)</label>
              <input
                type="number"
                step="0.01"
                value={form.rate}
                onChange={(e) => setForm({ ...form, rate: e.target.value })}
                required
              />
            </div>

            <div className="field">
              <label>Hours</label>
              <input
                type="number"
                step="0.01"
                value={form.hours}
                onChange={(e) => setForm({ ...form, hours: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Adjustment ($)</label>
              <input
                type="number"
                step="0.01"
                value={form.adjustment_amount}
                onChange={(e) => setForm({ ...form, adjustment_amount: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Adjustment reason</label>
              <input
                value={form.adjustment_reason}
                onChange={(e) => setForm({ ...form, adjustment_reason: e.target.value })}
                placeholder="Only if adjustment != 0"
              />
            </div>

            <div className="field" style={{ gridColumn: "span 2" }}>
              <label>Notes</label>
              <input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Optional context for reviewers"
              />
            </div>
            <div className="field" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 22 }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={form.hours_verified}
                onChange={(e) => setForm({ ...form, hours_verified: e.target.checked })}
              />
              <label style={{ margin: 0 }}>Hours verified</label>
            </div>
          </div>
          <button className="primary" disabled={saving}>
            {saving ? "Saving..." : "Add as draft"}
          </button>
        </form>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Drafts &amp; rejected — ready to submit</h3>
        {editable.length === 0 ? (
          <div className="empty-state">No drafts pending submission.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Program</th>
                <th>Role</th>
                <th>Work reference</th>
                <th>Category</th>
                <th>Hours</th>
                <th>Rate</th>
                <th>Total</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {editable.map((a) => (
                <tr key={a.id}>
                  <td>{a.person.name}</td>
                  <td>{a.program.code}</td>
                  <td>{a.role.name}</td>
                  <td>{a.work_reference}</td>
                  <td><span className={`pill cat-${a.work_category}`}>{CATEGORY_SHORT[a.work_category]}</span></td>
                  <td>{a.hours}</td>
                  <td>${Number(a.rate).toFixed(2)}</td>
                  <td>${a.total_amount.toFixed(2)}</td>
                  <td><StatusPill status={a.status} /></td>
                  <td>
                    <button className="primary" onClick={() => submitForReview(a.id)}>
                      Submit for review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>In review / approved this period</h3>
        {inFlight.length === 0 ? (
          <div className="empty-state">Nothing submitted yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Program</th>
                <th>Role</th>
                <th>Work reference</th>
                <th>Category</th>
                <th>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {inFlight.map((a) => (
                <tr key={a.id}>
                  <td>{a.person.name}</td>
                  <td>{a.program.code}</td>
                  <td>{a.role.name}</td>
                  <td>{a.work_reference}</td>
                  <td><span className={`pill cat-${a.work_category}`}>{CATEGORY_SHORT[a.work_category]}</span></td>
                  <td>${a.total_amount.toFixed(2)}</td>
                  <td><StatusPill status={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="small-muted" style={{ marginTop: 14 }}>
          Period total (all statuses): <strong>${monthTotal.toFixed(2)}</strong>
        </p>
      </div>
    </>
  );
}
