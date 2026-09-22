# 4Geeks Instructor Payroll

Tracks instructor/mentor hours and pay across programs and cohorts, with the
same 3-tier approval workflow as the Commission Tracker (program lead →
admin review → Marcelo's final approval), plus payroll registration and
payment tracking.

Stack: React 18 + FastAPI + PostgreSQL, Docker, deployed on Railway — same
shape as the Commission Tracker.

## Why this exists / what it replaces

Built from a monthly spreadsheet where each row was a person + program +
cohort + role + hours + rate, with a manually maintained payment-status
column. That worked, but had a few structural problems this app fixes:

| Spreadsheet problem | Fix here |
|---|---|
| "Total Amount" and "Total + Difference" columns almost always duplicated each other, with a rare $ adjustment breaking the pattern | One computed total (`hours × rate + adjustment`); the adjustment is its own field with a reason, never a second total column |
| "Role" packed multiple roles into one comma-separated string with one shared rate/hours | Each role is its own `Assignment` row with its own rate and hours |
| "Status" column was actually free-text notes ("$16 cursor"), while the real payment status lived in an unrelated "Kevin" column ("Registrado" / "Registrado - pagado") | One `status` field drives the whole lifecycle: `draft → submitted → admin_reviewed → approved → registered → paid` (plus `rejected`) |
| Red/green cell coloring was a manual, unqueryable "hours verified" signal | Explicit `hours_verified` boolean on each assignment |
| No structural link between "0 hours logged this month" and "person is assigned but idle" | $0 assignments are a normal, first-class state, not blank cells |

`Cohort ID(s)` stays free text on purpose (per your call) — it can be a real
cohort slug (`ft-ai-eng-1`), the literal `All` (program-wide work, not tied
to one cohort), or a work category (`Extra hours / meetings / grading`). If
this becomes worth structuring later (a real cohort list plus a separate
non-cohort work-category list), that's a schema change to `work_reference`,
not a rebuild.

## Dashboard

The home screen is now a live dashboard: total to pay, total hours, cost by
category (Cohort/Class Instruction vs. Mentorship & Private Sessions vs.
Overhead/Admin), cost by program, a cost-by-cohort/class table with the
people and roles staffed on each one, and the per-person breakdown.

The category split is backed by a real `work_category` column on each
Assignment (`cohort_class` / `mentorship_private` / `overhead_admin`), not
re-derived by string-matching on every read. It's auto-suggested from
`work_reference` when a row is created (see `app/core/categorize.py` — one
importable function, used by both the API and the seed script, so the
suggestion logic can't drift into two different answers) but stored
explicitly and editable from the Submit Hours form, so a bad guess is a
one-time fix, not a recurring report bug. That's a direct lesson from
building the one-off August export: the first version of this logic was
duplicated between a script and the app and silently misclassified a row
before it was caught.

## Cohort enrollment & staffing checks

Each cohort/class row on the dashboard has an editable **current students**
and **projected end-of-month students** count. This is manual data entry on
purpose — there's no student-information-system integration to sync it from
yet — and it's intentionally *actual current enrollment*, not seat capacity.
Entering it drives two things per cohort:

- **Cost / student** — `total cost ÷ current students`, blank until someone
  enters a headcount (never silently shown as $0).
- **Students / staff** — `current students ÷ distinct instructors-or-TAs
  assigned`, plus a red-flagged **unstaffed** warning when a cohort has
  students enrolled but zero Instructor/TA assigned. This also catches the
  edge case of a cohort with enrollment entered but *no assignment row at
  all yet* — it still shows up in the table, flagged, rather than being
  invisible until someone gets around to staffing it.

Storage: a separate `cohort_enrollments` table (`program_id` +
`work_reference` + `period_id` + counts), not columns bolted onto
`Assignment` — enrollment is a property of the cohort itself, set once by
whoever tracks admissions, independent of who ends up staffed on it or when.
`PUT /enrollment` is an upsert (create-or-update by that same key), matching
the app's other "just re-save the form" conventions rather than needing a
separate create vs. edit call.

## Adding a new pay period

Every page picks a pay period from a dropdown that defaults to the newest
one. To add the next month: on the **Dashboard**, next to the period
dropdown, click **+ New period** (visible to `admin`/`owner` only), give it
a label (e.g. "October 2026") and its start/end dates, and save — it
immediately becomes selectable everywhere (Dashboard, Submit Hours, Admin
Review, Final Approval). There's no need to touch the database or run a
script; this was previously API-only (`POST /periods`) and now has a form.
`program_lead` accounts don't get the button (matches the backend's existing
`admin`/`owner`-only restriction on creating periods), but can select any
period once it exists.

August's seed data does **not** include enrollment — there's no real student
count on file for that month, so those fields start blank/"—" on the
dashboard rather than a placeholder guess.

## Revenue (owner) and Students (admin + owner)

Both live at `/revenue`, backed by the same `students` table and the same
`/revenue/*` API — the page just renders differently depending on who's
looking, and the API enforces the same split server-side:

- **Owner** (Marcelo) sees the full **Revenue** page: the nav says
  "Revenue," and the page shows both the student roster tool below *and*
  the **cohort performance table** at the top — student count, total
  monthly revenue, paid to date, committed, balance remaining, the
  selected pay period's payroll cost, and the resulting monthly margin
  (revenue − cost), sorted worst-margin-first. This is the private
  profitability view — `GET /revenue/summary` requires the `owner` role
  specifically, 403s an `admin`, and the page doesn't request it (or
  render the table) for anyone else.
- **Admin** sees the same route, but the nav says "Students" and the page
  shows only the roster tool — no cohort performance table, no margin, no
  payroll-cost comparison. They can pick (or start) a cohort and add,
  edit, or remove students there: name, monthly payment, total paid to
  date, and total committed (the full tuition amount owed). Balance
  remaining is computed (`committed − paid`), never entered directly. A
  student can be marked inactive (dropped/withdrew) instead of deleted, to
  keep history. This is deliberately data entry only — admins keep the
  roster current, but the profitability rollup stays owner-only.
- **Program leads** don't see this at all — no nav link, and the API
  403s every `/revenue/*` route (roster included) for that role, same as
  before.
- Student data is **not tied to a pay period** — tuition doesn't reset
  every month the way payroll hours do, so you update a student's row as
  payments actually come in and it carries forward. Only the *cost* side
  of the owner's margin table (`period_cost`) is pulled from whichever pay
  period is selected there.
- To add students for a cohort that has no payroll data yet (or a
  brand-new one), just type its program and cohort/class name in the "Add
  or manage students" section — no separate "create cohort" step; the
  first student you add creates it. This works the same for admin and
  owner.

Storage: the `students` table, keyed to a cohort (`program_id` +
`work_reference`) the same way `cohort_enrollments` is, but deliberately
**not** period-scoped. Role split lives at the router level in
`backend/app/routers/revenue.py`: the four roster endpoints
(list/create/update/delete students) require `admin` or `owner`; `GET
/revenue/summary` requires `owner` alone.

## Settings — changing your password

Every user has a **Settings** link in the top-right corner (next to their
name and Log out) that goes to `/settings`. Two things live there:

- **Change your password** — everyone gets this. Enter your current
  password plus a new one (twice, to confirm), minimum 8 characters. This
  is a normal self-service change: you must know your current password to
  set a new one (`PATCH /auth/me/password`).
- **Reset a teammate's password** — owner-only (Marcelo). A table of every
  account with a "Reset password" button next to each: type a new
  password and save, no need to know their current one. This is for
  someone locked out or who forgot theirs (`PATCH /users/{id}/password`,
  gated to the `owner` role at the router level, same pattern as
  `/revenue`). Non-owner accounts don't see this section at all — the
  Settings page renders it conditionally based on your role, and the API
  independently rejects the request with 403 even if someone tried to hit
  it directly.

## Branding

Uses the 4Geeks color system (brand blue `#2381FF`, ink/body/muted grays,
pastel data-card accents) and Inter, matching 4geeksacademy.com's design
language, applied to an internal admin/dashboard layout rather than a
marketing page. Chart bars intentionally use a single hue (blue) rather than
a multi-color categorical palette — every bar is already direct-labeled, and
the brand system itself doesn't have a validated multi-hue set (its pastels
are meant for card backgrounds, not chart fills at magnitude-comparison
scale; verified by running the `dataviz` skill's palette validator against
the brand's amber/gray before deciding against them).

**Logo:** `frontend/public/brand/` ships the current 4Geeks wordmark (head
icon + "4Geeks", no "academy" line, cyan-blue `#0097CD` "k") — `logo-dark.png`
for light backgrounds, `logo-white.png` for dark backgrounds, `logo-allwhite.png`
for brand-blue `#2381FF` backgrounds, generated from the source file Marcelo
provided. `rigo.svg` is still the older Rigo mascot render bundled in the
`4geeks-academy` skill's assets (no updated Rigo file was provided this
round) — swap it in the same way if/when you have the current one. Nothing
else needs to change to update any of these; every page references the file
paths in that folder rather than the artwork's shape directly.

## Project structure

```
backend/            FastAPI app (SQLAlchemy models, routers, auth)
  app/models/        Database schema (see models.py docstring for full rationale)
  app/routers/        auth, reference data, assignments + approval workflow
  app/seed.py         Seeds programs/roles/demo users + imports August 2026 data
frontend/            React app (Vite)
  src/pages/          Submit Hours, Admin Review, Final Approval, Reports
infrastructure/
  docker-compose.yml  Local dev: Postgres + backend + frontend together
```

## Data model (short version)

- `people` — instructors/mentors
- `programs` — AI, FS, DS, CS
- `roles` — Instructor, TA, Private Mentor, Global Mentor, Global Mentor
  Assistant, Prework Mentor, Career Mentor (a lookup table, not a hardcoded
  enum, so a new role doesn't need a migration)
- `pay_periods` — monthly periods (e.g. "August 2026")
- `assignments` — the core record: one person + one role + one program +
  one period + free-text `work_reference`, with `rate`, `hours`,
  `adjustment_amount`/`adjustment_reason`, `hours_verified`, and `status`
- `cohort_enrollments` — manually entered current/projected student headcount
  per (program, `work_reference`, period) — see "Cohort enrollment & staffing
  checks" above
- `students` — owner-only per-student tuition tracking per (program,
  `work_reference`) — see "Revenue (owner-only)" above
- `users` — `program_lead` (scoped to one program), `admin`, `owner` (Marcelo)
- `audit_log` — every status transition and edit, who/when

Full column-by-column rationale is in `backend/app/models/models.py` and
`backend/app/seed.py` (the seed file also documents exactly how the August
spreadsheet was migrated, row by row).

## Approval workflow

```
draft --submit--> submitted --admin review--> admin_reviewed
   ^                                                |
   |<---------------- reject (either tier) ---------+
                                                      |
                                              owner approves
                                                      v
                                                  approved
                                                      |
                                         admin marks registered
                                                      v
                                                 registered
                                                      |
                                          admin marks paid
                                                      v
                                                    paid
```

- **program_lead**: creates/edits drafts for their own program, submits them.
- **admin**: reviews submissions, can approve-to-next-tier or reject with a
  reason; later marks approved items as registered/paid.
- **owner** (Marcelo): final sign-off between admin review and payroll.

Only `draft` and `rejected` assignments can be edited — once submitted, the
numbers are locked until someone rejects it back down.

## Running locally

**Fastest path — Docker:**

```bash
cd infrastructure
docker compose up --build
```

- Backend: http://localhost:8000 (docs at `/docs`)
- Frontend: http://localhost:4173

Then seed demo data (from a separate terminal, once the backend container
is up):

```bash
docker compose exec backend python -m app.seed
```

**Without Docker** (what was actually used to test this build):

```bash
# Postgres running locally, database `instructor_payroll` created
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/instructor_payroll"
.venv/bin/python -m app.seed          # seeds reference data + imports August 2026
.venv/bin/uvicorn app.main:app --reload

# separate terminal
cd frontend
npm install
npm run dev      # http://localhost:5173, or `npm run build && npm run preview`
```

Demo users (seeded, password `password` for all — same convention as the
Commission Tracker):

| Email | Role |
|---|---|
| `programlead@4geeksacademy.com` | program_lead (scoped to AI) |
| `admin@4geeksacademy.com` | admin |
| `mricigliano@4geeksacademy.com` | owner |

## Deployed on Railway

Live now, same pattern as the Commission Tracker, project `4geeks-instructor-payroll`:

- Backend: `https://backend-production-becd0.up.railway.app` (`/health` → `200 OK`)
- Frontend: `https://frontend-production-bea6.up.railway.app`
- Postgres: Railway-managed, `DATABASE_URL` injected into the backend automatically.

Setup used to get there (for reference, or to reproduce on a new environment):

1. Push this repo to GitHub, then in Railway: New Project → Deploy from
   GitHub → point one service's root directory at
   `instructor-payroll-app/backend`, another at `instructor-payroll-app/frontend`.
2. Add a Postgres plugin to the project; Railway injects `DATABASE_URL` into
   the backend service automatically.
3. Set `SECRET_KEY` on the backend service (generate a real random value —
   don't reuse the local dev default).
4. Set `VITE_API_URL` as a **build-time** variable on the frontend service,
   pointing at the backend's public Railway URL (Vite bakes it into the
   bundle at build time, not runtime).
5. Set `CORS_ORIGINS` on the backend to the frontend's public Railway URL.
6. The backend's **pre-deploy command** is set to `python -m app.seed`, so
   the seed (reference data + the August import) runs automatically before
   every deploy — safe to leave in place, since the script is idempotent
   (find-or-create everywhere, so a second run imports nothing new). Confirmed
   live: the first production deploy's logs show
   `Seed complete. Imported 25 new assignment rows for August 2026.`

## What was tested before delivery

- Frontend: `npm run build` — clean production build, no errors.
- Backend: ran against a real local Postgres instance — seed script
  imports all 25 August assignment rows and reconciles to the original
  spreadsheet's **$16,231.70** total exactly.
- Full workflow exercised end-to-end over HTTP: draft → submit → admin
  review → owner approval → registered → paid, plus confirmed a
  `program_lead` is blocked (403) from admin-review/approve actions and an
  `admin` is blocked (403) from final approval (owner-only).
- Confirmed a paid/locked assignment rejects edits (400), and that an
  invalid person/program/role/period id on create returns a clean 400
  instead of a raw database error.
- `/assignments/summary/by-category` and `/assignments/summary/by-cohort`
  (the endpoints behind the dashboard) checked against a live Postgres
  instance: category totals sum to the same $16,231.70, and the by-cohort
  view's per-cohort totals were spot-checked against the workbook delivered
  earlier — matched exactly.
- Enrollment/staffing feature tested end-to-end against a live instance:
  `PUT /enrollment` upserts in place (confirmed same row `id` and no
  duplicate on a second save, not just a create), is blocked with 403 for a
  `program_lead` setting enrollment on another program, and rejects an
  invalid `program_id` with a clean 400. Verified the math by hand: a cohort
  costing $1,950 with 25 students entered came back as exactly $78.00/student
  and a 25.0 students/staff ratio with 1 instructor assigned. Confirmed a
  cohort with enrollment entered but zero assignment rows still appears in
  the table (rather than being invisible) and is flagged unstaffed. Exercised
  the actual Save button in the running UI via Playwright (typed values,
  clicked Save, reloaded from the API, confirmed the saved numbers and
  recomputed cost-per-student/ratio render correctly) — not just the API
  in isolation.
- Adding a pay period and the Revenue feature both tested end-to-end
  against a live instance, not just unit-level: `POST /periods` confirmed
  working for `admin`/`owner` and correctly 403'd for `program_lead`;
  `/revenue/*` endpoints confirmed 403'd for `program_lead` and working for
  `owner` (student create/update/delete, roster listing, and the cohort
  summary's math — with a 2-student cohort costing $2,000 in payroll and
  $1,000/month combined revenue, the summary correctly returned a
  **-$1,000 monthly margin**). Exercised the real UI with Playwright: logged
  in as the owner, clicked "+ New period" on the Dashboard, created a period,
  confirmed it appeared in the dropdown; navigated to the Revenue page,
  picked a program/cohort, added a student through the form, and confirmed
  on a **fresh page reload** (not just client state) that the cohort now
  shows up in the performance table with the correct numbers — proving the
  full round trip through the API and database, not just the form.
- Rendered the actual app with a real browser (Playwright) and screenshotted
  Dashboard, Submit Hours, and Admin Review after every styling change,
  rather than trusting `npm run build` alone — caught and fixed a real CSS
  truncation bug (a category label getting cut off in the dashboard's bar
  chart) this way.
- Found and fixed a real backend config bug in the process: `cors_origins`
  was typed `list[str]`, which pydantic-settings tries to parse as JSON from
  the environment — setting `CORS_ORIGINS` as a plain comma-separated string
  (the documented, intended usage) crashed the app on startup. Now a plain
  string field with a `.cors_origins_list` property.
- Not tested in this environment (no Docker daemon available here):
  `docker-compose up` itself. The Dockerfiles are standard single-stage/
  multi-stage builds mirroring the working local setup above — but this
  became moot for the actual rollout, since both services deployed and
  built cleanly on Railway directly from the Dockerfiles (see below).
- Self-service password change and owner-only teammate password reset
  tested end-to-end, both via `TestClient` and a real browser: a
  `program_lead` can change their own password but gets 403 from both
  `/users` endpoints; the wrong current password is rejected with 400; a
  too-short new password is rejected with 422; the old password stops
  working and the new one works immediately after a change. In the actual
  running UI (Playwright, against a seeded instance with the real owner
  account): changed the owner's own password through the Settings page,
  logged out and back in with the new password to confirm it was a real
  server-side change, then used the owner-only table to reset a program
  lead's password and confirmed that account could log in with the
  owner-set password too. Also confirmed a non-owner's Settings page does
  not render the "Reset a teammate's password" section at all.
- Opening student-roster management to admins (while keeping the
  profitability/margin view owner-only) tested end-to-end, both via
  `TestClient` and a real browser: confirmed an `admin` can create, list,
  update, and delete students on `/revenue/students`, is correctly 403'd
  from `/revenue/summary`, and a `program_lead` is still 403'd from every
  `/revenue/*` route including the roster. In the running UI: logged in
  as an admin, confirmed the nav shows "Students" (not "Revenue") and the
  page renders only the roster tool with no cohort-performance table
  anywhere in the page text; added a student as admin and confirmed it
  survived a fresh page reload; then logged in as the owner and confirmed
  that same admin-added cohort now appears correctly in the full Revenue
  page's margin table; then logged in as a program lead and confirmed
  there's no "Students"/"Revenue" nav link and a direct visit to
  `/revenue` redirects away.
- Production deployment verified against the real Railway services, not
  just build success: backend build logs show a clean dependency install
  and image build; backend deploy logs show the pre-deploy seed step
  running (`Seed complete. Imported 25 new assignment rows for August
  2026.`), then `Application startup complete.` and Railway's own
  healthcheck (`GET /health` → `200 OK`) passing; frontend deploy logs
  show its server starting and accepting connections. `environment-status`
  shows all three services (backend, frontend, Postgres) `online` with
  zero warnings/criticals and zero recent failures.

## Known follow-ups worth doing before this is the system of record

- Add real authentication hardening (password reset flow, rate limiting on
  `/auth/login`) before this touches real payroll data at scale.
- Consider structuring `work_reference` once you've seen a few more months
  of data (a real cohort list + a separate non-cohort work-category list),
  per the note above.
- `Base.metadata.create_all()` is used for schema setup (see `main.py`) —
  fine for this rollout, but swap to Alembic migrations before making
  schema changes against real production data.
- Enter real (non-seed) cohort enrollment numbers as they become
  available — none were on file for August, so those fields start blank
  in production, by design.
