"""
Tiny forward-only migration step, run at startup after create_all.

create_all() creates NEW tables but never alters an existing one, so columns
added to existing tables are added here with ADD COLUMN IF NOT EXISTS. Safe
to run on every boot and every seed (idempotent).
"""
import re
from datetime import date

from sqlalchemy import text

from app.core.database import engine

STATEMENTS = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS instructors_access BOOLEAN NOT NULL DEFAULT TRUE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS costs_access VARCHAR(20) NOT NULL DEFAULT 'none'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS view_all BOOLEAN NOT NULL DEFAULT FALSE",
]

_DAY = re.compile(r"^\s*(\d{1,2})\s+de\s+cada\s+mes", re.I)


def due_from_frequency(frequency, month_start: date):
    """'03 de cada mes' in October 2026 -> 2026-10-03. None if no day is given."""
    m = _DAY.match(frequency or "")
    if not m or not month_start:
        return None
    day = max(1, min(int(m.group(1)), 28 if month_start.month == 2 else 30 if month_start.month in (4, 6, 9, 11) else 31))
    return month_start.replace(day=day)


def _backfill_dates(conn) -> None:
    """One-off when the date columns are first added: due date from '<day> de cada mes',
    and for lines already marked Pagado, paid date = due date."""
    rows = conn.execute(text(
        "SELECT e.id, e.frequency, e.status, p.start_date FROM cost_entries e "
        "JOIN pay_periods p ON p.id = e.period_id WHERE e.due_date IS NULL")).fetchall()
    for rid, freq, status, start in rows:
        d = due_from_frequency(freq, start)
        if d:
            conn.execute(text("UPDATE cost_entries SET due_date = :d, paid_date = CASE WHEN status = 'Pagado' "
                              "THEN :d ELSE paid_date END WHERE id = :i"), {"d": d, "i": rid})


def run_migrations() -> None:
    with engine.begin() as conn:
        for stmt in STATEMENTS:
            conn.execute(text(stmt))
        has_due = conn.execute(text(
            "SELECT 1 FROM information_schema.columns WHERE table_name = 'cost_entries' "
            "AND column_name = 'due_date'")).first()
        table_exists = conn.execute(text(
            "SELECT 1 FROM information_schema.tables WHERE table_name = 'cost_entries'")).first()
        if table_exists and not has_due:
            conn.execute(text("ALTER TABLE cost_entries ADD COLUMN IF NOT EXISTS due_date DATE"))
            conn.execute(text("ALTER TABLE cost_entries ADD COLUMN IF NOT EXISTS paid_date DATE"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_cost_entries_due_date ON cost_entries (due_date)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_cost_entries_paid_date ON cost_entries (paid_date)"))
            _backfill_dates(conn)
