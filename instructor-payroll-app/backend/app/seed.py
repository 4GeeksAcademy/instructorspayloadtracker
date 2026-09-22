"""
Seeds reference data (programs, roles, demo users, the August 2026 pay
period) AND imports the August spreadsheet as real Assignment rows, split
into the new schema.

Run with:  python -m app.seed

Migration notes on the August import:
- Multi-role rows in the original sheet ("Private Mentor, Global mentor")
  had ONE hours figure and ONE rate covering both functions combined --
  the source data never separately tracked hours per role. Rather than
  fabricate a hours split that isn't real, each such row is imported as a
  single Assignment under its PRIMARY (first-listed) role, with the other
  role(s) noted in `notes`. Going forward (per Marcelo's decision), any
  NEW multi-role work should be entered as separate Assignment rows, one
  per role, each with its own real hours.
- "Total Amount" / "Total + Difference" collapse into `adjustment_amount`
  (+ `adjustment_reason`) -- see models.py docstring.
- The old "Status" column (free-text notes like "$16 cursor") becomes
  `adjustment_reason` / `notes`. The separate "Kevin" column (payment
  status: "Registrado" / "Registrado - pagado") becomes the `status`
  field: registered / paid.
"""
from datetime import date
from decimal import Decimal

from app.core.categorize import suggest_work_category
from app.core.database import Base, SessionLocal, engine
from app.core.security import hash_password
from app.models.models import (
    Assignment,
    AssignmentStatus,
    PayPeriod,
    Person,
    Program,
    Role,
    User,
    UserRole,
)

PROGRAMS = [
    ("AI", "AI Engineering"),
    ("FS", "Full Stack"),
    ("DS", "Data Science"),
    ("CS", "Cybersecurity"),
]

ROLES = [
    "Instructor",
    "TA",
    "Private Mentor",
    "Global Mentor",
    "Global Mentor Assistant",
    "Prework Mentor",
    "Career Mentor",
]

# (person, program_code, work_reference, role, rate, hours, adjustment, adjustment_reason,
#  extra_roles_note, kevin_status)
AUGUST_ROWS = [
    ("Jaden Crews", "AI", "AI All support and grading", "Private Mentor", 15, 43.66, 0, None,
     "Also: Global Mentor Assistant (combined billing, not split historically)", "registered"),
    ("Jaden Crews", "AI", "ft-ai-eng-1", "TA", 15, 17, 0, None, None, "paid"),
    ("Jaden Crews", "AI", "ai-eng-2", "TA", 15, 39, 0, None, None, "paid"),

    ("Yuan Ma", "FS", "FS-90", "TA", 15, 0, 0, None, None, "approved"),

    ("Gabriel Zavarse", "AI", "AI All", "Private Mentor", 15, 44.9, 0, None,
     "Also: Prework Mentor (combined billing, not split historically)", "registered"),
    ("Gabriel Zavarse", "AI", "ft-ai-eng-2 & ft-ai-eng-3", "TA", 15, 63, 0, None, None, "registered"),
    ("Gabriel Zavarse", "AI", "ai-eng-4", "TA", 15, 15, 0, None, None, "paid"),

    ("Yeju Lee Motley", "FS", "FS All", "Private Mentor", 15, 0, 0, None, None, "approved"),
    ("Flavia Ballabene", "FS", "FS All", "Private Mentor", 15, 0, 0, None, None, "approved"),

    ("Ernesto Medina", "AI", "AI-eng-3", "Instructor", 50, 39, 0, None, None, "registered"),

    ("Shane Bell", "AI", "ft-ai-eng-2", "Instructor", 50, 60, 16, "$16 cursor (tool reimbursement)", None, "registered"),
    ("Shane Bell", "AI", "ai-eng-4", "Instructor", 50, 15, 0, None, None, "paid"),
    ("Shane Bell", "FS", "FS All", "Career Mentor", 20, 15, 0, None, None, "paid"),

    ("Ryan Castanier", "AI", "AI All", "Private Mentor", 15, 41.82, 0, None,
     "Also: Global Mentor (combined billing, not split historically)", "registered"),
    ("Ryan Castanier", "AI", "ft-ai-eng-1", "Instructor", 35, 17, 0, None, None, "paid"),
    ("Ryan Castanier", "AI", "ai-eng-2", "Instructor", 35, 39, 0, None, None, "paid"),
    ("Ryan Castanier", "AI", "ft-ai-eng-2", "Instructor", 35, 3, 0, None, None, "paid"),
    ("Ryan Castanier", "AI", "Extra hours meetings/grading/agent config", "Instructor", 15, 5, 0, None, None, "paid"),

    ("Enrique Pinedo", "AI", "ft-ai-eng-3", "Instructor", 35, 63, 0, None, None, "registered"),

    ("Samir Chawla", "DS", "DS-15", "Instructor", 40, 36, 0, None, None, "paid"),
    ("Samir Chawla", "DS", "DS All", "Career Mentor", 20, 1, 0, "mock interview* confirmed by Valentina", None, "paid"),

    ("Dyimah Ansah", "DS", "DS All", "Private Mentor", 15, 0, 0, None, None, "approved"),
    ("Marisol Hernandez", "DS", "DS All", "Private Mentor", 15, 0, 0, None, None, "approved"),

    ("Kyle Hille", "CS", "CS All", "Career Mentor", 20, 2, 0, None, None, "paid"),

    ("Russell Coonley", "DS", "DS All", "Private Mentor", 15, 27, 0, None,
     "Also: Global Mentor (combined billing, not split historically)", "registered"),
]

STATUS_MAP = {
    "approved": AssignmentStatus.approved,
    "registered": AssignmentStatus.registered,
    "paid": AssignmentStatus.paid,
}


def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        # Programs
        program_by_code = {}
        for code, name in PROGRAMS:
            program = db.query(Program).filter(Program.code == code).first()
            if not program:
                program = Program(code=code, name=name)
                db.add(program)
                db.flush()
            program_by_code[code] = program

        # Roles
        role_by_name = {}
        for name in ROLES:
            role = db.query(Role).filter(Role.name == name).first()
            if not role:
                role = Role(name=name)
                db.add(role)
                db.flush()
            role_by_name[name] = role

        # Demo users -- same "password" convention as the Commission Tracker
        ai_program = program_by_code["AI"]
        demo_users = [
            ("Program Lead (AI)", "programlead@4geeksacademy.com", UserRole.program_lead, ai_program.id),
            ("Admin Review", "admin@4geeksacademy.com", UserRole.admin, None),
            ("Marcelo Ricigliano", "mricigliano@4geeksacademy.com", UserRole.owner, None),
        ]
        for name, email, role, program_id in demo_users:
            user = db.query(User).filter(User.email == email).first()
            if not user:
                db.add(User(
                    name=name, email=email, role=role, program_id=program_id,
                    hashed_password=hash_password("password"),
                ))
        db.flush()

        # August 2026 pay period
        period = db.query(PayPeriod).filter(
            PayPeriod.start_date == date(2026, 8, 1), PayPeriod.end_date == date(2026, 8, 31)
        ).first()
        if not period:
            period = PayPeriod(label="August 2026", start_date=date(2026, 8, 1), end_date=date(2026, 8, 31))
            db.add(period)
            db.flush()

        # People + Assignments
        person_by_name = {}
        imported = 0
        for (person_name, prog_code, work_ref, role_name, rate, hours, adj, adj_reason,
             extra_note, kevin_status) in AUGUST_ROWS:

            person = person_by_name.get(person_name)
            if not person:
                person = db.query(Person).filter(Person.name == person_name).first()
                if not person:
                    person = Person(name=person_name)
                    db.add(person)
                    db.flush()
                person_by_name[person_name] = person

            existing = (
                db.query(Assignment)
                .filter(
                    Assignment.person_id == person.id,
                    Assignment.period_id == period.id,
                    Assignment.work_reference == work_ref,
                    Assignment.role_id == role_by_name[role_name].id,
                )
                .first()
            )
            if existing:
                continue  # already seeded

            db.add(Assignment(
                person_id=person.id,
                program_id=program_by_code[prog_code].id,
                role_id=role_by_name[role_name].id,
                period_id=period.id,
                work_reference=work_ref,
                work_category=suggest_work_category(work_ref),
                rate=Decimal(str(rate)),
                hours=Decimal(str(hours)),
                adjustment_amount=Decimal(str(adj)),
                adjustment_reason=adj_reason,
                hours_verified=True,
                notes=extra_note,
                status=STATUS_MAP[kevin_status],
            ))
            imported += 1

        db.commit()
        print(f"Seed complete. Imported {imported} new assignment rows for {period.label}.")
        # Deliberately no CohortEnrollment rows seeded here: there's no real
        # student headcount on file for August, so the dashboard should show
        # those fields blank ("not entered yet"), not a guessed number.

    finally:
        db.close()


if __name__ == "__main__":
    seed()
