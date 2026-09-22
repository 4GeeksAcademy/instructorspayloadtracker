from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_role
from app.models.models import Assignment, PayPeriod, Program, Student, User, UserRole, WorkCategory
from app.schemas.schemas import CohortRevenueSummary, StudentCreate, StudentOut, StudentUpdate

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
    user: User = Depends(require_role(UserRole.owner)),
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
        latest = db.query(PayPeriod).order_by(PayPeriod.start_date.desc()).first()
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
