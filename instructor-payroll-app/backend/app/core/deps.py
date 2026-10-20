from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.models import User, UserRole

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
        user_id = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except Exception:
        raise credentials_exception

    user = db.query(User).filter(User.id == int(user_id)).first()
    if user is None or not user.active:
        raise credentials_exception
    return user


def require_role(*roles: UserRole):
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Not authorized for this action")
        return user
    return checker


# ---------- Section access (Instructors / Costs Hub) ----------

def is_owner(user: User) -> bool:
    return user.role == UserRole.owner


def can_view_costs(user: User) -> bool:
    return is_owner(user) or bool(user.view_all) or (user.costs_access or "none") in ("viewer", "editor")


def can_edit_costs(user: User) -> bool:
    return is_owner(user) or (user.costs_access or "none") == "editor"


def can_view_instructors(user: User) -> bool:
    return is_owner(user) or bool(user.view_all) or bool(user.instructors_access)


def require_costs_view(user: User = Depends(get_current_user)) -> User:
    if not can_view_costs(user):
        raise HTTPException(status_code=403, detail="No access to the Costs Hub")
    return user


def require_costs_edit(user: User = Depends(get_current_user)) -> User:
    if not can_edit_costs(user):
        raise HTTPException(status_code=403, detail="Read-only access to the Costs Hub")
    return user


def require_instructors(user: User = Depends(get_current_user)) -> User:
    if not can_view_instructors(user):
        raise HTTPException(status_code=403, detail="No access to the Instructors section")
    return user


def require_owner(user: User = Depends(get_current_user)) -> User:
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Only the super admin can do this")
    return user


def require_owner_or_view_all(user: User = Depends(get_current_user)) -> User:
    if not (is_owner(user) or user.view_all):
        raise HTTPException(status_code=403, detail="Not authorized for this action")
    return user
