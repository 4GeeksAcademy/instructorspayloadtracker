from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_role
from app.models.models import Person, PayPeriod, Program, Role, User, UserRole
from app.schemas.schemas import (
    PayPeriodCreate,
    PayPeriodOut,
    PersonCreate,
    PersonOut,
    ProgramOut,
    RoleOut,
)

router = APIRouter(tags=["reference"], dependencies=[Depends(get_current_user)])


@router.get("/programs", response_model=list[ProgramOut])
def list_programs(db: Session = Depends(get_db)):
    return db.query(Program).filter(Program.active.is_(True)).order_by(Program.code).all()


@router.get("/roles", response_model=list[RoleOut])
def list_roles(db: Session = Depends(get_db)):
    return db.query(Role).order_by(Role.name).all()


@router.get("/people", response_model=list[PersonOut])
def list_people(db: Session = Depends(get_db)):
    return db.query(Person).filter(Person.active.is_(True)).order_by(Person.name).all()


@router.post("/people", response_model=PersonOut)
def create_person(
    payload: PersonCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(UserRole.admin, UserRole.owner, UserRole.program_lead)),
):
    person = Person(**payload.model_dump())
    db.add(person)
    db.commit()
    db.refresh(person)
    return person


@router.get("/periods", response_model=list[PayPeriodOut])
def list_periods(db: Session = Depends(get_db)):
    return db.query(PayPeriod).order_by(PayPeriod.start_date.desc()).all()


@router.post("/periods", response_model=PayPeriodOut)
def create_period(
    payload: PayPeriodCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(UserRole.admin, UserRole.owner)),
):
    period = PayPeriod(**payload.model_dump())
    db.add(period)
    db.commit()
    db.refresh(period)
    return period
