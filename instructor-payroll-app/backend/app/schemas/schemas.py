from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.models import AssignmentStatus, UserRole, WorkCategory


# ---------- Auth ----------

class LoginRequest(BaseModel):
    email: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: str
    role: UserRole
    program_id: Optional[int] = None


class UserAdminOut(UserOut):
    active: bool


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class AdminSetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=8)


# ---------- Reference data ----------

class ProgramOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    name: str
    active: bool


class RoleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    default_rate: Optional[Decimal] = None


class PersonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: Optional[str] = None
    active: bool


class PersonCreate(BaseModel):
    name: str
    email: Optional[EmailStr] = None
    notes: Optional[str] = None


class PayPeriodOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    label: str
    start_date: date
    end_date: date
    locked: bool


class PayPeriodCreate(BaseModel):
    label: str
    start_date: date
    end_date: date


# ---------- Assignments ----------

class AssignmentCreate(BaseModel):
    person_id: int
    program_id: int
    role_id: int
    period_id: int
    work_reference: str
    work_category: Optional[WorkCategory] = None  # auto-suggested server-side if omitted
    rate: Decimal
    hours: Decimal = Decimal("0")
    adjustment_amount: Decimal = Decimal("0")
    adjustment_reason: Optional[str] = None
    hours_verified: bool = False
    notes: Optional[str] = None


class AssignmentUpdate(BaseModel):
    work_reference: Optional[str] = None
    work_category: Optional[WorkCategory] = None
    rate: Optional[Decimal] = None
    hours: Optional[Decimal] = None
    adjustment_amount: Optional[Decimal] = None
    adjustment_reason: Optional[str] = None
    hours_verified: Optional[bool] = None
    notes: Optional[str] = None
    role_id: Optional[int] = None
    program_id: Optional[int] = None


class AssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    person: PersonOut
    program: ProgramOut
    role: RoleOut
    period: PayPeriodOut
    work_reference: str
    work_category: WorkCategory
    rate: Decimal
    hours: Decimal
    adjustment_amount: Decimal
    adjustment_reason: Optional[str] = None
    hours_verified: bool
    notes: Optional[str] = None
    status: AssignmentStatus
    calculated_amount: float
    total_amount: float
    submitted_at: Optional[datetime] = None
    reviewed_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None


class AssignmentStatusChange(BaseModel):
    reason: Optional[str] = None


# ---------- Rollups ----------

class PersonSummary(BaseModel):
    person_id: int
    person_name: str
    assignment_count: int
    total_hours: float
    total_amount: float


class ProgramSummary(BaseModel):
    program_id: int
    program_code: str
    assignment_count: int
    total_hours: float
    total_amount: float


class CategorySummary(BaseModel):
    category: WorkCategory
    assignment_count: int
    total_hours: float
    total_amount: float


class CohortSummary(BaseModel):
    program_code: str
    work_reference: str
    people: list[str]
    roles: list[str]
    assignment_count: int
    total_hours: float
    total_amount: float

    # Enrollment-derived fields (see CohortEnrollment). None when no one has
    # entered a headcount for this cohort/period yet -- "not entered", not 0.
    current_students: Optional[int] = None
    projected_end_of_month_students: Optional[int] = None
    cost_per_student: Optional[float] = None
    instructional_staff_count: int = 0
    students_per_staff: Optional[float] = None
    unstaffed_flag: bool = False


# ---------- Cohort enrollment ----------

class CohortEnrollmentBase(BaseModel):
    current_students: int = 0
    projected_end_of_month_students: Optional[int] = None
    notes: Optional[str] = None


class CohortEnrollmentUpsert(CohortEnrollmentBase):
    program_id: int
    work_reference: str
    period_id: int


class CohortEnrollmentOut(CohortEnrollmentBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    program_id: int
    work_reference: str
    period_id: int
    updated_at: Optional[datetime] = None


# ---------- Student payments / revenue (owner-only) ----------

class StudentBase(BaseModel):
    name: str
    monthly_payment: Optional[Decimal] = None
    total_paid: Decimal = Decimal("0")
    total_committed: Optional[Decimal] = None
    notes: Optional[str] = None
    active: bool = True


class StudentCreate(StudentBase):
    program_id: int
    work_reference: str


class StudentUpdate(BaseModel):
    name: Optional[str] = None
    monthly_payment: Optional[Decimal] = None
    total_paid: Optional[Decimal] = None
    total_committed: Optional[Decimal] = None
    notes: Optional[str] = None
    active: Optional[bool] = None


class StudentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    program_id: int
    work_reference: str
    name: str
    monthly_payment: Optional[Decimal] = None
    total_paid: Decimal
    total_committed: Optional[Decimal] = None
    balance_remaining: Optional[float] = None
    notes: Optional[str] = None
    active: bool
    updated_at: Optional[datetime] = None


class CohortRevenueSummary(BaseModel):
    program_code: str
    work_reference: str
    student_count: int
    total_monthly: float
    total_paid: float
    total_committed: float
    total_balance_remaining: float
    # Cost-side context, pulled from the given (or most recent) pay period's
    # cohort_class assignments -- lets Marcelo see revenue next to what the
    # class actually costs to run, without this page needing its own period
    # picker semantics for the revenue data itself (which isn't period-scoped).
    period_label: Optional[str] = None
    period_cost: Optional[float] = None
    monthly_margin: Optional[float] = None
