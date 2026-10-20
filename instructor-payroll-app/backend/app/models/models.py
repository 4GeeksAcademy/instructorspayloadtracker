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

    # Section access (the app hosts two sections: Instructors and Costs Hub).
    # Plain columns, not a new enum, so existing Postgres enum types don't
    # need migrating -- see app/core/migrate.py for the ADD COLUMN step.
    #   instructors_access: can open the Instructors (payroll hours) section
    #   costs_access: "none" | "viewer" | "editor"  (owner is always full)
    #   view_all: read-only access to everything, incl. owner-only views (Alejandro)
    instructors_access = Column(Boolean, nullable=False, default=True, server_default="true")
    costs_access = Column(String(20), nullable=False, default="none", server_default="none")
    view_all = Column(Boolean, nullable=False, default=False, server_default="false")

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


class Student(Base):
    """
    Per-student tuition/payment tracking for a cohort -- owner-only (see the
    /revenue router's role gate). Deliberately separate from CohortEnrollment:
    enrollment is a headcount for staffing ratios, this is money. Tied to the
    cohort itself (program_id + work_reference), NOT to a pay period -- a
    payment plan doesn't reset every month the way payroll hours do; you
    update a student's row as payments actually come in.
    """
    __tablename__ = "students"

    id = Column(Integer, primary_key=True)
    program_id = Column(Integer, ForeignKey("programs.id"), nullable=False)
    work_reference = Column(String(255), nullable=False)

    name = Column(String(150), nullable=False)
    monthly_payment = Column(Numeric(10, 2), nullable=True)   # what they pay per month, if on a plan
    total_paid = Column(Numeric(10, 2), nullable=False, default=0)   # cumulative, to date
    total_committed = Column(Numeric(10, 2), nullable=True)   # total contract value they owe
    notes = Column(Text, nullable=True)
    active = Column(Boolean, default=True, nullable=False)   # false = dropped/withdrawn, kept for history

    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    program = relationship("Program")

    @property
    def balance_remaining(self):
        if self.total_committed is None:
            return None
        return float(self.total_committed) - float(self.total_paid or 0)


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
    # Read-only view of the audit trail -- no schema change, just a join on
    # the existing audit_log.assignment_id FK.
    audit_entries = relationship(
        "AuditLog",
        primaryjoin="Assignment.id == foreign(AuditLog.assignment_id)",
        order_by="AuditLog.id",
        viewonly=True,
    )

    @property
    def review_changes(self) -> list[str]:
        """Edits reviewers made after submission (cohort/hours/rate), oldest first."""
        out = []
        for e in self.audit_entries or []:
            if e.action == "review_edit" and e.details:
                who = e.user.name if e.user else "Reviewer"
                out.append(f"{who}: {e.details}")
        return out

    @property
    def rejection_reason(self) -> str | None:
        """Latest reason given when this item was sent back, if it's currently rejected."""
        if self.status != AssignmentStatus.rejected:
            return None
        for e in reversed(self.audit_entries or []):
            if e.action == "rejected":
                return e.details
        return None

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

    user = relationship("User", viewonly=True)


class CostEntry(Base):
    """
    One line of the Costs Hub: a person, vendor, debt payment or other expense
    for one month (pay period). Mirrors the monthly payroll sheet's columns
    (Division, Rol o Departamento, Nombre completo, Monto, Status, Método,
    Frecuencia, Mes, Priority) plus what the Hub needs on top:

    - section: people | marketing | tech | operations | payroll_w2 | founders |
      debt | taxes | reimbursement | instructors_ref | other
      (instructors_ref = a bank-derived instructor total for months that have
      no rows in the Instructors section, so the dashboard isn't blind there;
      it's ignored automatically for any month that does have instructor rows.)
    - paid_by: who actually carries the cost -- "4Geeks USA" vs "Iberoamérica"
      / "España". Net USA cost = amount where paid_by is 4Geeks USA.
    - confirmed: once the owner confirms an entry (or the whole month), only
      the owner can change it.
    - is_projection: rows created by "copy month forward" or seeded as an
      estimate, until someone edits or confirms them.
    - target_amount: an optional planned amount (what we want this line to
      become) -- feeds the "What to adjust" view.
    """
    __tablename__ = "cost_entries"

    id = Column(Integer, primary_key=True)
    period_id = Column(Integer, ForeignKey("pay_periods.id"), nullable=False, index=True)

    section = Column(String(30), nullable=False, default="people")
    division = Column(String(30), nullable=True)          # USA | HQ | Latam | Spain | All
    department = Column(String(150), nullable=True)       # "Rol o Departamento" / vendor category
    name = Column(String(200), nullable=False)            # person or vendor
    amount = Column(Numeric(12, 2), nullable=False, default=0)
    status = Column(String(40), nullable=False, default="Pendiente")   # Pagado | Por pagar | Iberoamérica paga | España paga | Pendiente | Aprobar en Wise
    method = Column(String(40), nullable=True)            # ACH, Zelle, Wise, Cash, Melio, Card, ACH debit...
    frequency = Column(String(150), nullable=True)        # "30 de cada mes", "weekly"...
    paid_by = Column(String(40), nullable=False, default="4Geeks USA")
    priority = Column(String(20), nullable=True)          # Alta | Media | Baja
    notes = Column(Text, nullable=True)
    source = Column(String(40), nullable=True)            # payroll sheet | bank statement | estimate | manual
    is_projection = Column(Boolean, nullable=False, default=False)
    target_amount = Column(Numeric(12, 2), nullable=True)

    confirmed = Column(Boolean, nullable=False, default=False)
    confirmed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    confirmed_at = Column(DateTime(timezone=True), nullable=True)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    period = relationship("PayPeriod")


class CostLog(Base):
    """Audit trail for the Costs Hub (who changed what, when)."""
    __tablename__ = "cost_log"

    id = Column(Integer, primary_key=True)
    entry_id = Column(Integer, nullable=True)
    period_id = Column(Integer, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action = Column(String(60), nullable=False)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", viewonly=True)


class CostPeriodState(Base):
    """
    Month-level confirmation for the Costs Hub. When the owner confirms a
    month, every entry in it is confirmed too and editors can no longer add,
    change or delete anything in that month; the owner can unlock it again.
    """
    __tablename__ = "cost_period_state"

    period_id = Column(Integer, ForeignKey("pay_periods.id"), primary_key=True)
    confirmed = Column(Boolean, nullable=False, default=False)
    confirmed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    confirmed_at = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)


class Loan(Base):
    """
    Loans & financing register for the Costs Hub "Loans" segment: what each
    loan costs per week/month, how much is left and when it ends. Not tied to
    one month -- it powers the week-by-week debit calendar. (The monthly debt
    lines in cost_entries are what feed month totals; this is the schedule.)
    """
    __tablename__ = "loans"

    id = Column(Integer, primary_key=True)
    name = Column(String(150), nullable=False)
    lender = Column(String(150), nullable=True)
    kind = Column(String(40), nullable=True)               # MCA | Family | Founder | Private | Tax plan | Credit card
    frequency = Column(String(20), nullable=False, default="weekly")   # weekly | monthly
    payment = Column(Numeric(12, 2), nullable=False, default=0)        # per week or per month
    payment_day = Column(String(40), nullable=True)        # "Friday", "1", "15"...
    start_date = Column(Date, nullable=True)               # first payment of the current schedule
    end_date = Column(Date, nullable=True)                 # last expected payment
    original_amount = Column(Numeric(12, 2), nullable=True)
    total_payback = Column(Numeric(12, 2), nullable=True)
    balance_remaining = Column(Numeric(12, 2), nullable=True)
    balance_as_of = Column(Date, nullable=True)
    paid_by = Column(String(40), nullable=False, default="4Geeks USA")
    status = Column(String(30), nullable=False, default="Active")      # Active | Paused | Paid off
    notes = Column(Text, nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
