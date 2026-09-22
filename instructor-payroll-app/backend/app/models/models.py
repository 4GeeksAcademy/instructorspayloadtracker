"""
Instructor Payroll data model.

Design notes (see README for full rationale):
- One row per (person, program, role, period, work_reference) = one `Assignment`.
  A person with several roles/cohorts in the same month gets several
  Assignment rows, mirroring how the source spreadsheet actually behaved --
  but each row now has exactly ONE role, not a comma-packed string.
- `work_reference` stays free text on purpose (per Marcelo's call): it may be
  a real cohort slug ("ft-ai-eng-1"), the literal "All" (program-wide, not
  tied to one cohort), or a non-cohort work category ("Extra hours /
  meetings / grading"). We do NOT force it into a cohort foreign key yet.
- There is exactly ONE stored total: `adjustment_amount` (+ `adjustment_reason`).
  `calculated_amount` (hours * rate) and `total_amount` (calculated +
  adjustment) are computed, never duplicated in two competing columns like
  the old "Total Amount" / "Total + Difference" pair.
- `hours_verified` replaces the manual red/green cell-coloring convention
  from the spreadsheet with an explicit, queryable flag.
- `status` captures the full lifecycle: the 3-tier submit -> admin review ->
  Marcelo approval flow (same shape as the Commission Tracker), PLUS the two
  extra states the "Kevin" column was tracking after approval (entered into
  the payroll system / actually paid).
"""
import enum

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship

from app.core.database import Base


class UserRole(str, enum.Enum):
    program_lead = "program_lead"   # submits hours for their program (e.g. Marco, Valentina)
    admin = "admin"                  # financial/academic review
    owner = "owner"                  # final approval (Marcelo)


class WorkCategory(str, enum.Enum):
    """
    Explicit, stored cost-center bucket for an assignment -- powers the
    dashboard's "cost by cohort/class" vs "mentorship & private sessions" vs
    "overhead/admin" views. Suggested automatically from work_reference on
    create (see app/core/categorize.py), but stored as a real column and
    editable, rather than re-derived by string-matching on every read. That
    re-derivation was tried first (for the one-off August export) and
    silently misclassified a row -- storing it explicitly means a bad guess
    is a one-time, correctable data issue, not a recurring report bug.
    """
    cohort_class = "cohort_class"                 # tied to one real cohort/class
    mentorship_private = "mentorship_private"      # program-wide mentoring, not one cohort
    overhead_admin = "overhead_admin"              # meetings, grading, admin/config time


class AssignmentStatus(str, enum.Enum):
    draft = "draft"                       # program lead is still editing
    submitted = "submitted"               # sent for admin review
    admin_reviewed = "admin_reviewed"     # admin approved, awaiting final approval
    approved = "approved"                 # Marcelo signed off, ready for payroll
    registered = "registered"             # entered into payroll system ("Registrado")
    paid = "paid"                         # payment completed ("Registrado - pagado")
    rejected = "rejected"                 # sent back for correction


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=False)
    email = Column(String(200), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(Enum(UserRole), nullable=False, default=UserRole.program_lead)
    program_id = Column(Integer, ForeignKey("programs.id"), nullable=True)  # scopes a program_lead to one program
    active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    program = relationship("Program")


class Program(Base):
    __tablename__ = "programs"

    id = Column(Integer, primary_key=True)
    code = Column(String(10), unique=True, nullable=False)   # AI, FS, DS, CS
    name = Column(String(120), nullable=False)                # "AI Engineering", "Full Stack", ...
    active = Column(Boolean, default=True, nullable=False)

    assignments = relationship("Assignment", back_populates="program")


class Person(Base):
    __tablename__ = "people"

    id = Column(Integer, primary_key=True)
    name = Column(String(150), nullable=False)
    email = Column(String(200), nullable=True)
    active = Column(Boolean, default=True, nullable=False)
    notes = Column(Text, nullable=True)

    assignments = relationship("Assignment", back_populates="person")


class Role(Base):
    """
    Lookup table instead of a hardcoded enum so a new role type can be added
    (e.g. a future "Lead Instructor") without a migration touching every row.
    Seeded with the roles observed in the source spreadsheet.
    """
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True)
    name = Column(String(80), unique=True, nullable=False)
    default_rate = Column(Numeric(8, 2), nullable=True)  # optional suggestion, not enforced

    assignments = relationship("Assignment", back_populates="role")


class PayPeriod(Base):
    __tablename__ = "pay_periods"

    id = Column(Integer, primary_key=True)
    label = Column(String(40), nullable=False)   # "August 2026"
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    locked = Column(Boolean, default=False, nullable=False)  # true once fully paid out

    __table_args__ = (UniqueConstraint("start_date", "end_date", name="uq_period_dates"),)

    assignments = relationship("Assignment", back_populates="period")


class CohortEnrollment(Base):
    """
    Student headcount for a cohort/class, per pay period -- separate from
    Assignment on purpose. Enrollment is a property of the cohort itself
    (set once by whoever tracks admissions), not of any one person's pay
    row, and a cohort can have enrollment data before or after it has any
    staffing assigned. Keyed on (program_id, work_reference, period_id) to
    match the same free-text work_reference used on Assignment rows, since
    there's no separate "real cohort" table yet (see Assignment's
    docstring on why work_reference stayed free text).
    """
    __tablename__ = "cohort_enrollments"

    id = Column(Integer, primary_key=True)
    program_id = Column(Integer, ForeignKey("programs.id"), nullable=False)
    work_reference = Column(String(255), nullable=False)
    period_id = Column(Integer, ForeignKey("pay_periods.id"), nullable=False)

    current_students = Column(Integer, nullable=False, default=0)
    projected_end_of_month_students = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)

    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("program_id", "work_reference", "period_id", name="uq_cohort_enrollment"),
    )

    program = relationship("Program")


class Assignment(Base):
    """
    The core record. One person doing one role, for one program/work item,
    in one pay period. Replaces one row of the old spreadsheet -- except a
    multi-role row there is now split into multiple Assignment rows here.
    """
    __tablename__ = "assignments"

    id = Column(Integer, primary_key=True)

    person_id = Column(Integer, ForeignKey("people.id"), nullable=False)
    program_id = Column(Integer, ForeignKey("programs.id"), nullable=False)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=False)
    period_id = Column(Integer, ForeignKey("pay_periods.id"), nullable=False)

    # Free text on purpose -- see module docstring. Examples:
    # "ft-ai-eng-1" (real cohort), "All" (program-wide, no single cohort),
    # "Extra hours meetings/grading/agent config" (non-cohort work category).
    work_reference = Column(String(255), nullable=False)

    # Explicit cost-center bucket -- see WorkCategory docstring above.
    work_category = Column(Enum(WorkCategory), nullable=False, default=WorkCategory.cohort_class)

    rate = Column(Numeric(8, 2), nullable=False)
    hours = Column(Numeric(6, 2), nullable=False, default=0)

    # One place for an adjustment, replacing the old duplicated total columns.
    adjustment_amount = Column(Numeric(8, 2), nullable=False, default=0)
    adjustment_reason = Column(Text, nullable=True)

    # Replaces the manual red/green cell-coloring convention.
    hours_verified = Column(Boolean, nullable=False, default=False)

    notes = Column(Text, nullable=True)

    status = Column(Enum(AssignmentStatus), nullable=False, default=AssignmentStatus.draft)

    submitted_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    person = relationship("Person", back_populates="assignments")
    program = relationship("Program", back_populates="assignments")
    role = relationship("Role", back_populates="assignments")
    period = relationship("PayPeriod", back_populates="assignments")

    @property
    def calculated_amount(self) -> float:
        return float(self.hours or 0) * float(self.rate or 0)

    @property
    def total_amount(self) -> float:
        return self.calculated_amount + float(self.adjustment_amount or 0)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True)
    assignment_id = Column(Integer, ForeignKey("assignments.id"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action = Column(String(80), nullable=False)   # e.g. "submitted", "admin_reviewed", "approved", "edited"
    details = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
