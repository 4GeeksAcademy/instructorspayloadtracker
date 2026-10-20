"""
Tiny forward-only migration step, run at startup after create_all.

create_all() creates NEW tables (cost_entries, cost_log) but never alters an
existing one, so the three section-access columns added to `users` for the
Costs Hub are added here with ADD COLUMN IF NOT EXISTS. Safe to run on every
boot and every seed (idempotent), and a no-op on a brand-new database where
create_all already made the columns.
"""
from sqlalchemy import text

from app.core.database import engine

STATEMENTS = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS instructors_access BOOLEAN NOT NULL DEFAULT TRUE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS costs_access VARCHAR(20) NOT NULL DEFAULT 'none'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS view_all BOOLEAN NOT NULL DEFAULT FALSE",
]


def run_migrations() -> None:
    with engine.begin() as conn:
        for stmt in STATEMENTS:
            conn.execute(text(stmt))
