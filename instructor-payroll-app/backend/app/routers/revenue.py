from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_owner_or_view_all, require_role
from app.models.models import (
    Assignment,
    AssignmentStatus,
    AuditLog,
    CohortEnrollment,
    PayPeriod,
    Program,
    Student,
    User,
    UserRole,
    WorkCategory,
)
from app.schemas.schemas import (
    CohortImpact,
    CohortRename,
    CohortRevenueSummary,
    StudentCreate,
    StudentOut,
    StudentUpdate,
)

# Student roster management (name/monthly payment/committed) is open to
# admin + owner -- straightforward data entry, same tier as Admin Review.
# The /summary endpoint (revenue vs. payroll cost, margin) stays owner-only:
# that's Marcelo's private profitability view, not something an admin should
# see alongside payroll data.
router = APIRouter(prefix="/revenue", tags=["revenue"])

roster_role = require_role(UserRole.admin, UserRole.owner)


@router.get("/students", response_model=list[StudentOut])
def list_students(
    program_id: int,
    work_reference: str,
    db: Session = Depends(get_db),
    user: User = Depends(roster_role),
):
    return (
        db.query(Student)
        .filter(Student.program_id == program_id, Student.work_reference == work_reference)
        .order_by(Student.name)
        .all()
    )


@router.post("/students", response_model=StudentOut)
def create_student(
    payload: StudentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(roster_role),
):
    if not db.query(Program.id).filter(Program.id == payload.program_id).first():
        raise HTTPException(status_code=400, detail=f"Invalid program_id: no record with id {payload.program_id}")

    student = Student(**payload.model_dump(), updated_by=user.id)
    db.add(student)
    db.commit()
    db.refresh(student)
    return student


@router.patch("/students/{student_id}", response_model=StudentOut)
def update_student(
    student_id: int,
    payload: StudentUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(roster_role),
):
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(student, field, value)
    student.updated_by = user.id

    db.commit()
    db.refresh(student)
    return student


@router.delete("/students/{student_id}", status_code=204)
def delete_student(
    student_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(roster_role),
):
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    db.delete(student)
    db.commit()
    return None


@router.get("/summary", response_model=list[CohortRevenueSummary])
def revenue_summary(
    period_id: Optional[int] = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_owner_or_view_all),
):
    """
    One row per cohort that has student payment data and/or cohort_class
    payroll cost in the given (or most recent, if omitted) pay period --
    revenue and cost side by side. A cohort with students entered but no
    payroll cost yet (or vice versa) still shows up, just with the other
    side blank, rather than being silently dropped from either list.

    Owner-only: this is the profitability view (revenue vs. payroll cost,
    margin). Admins can manage the student roster above but not this.
    """
    if period_id is None:
        # Latest month that has started (the Costs Hub can create future months).
        from datetime import date as _date
        latest = (db.query(PayPeriod).filter(PayPeriod.start_date <= _date.today())
                  .order_by(PayPeriod.start_date.desc()).first()
                  or db.query(PayPeriod).order_by(PayPeriod.start_date.desc()).first())
        period_id = latest.id if latest else None

    student_rows = (
        db.query(
            Program.code.label("program_code"),
            Student.work_reference.label("work_reference"),
            func.count(Student.id).label("student_count"),
            func.coalesce(func.sum(Student.monthly_payment), 0).label("total_monthly"),
            func.coalesce(func.sum(Student.total_paid), 0).label("total_paid"),
            func.coalesce(func.sum(Student.total_committed), 0).label("total_committed"),
        )
        .join(Program, Student.program_id == Program.id)
        .filter(Student.active.is_(True))
        .group_by(Program.code, Student.work_reference)
        .all()
    )
    revenue_by_cohort = {(r.program_code, r.work_reference): r for r in student_rows}

    cost_by_cohort: dict[tuple[str, str], float] = {}
    period_label = None
    if period_id:
        period = db.query(PayPeriod).filter(PayPeriod.id == period_id).first()
        period_label = period.label if period else None
        cost_rows = (
            db.query(
                Program.code.label("program_code"),
                Assignment.work_reference.label("work_reference"),
                func.coalesce(
                    func.sum(Assignment.hours * Assignment.rate + Assignment.adjustment_amount), 0
                ).label("total_amount"),
            )
            .join(Program, Assignment.program_id == Program.id)
            .filter(Assignment.period_id == period_id, Assignment.work_category == WorkCategory.cohort_class)
            .group_by(Program.code, Assignment.work_reference)
            .all()
        )
        cost_by_cohort = {(r.program_code, r.work_reference): float(r.total_amount) for r in cost_rows}

    keys = set(revenue_by_cohort.keys()) | set(cost_by_cohort.keys())
    results = []
    for key in keys:
        program_code, work_reference = key
        rev = revenue_by_cohort.get(key)
        total_monthly = float(rev.total_monthly) if rev else 0.0
        total_paid = float(rev.total_paid) if rev else 0.0
        total_committed = float(rev.total_committed) if rev else 0.0
        student_count = rev.student_count if rev else 0
        period_cost = cost_by_cohort.get(key)
        monthly_margin = (total_monthly - period_cost) if period_cost is not None else None

        results.append(CohortRevenueSummary(
            program_code=program_code,
            work_reference=work_reference,
            student_count=student_count,
            total_monthly=total_monthly,
            total_paid=total_paid,
            total_committed=total_committed,
            total_balance_remaining=total_committed - total_paid,
            period_label=period_label,
            period_cost=period_cost,
            monthly_margin=monthly_margin,
        ))

    results.sort(key=lambda r: (r.program_code, r.work_reference))
    return results


# ---------- Cohort clean-up (owner only) ----------
#
# A "cohort" isn't its own table: it's a (program, work_reference) name shared
# by student roster rows, payroll assignments and enrollment headcounts. So a
# typo'd or later-renamed cohort is fixed by renaming/merging those rows, and
# deleting one means deleting the rows that carry the name.

# Payroll rows past this point are owed or already paid -- never delete them.
DELETABLE_ASSIGNMENT_STATUSES = (AssignmentStatus.draft, AssignmentStatus.rejected)


def _cohort_rows(db: Session, program_id: int, work_reference: str):
    students = db.query(Student).filter(
        Student.program_id == program_id, Student.work_reference == work_reference
    )
    assignments = db.query(Assignment).filter(
        Assignment.program_id == program_id, Assignment.work_reference == work_reference
    )
    enrollments = db.query(CohortEnrollment).filter(
        CohortEnrollment.program_id == program_id, CohortEnrollment.work_reference == work_reference
    )
    return students, assignments, enrollments


@router.get("/cohorts/impact", response_model=CohortImpact)
def cohort_impact(
    program_id: int,
    work_reference: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.owner)),
):
    """What a delete/rename of this cohort would touch -- shown before confirming."""
    students, assignments, enrollments = _cohort_rows(db, program_id, work_reference)
    rows = assignments.all()
    locked = [a for a in rows if a.status not in DELETABLE_ASSIGNMENT_STATUSES]
    return CohortImpact(
        student_count=students.count(),
        enrollment_count=enrollments.count(),
        assignment_count=len(rows),
        locked_assignment_count=len(locked),
        locked_amount=float(sum(a.total_amount for a in locked)),
        can_delete=not locked,
    )


@router.delete("/cohorts", status_code=204)
def delete_cohort(
    program_id: int,
    work_reference: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.owner)),
):
    """
    Remove a cohort created by mistake: its students, headcounts and any
    draft/rejected payroll rows. Refused if payroll under this name is already
    submitted, approved or paid -- rename/merge it into the right cohort instead.
    """
    students, assignments, enrollments = _cohort_rows(db, program_id, work_reference)
    rows = assignments.all()
    if not rows and not students.count() and not enrollments.count():
        raise HTTPException(status_code=404, detail="Cohort not found")
    locked = [a for a in rows if a.status not in DELETABLE_ASSIGNMENT_STATUSES]
    if locked:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{len(locked)} payroll row(s) under this cohort are already in review, approved or paid. "
                "Rename / merge it into the correct cohort instead of deleting."
            ),
        )

    for a in rows:
        db.query(AuditLog).filter(AuditLog.assignment_id == a.id).update({AuditLog.assignment_id: None})
        db.add(AuditLog(user_id=user.id, action="assignment_deleted",
                        details=f"Cohort {work_reference!r} deleted: person {a.person_id}, {a.hours}h x ${a.rate}"))
        db.delete(a)
    students.delete(synchronize_session=False)
    enrollments.delete(synchronize_session=False)
    db.add(AuditLog(user_id=user.id, action="cohort_deleted", details=f"program {program_id}: {work_reference!r}"))
    db.commit()
    return None


@router.post("/cohorts/rename", status_code=204)
def rename_cohort(
    payload: CohortRename,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.owner)),
):
    """
    Rename a cohort everywhere it's used (students, payroll rows in every
    status, headcounts). If the new name already exists, this merges the two:
    cost and revenue then land on one row. Payroll amounts are unchanged.
    """
    old = payload.work_reference
    new = payload.new_work_reference.strip()
    if not new:
        raise HTTPException(status_code=400, detail="New cohort name can't be empty")
    if new == old:
        return None

    students, assignments, enrollments = _cohort_rows(db, payload.program_id, old)
    if not students.count() and not assignments.count() and not enrollments.count():
        raise HTTPException(status_code=404, detail="Cohort not found")

    for a in assignments.all():
        a.work_reference = new
        db.add(AuditLog(assignment_id=a.id, user_id=user.id, action="cohort_renamed",
                        details=f"Cohort {old!r} → {new!r}"))
    students.update({Student.work_reference: new}, synchronize_session=False)

    # One headcount row per (program, cohort, period): add into the target if it exists.
    for e in enrollments.all():
        target = db.query(CohortEnrollment).filter(
            CohortEnrollment.program_id == payload.program_id,
            CohortEnrollment.work_reference == new,
            CohortEnrollment.period_id == e.period_id,
        ).first()
        if target:
            target.current_students = (target.current_students or 0) + (e.current_students or 0)
            if e.projected_end_of_month_students is not None:
                target.projected_end_of_month_students = (
                    (target.projected_end_of_month_students or 0) + e.projected_end_of_month_students
                )
            db.delete(e)
        else:
            e.work_reference = new

    db.add(AuditLog(user_id=user.id, action="cohort_renamed",
                    details=f"program {payload.program_id}: {old!r} → {new!r}"))
    db.commit()
    return None
