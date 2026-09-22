import { Fragment, useEffect, useState, useCallback } from "react";
import client from "../api/client";
import StatusPill from "../components/StatusPill.jsx";
import StatCard from "../components/StatCard.jsx";
import BarRow from "../components/BarRow.jsx";
import PeriodSelector from "../components/PeriodSelector.jsx";

const CATEGORY_LABELS = {
  cohort_class: "Cohort / Class Instruction",
  mentorship_private: "Mentorship / Private Sessions",
  overhead_admin: "Overhead / Admin",
};

const money = (v) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hrs = (v) => `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })} hrs`;

// Program lookup keyed by code -- enrollment upserts need a program_id, but
// CohortSummary only carries program_code (it's grouped from Assignment
// rows, which don't need a program object round-tripped for this).
function useProgramIdByCode(byProgramRaw) {
  const map = {};
  for (const p of byProgramRaw) map[p.program_code] = p.program_id;
  return map;
}

export default function Dashboard() {
  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState(null);
  const [byPerson, setByPerson] = useState([]);
  const [byProgram, setByProgram] = useState([]);
  const [byCategory, setByCategory] = useState([]);
  const [byCohort, setByCohort] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [expandedPerson, setExpandedPerson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [enrollmentDrafts, setEnrollmentDrafts] = useState({});
  const [savingKey, setSavingKey] = useState(null);

  const load = useCallback(async () => {
    if (!periodId) return;
    setLoading(true);
    const [p, prog, cat, coh, a] = await Promise.all([
      client.get("/assignments/summary/by-person", { params: { period_id: periodId } }),
      client.get("/assignments/summary/by-program", { params: { period_id: periodId } }),
      client.get("/assignments/summary/by-category", { params: { period_id: periodId } }),
      client.get("/assignments/summary/by-cohort", { params: { period_id: periodId } }),
      client.get("/assignments", { params: { period_id: periodId } }),
    ]);
    setByPerson(p.data);
    setByProgram(prog.data);
    setByCategory(cat.data);
    setByCohort(coh.data);
    setAssignments(a.data);
    setEnrollmentDrafts({});
    setLoading(false);
  }, [periodId]);

  const programIdByCode = useProgramIdByCode(byProgram);

  const draftFor = (c) => {
    const key = `${c.program_code}-${c.work_reference}`;
    return enrollmentDrafts[key] ?? {
      current_students: c.current_students ?? "",
      projected_end_of_month_students: c.projected_end_of_month_students ?? "",
    };
  };

  const setDraft = (c, field, value) => {
    const key = `${c.program_code}-${c.work_reference}`;
    setEnrollmentDrafts((prev) => ({
      ...prev,
      [key]: { ...draftFor(c), [field]: value },
    }));
  };

  const saveEnrollment = async (c) => {
    const programId = programIdByCode[c.program_code];
    if (!programId) return;
    const key = `${c.program_code}-${c.work_reference}`;
    const draft = draftFor(c);
    setSavingKey(key);
    try {
      await client.put("/enrollment", {
        program_id: programId,
        work_reference: c.work_reference,
        period_id: periodId,
        current_students: draft.current_students === "" ? 0 : Number(draft.current_students),
        projected_end_of_month_students:
          draft.projected_end_of_month_students === "" ? null : Number(draft.projected_end_of_month_students),
      });
      await load();
    } finally {
      setSavingKey(null);
    }
  };

  useEffect(() => {
    client.get("/periods").then((res) => {
      setPeriods(res.data);
      if (res.data.length) setPeriodId(res.data[0].id);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const grandTotal = byPerson.reduce((sum, p) => sum + p.total_amount, 0);
  const grandHours = byPerson.reduce((sum, p) => sum + p.total_hours, 0);
  const maxProgram = Math.max(1, ...byProgram.map((p) => p.total_amount));
  const maxCategory = Math.max(1, ...byCategory.map((c) => c.total_amount));
  const maxCohort = Math.max(1, ...byCohort.map((c) => c.total_amount));

  const orderedCategories = ["cohort_class", "mentorship_private", "overhead_admin"]
    .map((key) => byCategory.find((c) => c.category === key))
    .filter(Boolean);

  const sortedCohorts = [...byCohort].sort((a, b) => b.total_amount - a.total_amount);

  if (loading && byPerson.length === 0) {
    return (
      <>
        <h1>Payroll <em>dashboard</em></h1>
        <p className="subhead">Loading...</p>
      </>
    );
  }

  return (
    <>
      <h1>Payroll <em>dashboard</em></h1>
      <p className="subhead">
        What this period costs, broken down by cohort/class, mentorship &amp; private
        sessions, and who's staffed where.
      </p>

      {periods.length > 0 && (
        <PeriodSelector periods={periods} value={periodId} onChange={setPeriodId} />
      )}

      <div className="grid cols-4" style={{ marginBottom: 28 }}>
        <StatCard tone="blue" label="Total to pay" value={money(grandTotal)} sub={`${byPerson.length} people`} />
        <StatCard tone="amber" label="Total hours logged" value={hrs(grandHours)} />
        <StatCard
          tone="cream"
          label="Cohorts / classes staffed"
          value={byCohort.length}
          sub={`${byProgram.length} programs`}
        />
        <StatCard
          tone="gray"
          label="Mentorship & private sessions"
          value={money(orderedCategories.find((c) => c.category === "mentorship_private")?.total_amount || 0)}
        />
      </div>

      <div className="section-title">Cost by category</div>
      <div className="card" style={{ marginBottom: 20 }}>
        {orderedCategories.map((c) => (
          <BarRow
            key={c.category}
            label={CATEGORY_LABELS[c.category]}
            value={c.total_amount}
            max={maxCategory}
            formatValue={money}
            sub={`${c.assignment_count} assignments · ${hrs(c.total_hours)}`}
          />
        ))}
      </div>

      <div className="section-title">Cost by program</div>
      <div className="card" style={{ marginBottom: 20 }}>
        {byProgram.map((p) => (
          <BarRow
            key={p.program_id}
            label={p.program_code}
            value={p.total_amount}
            max={maxProgram}
            formatValue={money}
            sub={`${p.assignment_count} assignments · ${hrs(p.total_hours)}`}
          />
        ))}
      </div>

      <div className="section-title">Cost by cohort / class &mdash; resources &amp; enrollment</div>
      <div className="card" style={{ marginBottom: 20 }}>
        <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
          Student counts are entered here manually (not synced from another system).
          Enter current enrollment and a projected end-of-month count, then save — this
          drives cost-per-student and the staffing-ratio check below.
        </p>
        {sortedCohorts.length === 0 ? (
          <div className="empty-state">No cohort/class-tied assignments this period.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Program</th>
                <th>Cohort / Class</th>
                <th>Assigned people</th>
                <th>Roles</th>
                <th>Hours</th>
                <th>Cost</th>
                <th>Students (current)</th>
                <th>Students (proj. EOM)</th>
                <th>Cost / student</th>
                <th>Students / staff</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedCohorts.map((c) => {
                const key = `${c.program_code}-${c.work_reference}`;
                const draft = draftFor(c);
                const hasProgram = Boolean(programIdByCode[c.program_code]);
                return (
                  <tr key={key} style={c.unstaffed_flag ? { background: "var(--red-soft)" } : undefined}>
                    <td>{c.program_code}</td>
                    <td>
                      {c.work_reference}
                      {c.unstaffed_flag && (
                        <div className="small-muted" style={{ color: "var(--red)", fontWeight: 700, marginTop: 2 }}>
                          ⚠ students enrolled, no instructor/TA assigned
                        </div>
                      )}
                    </td>
                    <td>{c.people.join(", ") || "—"}</td>
                    <td>{c.roles.join(", ") || "—"}</td>
                    <td>{c.total_hours.toFixed(2)}</td>
                    <td style={{ fontWeight: 700 }}>{money(c.total_amount)}</td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        value={draft.current_students}
                        onChange={(e) => setDraft(c, "current_students", e.target.value)}
                        style={{ width: 72, padding: "6px 8px" }}
                        disabled={!hasProgram}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        value={draft.projected_end_of_month_students}
                        onChange={(e) => setDraft(c, "projected_end_of_month_students", e.target.value)}
                        style={{ width: 72, padding: "6px 8px" }}
                        disabled={!hasProgram}
                      />
                    </td>
                    <td>{c.cost_per_student != null ? money(c.cost_per_student) : "—"}</td>
                    <td>{c.students_per_staff != null ? c.students_per_staff.toFixed(1) : "—"}</td>
                    <td>
                      <button
                        className="secondary"
                        style={{ padding: "6px 12px", fontSize: 12 }}
                        disabled={!hasProgram || savingKey === key}
                        onClick={() => saveEnrollment(c)}
                      >
                        {savingKey === key ? "Saving…" : "Save"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="section-title">By person</div>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Person</th>
              <th># Assignments</th>
              <th>Total hours</th>
              <th>Total amount</th>
            </tr>
          </thead>
          <tbody>
            {byPerson.map((p) => (
              <Fragment key={p.person_id}>
                <tr
                  style={{ cursor: "pointer" }}
                  onClick={() =>
                    setExpandedPerson(expandedPerson === p.person_id ? null : p.person_id)
                  }
                >
                  <td>{expandedPerson === p.person_id ? "▾" : "▸"}</td>
                  <td>{p.person_name}</td>
                  <td>{p.assignment_count}</td>
                  <td>{p.total_hours.toFixed(2)}</td>
                  <td style={{ fontWeight: 700 }}>{money(p.total_amount)}</td>
                </tr>
                {expandedPerson === p.person_id && (
                  <tr>
                    <td colSpan={5} style={{ background: "var(--bg-gray)", padding: 0 }}>
                      <table style={{ margin: "8px 0" }}>
                        <thead>
                          <tr>
                            <th>Program</th>
                            <th>Role</th>
                            <th>Work reference</th>
                            <th>Category</th>
                            <th>Hours</th>
                            <th>Rate</th>
                            <th>Total</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {assignments
                            .filter((a) => a.person.id === p.person_id)
                            .map((a) => (
                              <tr key={a.id}>
                                <td>{a.program.code}</td>
                                <td>{a.role.name}</td>
                                <td>{a.work_reference}</td>
                                <td>
                                  <span className={`pill cat-${a.work_category}`}>
                                    {CATEGORY_LABELS[a.work_category]}
                                  </span>
                                </td>
                                <td>{a.hours}</td>
                                <td>${Number(a.rate).toFixed(2)}</td>
                                <td>{money(a.total_amount)}</td>
                                <td><StatusPill status={a.status} /></td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
