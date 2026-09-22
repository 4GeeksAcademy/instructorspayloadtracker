from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_role
from app.models.models import CohortEnrollment, PayPeriod, Program, User, UserRole
from app.schemas.schemas import CohortEnrollmentOut, CohortEnrollmentUpsert

router = APIRouter(prefix="/enrollment", tags=["enrollment"], dependencies=[Depends(get_current_user)])


@router.get("", response_model=list[CohortEnrollmentOut])
def list_enrollment(
    period_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(CohortEnrollment).filter(CohortEnrollment.period_id == period_id)
    if user.role == UserRole.program_lead and user.program_id:
        q = q.filter(CohortEnrollment.program_id == user.program_id)
    return q.all()


@router.put("", response_model=CohortEnrollmentOut)
def upsert_enrollment(
    payload: CohortEnrollmentUpsert,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.program_lead, UserRole.admin, UserRole.owner)),
):
    """
    Create-or-update the headcount row for one (program, work_reference,
    period). Idempotent by design -- the form just re-PUTs the current
    values, same convention as everything else editable in this app (no
    separate create vs edit call for the caller to get wrong).
    """
    if user.role == UserRole.program_lead and user.program_id and payload.program_id != user.program_id:
        raise HTTPException(status_code=403, detail="You can only set enrollment for your own program")

    if not db.query(Program.id).filter(Program.id == payload.program_id).first():
        raise HTTPException(status_code=400, detail=f"Invalid program_id: no record with id {payload.program_id}")
    if not db.query(PayPeriod.id).filter(PayPeriod.id == payload.period_id).first():
        raise HTTPException(status_code=400, detail=f"Invalid period_id: no record with id {payload.period_id}")

    row = (
        db.query(CohortEnrollment)
        .filter(
            CohortEnrollment.program_id == payload.program_id,
            CohortEnrollment.work_reference == payload.work_reference,
            CohortEnrollment.period_id == payload.period_id,
        )
        .first()
    )
    if row is None:
        row = CohortEnrollment(
            program_id=payload.program_id,
            work_reference=payload.work_reference,
            period_id=payload.period_id,
        )
        db.add(row)

    row.current_students = payload.current_students
    row.projected_end_of_month_students = payload.projected_end_of_month_students
    row.notes = payload.notes
    row.updated_by = user.id

    db.commit()
    db.refresh(row)
    return row
