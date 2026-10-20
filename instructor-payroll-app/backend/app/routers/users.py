from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_role
from app.core.security import hash_password
from app.models.models import User, UserRole
from app.schemas.schemas import AdminSetPasswordRequest, UserAdminOut, UserCreate, UserUpdate

# Owner-only account management -- listing, creating and editing accounts
# (role + section access), and resetting someone else's password.
# Deliberately separate from /reference/people: a Person is an
# instructor/mentor identity used on payroll rows, a User is a login account,
# and not every Person has one (or vice versa).
router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(require_role(UserRole.owner))])


@router.get("", response_model=list[UserAdminOut])
def list_users(db: Session = Depends(get_db)):
    return db.query(User).order_by(User.name).all()


@router.post("", response_model=UserAdminOut)
def create_user(payload: UserCreate, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="An account with that email already exists")
    user = User(
        name=payload.name.strip(),
        email=email,
        hashed_password=hash_password(payload.password),
        role=payload.role,
        program_id=payload.program_id,
        instructors_access=payload.instructors_access,
        costs_access=payload.costs_access,
        view_all=payload.view_all,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserAdminOut)
def update_user(user_id: int, payload: UserUpdate, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    data = payload.model_dump(exclude_unset=True)
    if user.role == UserRole.owner and data.get("role") not in (None, UserRole.owner):
        raise HTTPException(status_code=400, detail="The owner account's role can't be changed here")
    for k, v in data.items():
        setattr(user, k, v)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}/password", status_code=204)
def set_user_password(
    user_id: int,
    payload: AdminSetPasswordRequest,
    db: Session = Depends(get_db),
):
    """
    Owner resets another account's password directly -- no current password
    needed, since the owner is trusted to do this for someone locked out or
    who forgot theirs.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.hashed_password = hash_password(payload.new_password)
    db.commit()
    return None
