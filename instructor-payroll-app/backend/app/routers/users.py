from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_role
from app.core.security import hash_password
from app.models.models import User, UserRole
from app.schemas.schemas import AdminSetPasswordRequest, UserAdminOut

# Owner-only account management -- listing accounts and resetting someone
# else's password. Deliberately separate from /reference/people: a Person
# is an instructor/mentor identity used on payroll rows, a User is a login
# account, and not every Person has one (or vice versa).
router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(require_role(UserRole.owner))])


@router.get("", response_model=list[UserAdminOut])
def list_users(db: Session = Depends(get_db)):
    return db.query(User).order_by(User.name).all()


@router.patch("/{user_id}/password", status_code=204)
def set_user_password(
    user_id: int,
    payload: AdminSetPasswordRequest,
    db: Session = Depends(get_db),
):
    """
    Owner resets another account's password directly -- no current password
    needed, since the owner is trusted to do this for someone locked out or
    who forgot theirs (mirrors how Marcelo's own password was set as a
    one-off before this feature existed).
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.hashed_password = hash_password(payload.new_password)
    db.commit()
    return None
