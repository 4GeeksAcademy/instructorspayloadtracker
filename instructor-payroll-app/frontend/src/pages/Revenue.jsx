import { useEffect, useState, useCallback } from "react";
import client from "../api/client";
import PeriodSelector from "../components/PeriodSelector.jsx";
import { useAuth } from "../api/auth.jsx";

const money = (v) =>
  v == null ? "—" : `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const EMPTY_STUDENT = {
  name: "",
  monthly_payment: "",
  total_paid: "0",
  total_committed: "",
  notes: "",
};

export default function Revenue() {
  const { user } = useAuth();
  const isOwner = user.role === "owner";

  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState(null);
  const [programs, setPrograms] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loadingSummary, setLoadingSummary] = useState(isOwner);

  const [selectedProgramId, setSelectedProgramId] = useState("");
  const [selectedCohort, setSelectedCohort] = useState("");
  const [students, setStudents] = useState([]);
  const [newRow, setNewRow] = useState(EMPTY_STUDENT);
  const [savingId, setSavingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOwner) {
      client.get("/periods").then((res) => {
        setPeriods(res.data);
        if (res.data.length) setPeriodId(res.data[0].id);
      });
    }
    client.get("/programs").then((res) => setPrograms(res.data));
  }, [isOwner]);

  const loadSummary = useCallback(async () => {
    // The cohort performance / margin view is owner-only server-side too --
    // admins can manage the roster below but never call this endpoint.
    if (!isOwner) return;
    setLoadingSummary(true);
    const res = await client.get("/revenue/summary", { params: periodId ? { period_id: periodId } : {} });
    setSummary(res.data);
    setLoadingSummary(false);
  }, [periodId, isOwner]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const loadStudents = useCallback(async (programId, workReference) => {
    if (!programId || !workReference) {
      setStudents([]);
      return;
    }
    const res = await client.get("/revenue/students", {
      params: { program_id: programId, work_reference: workReference },
    });
    setStudents(res.data);
  }, []);

  const openCohort = (programId, workReference) => {
    setSelectedProgramId(programId);
    setSelectedCohort(workReference);
    setNewRow(EMPTY_STUDENT);
    setConfirmDeleteId(null);
    setError("");
    loadStudents(programId, workReference);
  };

  const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));

  const updateStudentField = (id, field, value) => {
    setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  const saveStudent = async (student) => {
    setSavingId(student.id);
    setError("");
    try {
      await client.patch(`/revenue/students/${student.id}`, {
        name: student.name,
        monthly_payment: num(student.monthly_payment),
        total_paid: num(student.total_paid) ?? 0,
        total_committed: num(student.total_committed),
        notes: student.notes || null,
        active: student.active,
      });
      await Promise.all([loadStudents(selectedProgramId, selectedCohort), loadSummary()]);
    } catch (err) {
      setError(err.response?.data?.detail || "Could not save student");
    } finally {
      setSavingId(null);
    }
  };

  const addStudent = async (e) => {
    e.preventDefault();
    if (!newRow.name.trim()) return;
    setSavingId("new");
    setError("");
    try {
      await client.post("/revenue/students", {
        program_id: selectedProgramId,
        work_reference: selectedCohort,
        name: newRow.name.trim(),
        monthly_payment: num(newRow.monthly_payment),
        total_paid: num(newRow.total_paid) ?? 0,
        total_committed: num(newRow.total_committed),
        notes: newRow.notes || null,
      });
      setNewRow(EMPTY_STUDENT);
      await Promise.all([loadStudents(selectedProgramId, selectedCohort), loadSummary()]);
    } catch (err) {
      setError(err.response?.data?.detail || "Could not add student");
    } finally {
      setSavingId(null);
    }
  };

  const deleteStudent = async (id) => {
    setSavingId(id);
    try {
      await client.delete(`/revenue/students/${id}`);
      setConfirmDeleteId(null);
      await Promise.all([loadStudents(selectedProgramId, selectedCohort), loadSummary()]);
    } finally {
      setSavingId(null);
    }
  };

  // Cohorts already seen in revenue data, for the picker below -- plus
  // whatever's typed lets you start a brand-new one. Admins don't have the
  // summary to draw this from, so they just type the cohort's reference.
  const knownCohorts = isOwner
    ? [...new Map(summary.map((c) => [`${c.program_code}-${c.work_reference}`, c])).values()]
    : [];

  return (
    <>
      <h1>{isOwner ? <>Revenue <em>(private)</em></> : "Students"}</h1>
      <p className="subhead">
        {isOwner
          ? "What each class brings in vs. what it costs to run. Only you can see this page — it's separate from the payroll dashboard admins and program leads use."
          : "Add or manage the students enrolled in a cohort — name, monthly payment, and total tuition committed."}
      </p>

      {isOwner && periods.length > 0 && (
        <PeriodSelector periods={periods} value={periodId} onChange={setPeriodId} />
      )}

      {isOwner && (
        <>
          <div className="section-title">Cohort performance</div>
          <div className="card" style={{ marginBottom: 20 }}>
            <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
              Revenue (monthly payments, paid-to-date, committed) isn't tied to a pay period —
              it's a running total per cohort. Cost is pulled from the pay period selected above,
              so the margin column shows "this month's revenue vs. this month's payroll cost."
            </p>
            {loadingSummary ? (
              <div className="empty-state">Loading…</div>
            ) : summary.length === 0 ? (
              <div className="empty-state">
                No revenue or cost data yet. Pick a program and cohort below to add students.
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Program</th>
                    <th>Cohort / Class</th>
                    <th>Students</th>
                    <th>Monthly revenue</th>
                    <th>Paid to date</th>
                    <th>Committed</th>
                    <th>Balance remaining</th>
                    <th>{summary[0]?.period_label || "Period"} cost</th>
                    <th>Monthly margin</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {[...summary]
                    .sort((a, b) => (a.monthly_margin ?? Infinity) - (b.monthly_margin ?? Infinity))
                    .map((c) => {
                      const program = programs.find((p) => p.code === c.program_code);
                      return (
                        <tr key={`${c.program_code}-${c.work_reference}`}>
                          <td>{c.program_code}</td>
                          <td>{c.work_reference}</td>
                          <td>{c.student_count}</td>
                          <td>{money(c.total_monthly)}</td>
                          <td>{money(c.total_paid)}</td>
                          <td>{money(c.total_committed)}</td>
                          <td>{money(c.total_balance_remaining)}</td>
                          <td>{money(c.period_cost)}</td>
                          <td
                            style={{
                              fontWeight: 700,
                              color: c.monthly_margin == null ? undefined : c.monthly_margin < 0 ? "var(--red)" : "var(--green)",
                            }}
                          >
                            {money(c.monthly_margin)}
                          </td>
                          <td>
                            {program && (
                              <button
                                className="secondary"
                                style={{ padding: "6px 12px", fontSize: 12 }}
                                onClick={() => openCohort(program.id, c.work_reference)}
                              >
                                Manage students
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      <div className="section-title">Add or manage students for a cohort</div>
      <div className="card">
        <div className="form-grid" style={{ marginBottom: 16 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Program</label>
            <select value={selectedProgramId} onChange={(e) => setSelectedProgramId(Number(e.target.value) || "")}>
              <option value="">Select a program…</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Cohort / class (work reference)</label>
            <input
              list="known-cohorts"
              value={selectedCohort}
              onChange={(e) => setSelectedCohort(e.target.value)}
              placeholder="ft-ai-eng-2, or a new cohort slug"
            />
            <datalist id="known-cohorts">
              {knownCohorts.map((c) => (
                <option key={`${c.program_code}-${c.work_reference}`} value={c.work_reference} />
              ))}
            </datalist>
          </div>
          <div className="field" style={{ marginBottom: 0, display: "flex", alignItems: "flex-end" }}>
            <button
              className="primary"
              type="button"
              disabled={!selectedProgramId || !selectedCohort}
              onClick={() => openCohort(selectedProgramId, selectedCohort)}
            >
              Load roster
            </button>
          </div>
        </div>

        {error && <div className="banner">{error}</div>}

        {selectedProgramId && selectedCohort ? (
          <>
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Monthly payment</th>
                  <th>Paid to date</th>
                  <th>Committed</th>
                  <th>Balance</th>
                  <th>Notes</th>
                  <th>Active</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <input value={s.name} onChange={(e) => updateStudentField(s.id, "name", e.target.value)} style={{ width: 140 }} />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        value={s.monthly_payment ?? ""}
                        onChange={(e) => updateStudentField(s.id, "monthly_payment", e.target.value)}
                        style={{ width: 90 }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        value={s.total_paid ?? ""}
                        onChange={(e) => updateStudentField(s.id, "total_paid", e.target.value)}
                        style={{ width: 90 }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        value={s.total_committed ?? ""}
                        onChange={(e) => updateStudentField(s.id, "total_committed", e.target.value)}
                        style={{ width: 90 }}
                      />
                    </td>
                    <td>{money(s.balance_remaining)}</td>
                    <td>
                      <input value={s.notes || ""} onChange={(e) => updateStudentField(s.id, "notes", e.target.value)} style={{ width: 120 }} />
                    </td>
                    <td>
                      <input type="checkbox" checked={s.active} onChange={(e) => updateStudentField(s.id, "active", e.target.checked)} />
                    </td>
                    <td className="actions">
                      <button
                        className="secondary"
                        style={{ padding: "6px 12px", fontSize: 12 }}
                        disabled={savingId === s.id}
                        onClick={() => saveStudent(s)}
                      >
                        {savingId === s.id ? "Saving…" : "Save"}
                      </button>
                      {confirmDeleteId === s.id ? (
                        <>
                          <button className="danger" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => deleteStudent(s.id)}>
                            Confirm
                          </button>
                          <button className="secondary" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setConfirmDeleteId(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button className="danger" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setConfirmDeleteId(s.id)}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <form onSubmit={addStudent} className="form-grid" style={{ marginTop: 18, alignItems: "flex-end" }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>New student name</label>
                <input
                  value={newRow.name}
                  onChange={(e) => setNewRow({ ...newRow, name: e.target.value })}
                  placeholder="Full name"
                  required
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Monthly payment</label>
                <input
                  type="number"
                  min="0"
                  value={newRow.monthly_payment}
                  onChange={(e) => setNewRow({ ...newRow, monthly_payment: e.target.value })}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Total committed</label>
                <input
                  type="number"
                  min="0"
                  value={newRow.total_committed}
                  onChange={(e) => setNewRow({ ...newRow, total_committed: e.target.value })}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <button className="primary" disabled={savingId === "new"}>
                  {savingId === "new" ? "Adding…" : "+ Add student"}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="empty-state">Pick a program and cohort above to see or add students.</div>
        )}
      </div>
    </>
  );
}
