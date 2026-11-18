"""
Corrections: notes, fixes and payment differences raised on a pay row at any
stage -- before approval, after approval, or after it was already paid.

Who can do what:
- Program leads (Loreto, Diego): raise a correction or note on their own rows,
  and edit/withdraw it while it's still open. They see their own corrections.
- Admin (Kevin) and owner (Marcelo): see everything, raise corrections on any
  row, approve or reject them, and move approved ones through payment
  (pending -> registered -> paid). Approved corrections show up in Payments
  next to the person's regular pay.

The original pay row is never overwritten by a correction, so the history
stays readable: "paid $1,200 on Oct 30, then +$150 approved on Nov 4 because
3 grading hours were missing".
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.deps import get_current_user, require_instructors, require_role
from app.models.models import Assignment, AuditLog, Correction, User, UserRole
from app.routers.assignments import can_touch, scope_to_user
from app.schemas.schemas import (
    CorrectionCreate,
    CorrectionOut,
    CorrectionPaymentStatus,
    CorrectionReject,
    CorrectionUpdate,
)

router = APIRouter(prefix="/corrections", tags=["corrections"], dependencies=[Depends(require_instructors)])

PAYABLE = ("approved", "registered", "paid")


def _money(v) -> str:
    v = float(v or 0)
    return f"{'+' if v > 0 else '-' if v < 0 else ''}${abs(v):,.2f}"


def _out(c: Correction) -> CorrectionOut:
    a = c.assignment
    return CorrectionOut(
        id=c.id,
        assignment_id=c.assignment_id,
        period_id=c.period_id,
        person_id=c.person_id,
        person_name=c.person.name if c.person else "",
        period_label=c.period.label if c.period else "",
        assignment_label=f"{a.program.code} · {a.role.name} · {a.work_reference}" if a else "",
        assignment_status=a.status.value if a else "",
        amount=c.amount,
        note=c.note,
        status=c.status,
        resolution=c.resolution,
        created_by_name=c.author.name if c.author else None,
        created_at=c.created_at,
        approved_at=c.approved_at,
        paid_at=c.paid_at,
    )


def _query(db: Session):
    return db.query(Correction).options(
        joinedload(Correction.assignment).joinedload(Assignment.program),
        joinedload(Correction.assignment).joinedload(Assignment.role),
        joinedload(Correction.person),
        joinedload(Correction.period),
        joinedload(Correction.author),
    )


def _get(db: Session, correction_id: int) -> Correction:
    c = _query(db).filter(Correction.id == correction_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Correction not found")
    return c


def _log(db: Session, c: Correction, user: User, action: str, details: str):
    db.add(AuditLog(assignment_id=c.assignment_id, user_id=user.id, action=action, details=details))


def _is_reviewer(user: User) -> bool:
    return user.role in (UserRole.admin, UserRole.owner)


@router.get("", response_model=list[CorrectionOut])
def list_corrections(
    period_id: Optional[int] = None,
    open_only: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = _query(db)
    if user.role == UserRole.program_lead:
        visible = scope_to_user(db.query(Assignment.id), user).scalar_subquery()
        q = q.filter(Correction.assignment_id.in_(visible))
    if period_id:
        q = q.filter(Correction.period_id == period_id)
    if open_only:
        q = q.filter(Correction.status.in_(("open", "approved", "registered")))
    return [_out(c) for c in q.order_by(Correction.id.desc()).all()]


@router.post("", response_model=CorrectionOut)
def create_correction(
    payload: CorrectionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    a = db.query(Assignment).filter(Assignment.id == payload.assignment_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Pay row not found")
    if not can_touch(user, a):
        raise HTTPException(status_code=403, detail="You can only add corrections to your own data")
    note = payload.note.strip()
    if len(note) < 3:
        raise HTTPException(status_code=400, detail="Explain what needs to change")

    c = Correction(
        assignment_id=a.id,
        period_id=a.period_id,
        person_id=a.person_id,
        amount=payload.amount or Decimal("0"),
        note=note,
        status="noted" if not payload.amount else "open",
        created_by=user.id,
    )
    db.add(c)
    db.flush()
    _log(db, c, user, "correction_added" if payload.amount else "note_added",
         f"{_money(c.amount) + ' — ' if payload.amount else ''}{note} (row was {a.status.value})")
    db.commit()
    return _out(_get(db, c.id))


@router.patch("/{correction_id}", response_model=CorrectionOut)
def update_correction(
    correction_id: int,
    payload: CorrectionUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    c = _get(db, correction_id)
    if _is_reviewer(user):
        if c.status in ("paid",):
            raise HTTPException(status_code=400, detail="This correction is already settled. Add a new one instead.")
    else:
        if c.created_by != user.id or c.status not in ("open", "noted"):
            raise HTTPException(status_code=403, detail="You can only edit your own corrections while they're open")

    changes = payload.model_dump(exclude_unset=True)
    diffs = []
    if "amount" in changes and changes["amount"] is not None and Decimal(changes["amount"]) != c.amount:
        diffs.append(f"Amount {_money(c.amount)} → {_money(changes['amount'])}")
        c.amount = changes["amount"]
        if c.status == "noted" and c.amount:
            c.status = "open"
        elif c.status == "open" and not c.amount:
            c.status = "noted"
    if changes.get("note") and changes["note"].strip() != c.note:
        diffs.append("Note updated")
        c.note = changes["note"].strip()
    if diffs:
        _log(db, c, user, "correction_edited", "; ".join(diffs))
    db.commit()
    return _out(_get(db, c.id))


@router.post("/{correction_id}/approve", response_model=CorrectionOut)
def approve_correction(
    correction_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.admin, UserRole.owner)),
):
    c = _get(db, correction_id)
    if c.status != "open":
        raise HTTPException(status_code=400, detail="Only open corrections can be approved")
    c.status = "approved"
    c.approved_by, c.approved_at = user.id, datetime.now(timezone.utc)
    _log(db, c, user, "correction_approved", f"{_money(c.amount)} — {c.note}")
    db.commit()
    return _out(_get(db, c.id))


@router.post("/{correction_id}/reject", response_model=CorrectionOut)
def reject_correction(
    correction_id: int,
    payload: CorrectionReject,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.admin, UserRole.owner)),
):
    c = _get(db, correction_id)
    if c.status not in ("open", "approved"):
        raise HTTPException(status_code=400, detail="Only open or approved (unpaid) corrections can be rejected")
    c.status = "rejected"
    c.resolution = (payload.reason or "").strip() or None
    _log(db, c, user, "correction_rejected", f"{_money(c.amount)} — {c.resolution or 'no reason given'}")
    db.commit()
    return _out(_get(db, c.id))


@router.post("/payment-status", response_model=list[CorrectionOut])
def set_correction_payment_status(
    payload: CorrectionPaymentStatus,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.admin, UserRole.owner)),
):
    """Move approved corrections through payment, like regular pay rows."""
    rows = _query(db).filter(Correction.id.in_(payload.correction_ids)).all()
    if len(rows) != len(set(payload.correction_ids)):
        raise HTTPException(status_code=404, detail="Some corrections were not found")
    if any(c.status not in PAYABLE for c in rows):
        raise HTTPException(status_code=400, detail="Only approved corrections can be marked for payment")
    now = datetime.now(timezone.utc)
    for c in rows:
        if c.status != payload.status:
            _log(db, c, user, "correction_payment", f"{_money(c.amount)}: {c.status} → {payload.status}")
            c.status = payload.status
            if payload.status == "paid":
                c.paid_by, c.paid_at = user.id, now
            else:
                c.paid_by, c.paid_at = None, None
    db.commit()
    return [_out(_get(db, c.id)) for c in rows]


@router.delete("/{correction_id}", status_code=204)
def delete_correction(
    correction_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Withdraw a correction that hasn't been approved yet (author or reviewers)."""
    c = _get(db, correction_id)
    if c.status not in ("open", "noted", "rejected"):
        raise HTTPException(status_code=400, detail="Approved corrections can't be deleted — reject it instead")
    if not (_is_reviewer(user) or c.created_by == user.id):
        raise HTTPException(status_code=403, detail="You can only withdraw your own corrections")
    _log(db, c, user, "correction_withdrawn", f"{_money(c.amount)} — {c.note}")
    db.delete(c)
    db.commit()
    return None
