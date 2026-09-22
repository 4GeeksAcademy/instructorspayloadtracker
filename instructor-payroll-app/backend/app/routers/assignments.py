from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.core.categorize import suggest_work_category
from app.core.database import get_db
from app.core.deps import get_current_user, require_role
from app.models.models import (
    Assignment,
    AssignmentStatus,
    AuditLog,
    CohortEnrollment,
    PayPeriod,
    Person,
    Program,
    Role,
    User,
    UserRole,
    WorkCategory,
)
from app.schemas.schemas import (
    AssignmentCreate,
    AssignmentOut,
    AssignmentStatusChange,
    AssignmentUpdate,
    CategorySummary,
    CohortSummary,
    PersonSummary,
    ProgramSummary,
)

router = APIRouter(prefix="/assignments", tags=["assignments"], dependencies=[Depends(get_current_user)])


def _log(db: Session, assignment_id: int, user_id: int, action: str, details: str | None = None):
    db.add(AuditLog(assignment_id=assignment_id, user_id=user_id, action=action, details=details))


def _validate_references(db: Session, payload) -> None:
    """
    Give a clean 400 for a bad person/program/role/period id instead of
    letting a ForeignKeyViolation bubble up as a raw 500.
    """
    checks = [
        (Person, payload.person_id, "person_id"),
        (Program, payload.program_id, "program_id"),
        (Role, payload.role_id, "role_id"),
        (PayPeriod, payload.period_id, "period_id"),
    ]
    for model, value, field in checks:
        if value is None:
            continue
        if not db.query(model.id).filter(model.id == value).first():
            raise HTTPException(status_code=400, detail=f"Invalid {field}: no record with id {value}")


def _with_relations(query):
    return query.options(
        joinedload(Assignment.person),
        joinedload(Assignment.program),
        joinedload(Assignment.role),
        joinedload(Assignment.period),
    )


@router.get("", response_model=list[AssignmentOut])
def list_assignments(
    period_id: Optional[int] = None,
    person_id: Optional[int] = None,
    program_id: Optional[int] = None,
    status_filter: Optional[AssignmentStatus] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = _with_relations(db.query(Assignment))

    # A program_lead only sees/submits for their own program.
    if user.role == UserRole.program_lead and user.program_id:
        q = q.filter(Assignment.program_id == user.program_id)

    if period_id:
        q = q.filter(Assignment.period_id == period_id)
    if person_id:
        q = q.filter(Assignment.person_id == person_id)
    if program_id:
        q = q.filter(Assignment.program_id == program_id)
    if status_filter:
        q = q.filter(Assignment.status == status_filter)

    return q.order_by(Assignment.id).all()


@router.post("", response_model=AssignmentOut)
def create_assignment(
    payload: AssignmentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.program_lead, UserRole.admin, UserRole.owner)),
):
    if user.role == UserRole.program_lead and user.program_id and payload.program_id != user.program_id:
        raise HTTPException(status_code=403, detail="You can only submit hours for your own program")

    _validate_references(db, payload)

    data = payload.model_dump()
    if data.get("work_category") is None:
        data["work_category"] = suggest_work_category(data["work_reference"])

    assignment = Assignment(**data, status=AssignmentStatus.draft)
    db.add(assignment)
    db.flush()
    _log(db, assignment.id, user.id, "created")
    db.commit()
    db.refresh(assignment)
    return _with_relations(db.query(Assignment)).filter(Assignment.id == assignment.id).first()


@router.patch("/{assignment_id}", response_model=AssignmentOut)
def update_assignment(
    assignment_id: int,
    payload: AssignmentUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.program_lead, UserRole.admin, UserRole.owner)),
):
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if assignment.status not in (AssignmentStatus.draft, AssignmentStatus.rejected):
        raise HTTPException(status_code=400, detail="Only draft or rejected assignments can be edited")

    if payload.role_id is not None and not db.query(Role.id).filter(Role.id == payload.role_id).first():
        raise HTTPException(status_code=400, detail=f"Invalid role_id: no record with id {payload.role_id}")
    if payload.program_id is not None and not db.query(Program.id).filter(Program.id == payload.program_id).first():
        raise HTTPException(status_code=400, detail=f"Invalid program_id: no record with id {payload.program_id}")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(assignment, field, value)

    _log(db, assignment.id, user.id, "edited")
    db.commit()
    db.refresh(assignment)
    return _with_relations(db.query(Assignment)).filter(Assignment.id == assignment.id).first()


def _transition(
    db: Session,
    assignment_id: int,
    user: User,
    allowed_from: list[AssignmentStatus],
    to_status: AssignmentStatus,
    action: str,
    reason: Optional[str] = None,
    stamp_field: Optional[str] = None,
):
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if assignment.status not in allowed_from:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot move from {assignment.status.value} to {to_status.value}",
        )

    assignment.status = to_status
    now = datetime.now(timezone.utc)
    if stamp_field == "submitted":
        assignment.submitted_by, assignment.submitted_at = user.id, now
    elif stamp_field == "reviewed":
        assignment.reviewed_by, assignment.reviewed_at = user.id, now
    elif stamp_field == "approved":
        assignment.approved_by, assignment.approved_at = user.id, now

    _log(db, assignment.id, user.id, action, reason)
    db.commit()
    db.refresh(assignment)
    return _with_relations(db.query(Assignment)).filter(Assignment.id == assignment.id).first()


@router.post("/{assignment_id}/submit", response_model=AssignmentOut)
def submit_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.program_lead, UserRole.admin, UserRole.owner)),
):
    """Program lead sends a draft for admin review."""
    return _transition(
        db, assignment_id, user,
        allowed_from=[AssignmentStatus.draft, AssignmentStatus.rejected],
        to_status=AssignmentStatus.submitted,
        action="submitted",
        stamp_field="submitted",
    )


@router.post("/{assignment_id}/admin-review", response_model=AssignmentOut)
def admin_review_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.admin, UserRole.owner)),
):
    """Admin financial/academic review -- second tier, mirrors Commission Tracker."""
    return _transition(
        db, assignment_id, user,
        allowed_from=[AssignmentStatus.submitted],
        to_status=AssignmentStatus.admin_reviewed,
        action="admin_reviewed",
        stamp_field="reviewed",
    )


@router.post("/{assignment_id}/approve", response_model=AssignmentOut)
def approve_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.owner)),
):
    """Marcelo's final approval -- third tier."""
    return _transition(
        db, assignment_id, user,
        allowed_from=[AssignmentStatus.admin_reviewed],
        to_status=AssignmentStatus.approved,
        action="approved",
        stamp_field="approved",
    )


@router.post("/{assignment_id}/reject", response_model=AssignmentOut)
def reject_assignment(
    assignment_id: int,
    payload: AssignmentStatusChange,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.admin, UserRole.owner)),
):
    """Send back to the program lead with a reason, from either review tier."""
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if assignment.status not in (AssignmentStatus.submitted, AssignmentStatus.admin_reviewed):
        raise HTTPException(status_code=400, detail="Only submitted or admin-reviewed items can be rejected")

    return _transition(
        db, assignment_id, user,
        allowed_from=[assignment.status],
        to_status=AssignmentStatus.rejected,
        action="rejected",
        reason=payload.reason,
    )


@router.post("/{assignment_id}/register", response_model=AssignmentOut)
def register_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.admin, UserRole.owner)),
):
    """Marks as entered into the payroll system -- equivalent to the old 'Registrado' status."""
    return _transition(
        db, assignment_id, user,
        allowed_from=[AssignmentStatus.approved],
        to_status=AssignmentStatus.registered,
        action="registered",
    )


@router.post("/{assignment_id}/mark-paid", response_model=AssignmentOut)
def mark_paid_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.admin, UserRole.owner)),
):
    """Equivalent to the old 'Registrado - pagado' status."""
    return _transition(
        db, assignment_id, user,
        allowed_from=[AssignmentStatus.registered],
        to_status=AssignmentStatus.paid,
        action="paid",
    )


# ---------- Rollups: per person / per program, for a given period ----------

@router.get("/summary/by-person", response_model=list[PersonSummary])
def summary_by_person(period_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(
            Person.id.label("person_id"),
            Person.name.label("person_name"),
            func.count(Assignment.id).label("assignment_count"),
            func.coalesce(func.sum(Assignment.hours), 0).label("total_hours"),
            func.coalesce(func.sum(Assignment.hours * Assignment.rate + Assignment.adjustment_amount), 0).label("total_amount"),
        )
        .join(Assignment, Assignment.person_id == Person.id)
        .filter(Assignment.period_id == period_id)
        .group_by(Person.id, Person.name)
        .order_by(Person.name)
        .all()
    )
    return [
        PersonSummary(
            person_id=r.person_id,
            person_name=r.person_name,
            assignment_count=r.assignment_count,
            total_hours=float(r.total_hours),
            total_amount=float(r.total_amount),
        )
        for r in rows
    ]


@router.get("/summary/by-program", response_model=list[ProgramSummary])
def summary_by_program(period_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(
            Program.id.label("program_id"),
            Program.code.label("program_code"),
            func.count(Assignment.id).label("assignment_count"),
            func.coalesce(func.sum(Assignment.hours), 0).label("total_hours"),
            func.coalesce(func.sum(Assignment.hours * Assignment.rate + Assignment.adjustment_amount), 0).label("total_amount"),
        )
        .join(Assignment, Assignment.program_id == Program.id)
        .filter(Assignment.period_id == period_id)
        .group_by(Program.id, Program.code)
        .order_by(Program.code)
        .all()
    )
    return [
        ProgramSummary(
            program_id=r.program_id,
            program_code=r.program_code,
            assignment_count=r.assignment_count,
            total_hours=float(r.total_hours),
            total_amount=float(r.total_amount),
        )
        for r in rows
    ]


@router.get("/summary/by-category", response_model=list[CategorySummary])
def summary_by_category(period_id: int, db: Session = Depends(get_db)):
    """
    Cohort/Class Instruction vs Mentorship/Private Sessions vs Overhead/Admin
    -- the dashboard's top-level cost-center split.
    """
    rows = (
        db.query(
            Assignment.work_category.label("category"),
            func.count(Assignment.id).label("assignment_count"),
            func.coalesce(func.sum(Assignment.hours), 0).label("total_hours"),
            func.coalesce(func.sum(Assignment.hours * Assignment.rate + Assignment.adjustment_amount), 0).label("total_amount"),
        )
        .filter(Assignment.period_id == period_id)
        .group_by(Assignment.work_category)
        .all()
    )
    return [
        CategorySummary(
            category=r.category,
            assignment_count=r.assignment_count,
            total_hours=float(r.total_hours),
            total_amount=float(r.total_amount),
        )
        for r in rows
    ]


# Roles whose headcount scales with class size -- used to flag a cohort with
# students but no instructional staff assigned. Deliberately narrow (not
# "any role") so a cohort staffed only by, say, a career mentor note doesn't
# read as fully staffed.
INSTRUCTIONAL_ROLE_NAMES = {"instructor", "ta"}


@router.get("/summary/by-cohort", response_model=list[CohortSummary])
def summary_by_cohort(period_id: int, db: Session = Depends(get_db)):
    """
    Cost per real cohort/class, with the people and roles assigned to it --
    answers "what does this cohort cost, and who's staffed on it." Also folds
    in CohortEnrollment (manually entered headcount) to answer cost-per-
    student and whether a cohort with students has any instructional staff.
    Only includes work_category = cohort_class rows (mentorship/overhead
    live in their own views, since they aren't tied to one cohort).
    """
    assignments = (
        _with_relations(db.query(Assignment))
        .filter(Assignment.period_id == period_id, Assignment.work_category == WorkCategory.cohort_class)
        .all()
    )

    groups: dict[tuple[str, str], list[Assignment]] = {}
    program_ids: dict[str, int] = {}
    for a in assignments:
        key = (a.program.code, a.work_reference)
        groups.setdefault(key, []).append(a)
        program_ids[a.program.code] = a.program_id

    enrollments = {
        (e.program.code, e.work_reference): e
        for e in db.query(CohortEnrollment)
        .join(Program, CohortEnrollment.program_id == Program.id)
        .filter(CohortEnrollment.period_id == period_id)
        .all()
    }

    results = []
    for (program_code, work_reference), items in groups.items():
        people = list(dict.fromkeys(a.person.name for a in items))
        roles = list(dict.fromkeys(a.role.name for a in items))
        total_amount = sum(a.total_amount for a in items)

        instructional_staff_count = len({
            a.person_id for a in items if a.role.name.strip().lower() in INSTRUCTIONAL_ROLE_NAMES
        })

        enrollment = enrollments.get((program_code, work_reference))
        current_students = enrollment.current_students if enrollment else None
        projected = enrollment.projected_end_of_month_students if enrollment else None

        cost_per_student = (
            total_amount / current_students if current_students else None
        )
        students_per_staff = (
            current_students / instructional_staff_count
            if current_students and instructional_staff_count
            else None
        )
        unstaffed_flag = bool(current_students and current_students > 0 and instructional_staff_count == 0)

        results.append(CohortSummary(
            program_code=program_code,
            work_reference=work_reference,
            people=people,
            roles=roles,
            assignment_count=len(items),
            total_hours=float(sum(a.hours for a in items)),
            total_amount=total_amount,
            current_students=current_students,
            projected_end_of_month_students=projected,
            cost_per_student=cost_per_student,
            instructional_staff_count=instructional_staff_count,
            students_per_staff=students_per_staff,
            unstaffed_flag=unstaffed_flag,
        ))

    # Cohorts that have enrollment entered but zero staffing wouldn't show up
    # above (no Assignment row at all) -- surface those too, since "0 people
    # assigned to a cohort with students" is exactly the gap this feature
    # exists to catch.
    seen = set(groups.keys())
    for (program_code, work_reference), enrollment in enrollments.items():
        if (program_code, work_reference) in seen:
            continue
        current_students = enrollment.current_students
        results.append(CohortSummary(
            program_code=program_code,
            work_reference=work_reference,
            people=[],
            roles=[],
            assignment_count=0,
            total_hours=0.0,
            total_amount=0.0,
            current_students=current_students,
            projected_end_of_month_students=enrollment.projected_end_of_month_students,
            cost_per_student=0.0 if current_students else None,
            instructional_staff_count=0,
            students_per_staff=None,
            unstaffed_flag=bool(current_students and current_students > 0),
        ))

    results.sort(key=lambda r: (r.program_code, r.work_reference))
    return results
