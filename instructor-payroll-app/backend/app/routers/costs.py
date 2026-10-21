"""
Costs Hub -- every monthly expense of 4Geeks USA outside the Instructors
section: team/contractors, payroll (W-2), founders, marketing, tech & apps,
operations, debt, taxes, plus what Spain/LATAM pay or reimburse.

Access (see app/core/deps.py):
- owner (Marcelo): everything, and the only one who can confirm/lock
- costs_access="editor" (Kevin): add/edit/delete while a month or entry is
  not confirmed
- costs_access="viewer" or view_all (Alejandro): read-only

Instructor pay is NOT stored here -- it lives in the Instructors section
(assignments). The summary reads it from there so nobody is counted twice.
For months with no instructor rows yet, an `instructors_ref` entry (a total
taken from the bank statements) stands in, and is ignored automatically as
soon as that month has real instructor rows.
"""
import json
import os
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import (
    can_edit_costs,
    is_owner,
    require_costs_edit,
    require_costs_view,
    require_owner,
)
from app.models.models import (
    Assignment,
    AssignmentStatus,
    CostCategory,
    CostEntry,
    CostLog,
    InsightLog,
    CostPeriodState,
    PayPeriod,
    User,
)
from app.schemas.schemas import CostBulkUpdate, CostCategoryCreate, CostEntryCreate, CostEntryOut, CostEntryUpdate

router = APIRouter(prefix="/costs", tags=["costs"])

SECTIONS = [
    ("people", "Team & contractors"),
    ("instructors", "Instructors (from Instructors section)"),
    ("payroll_w2", "Payroll W-2 + taxes"),
    ("founders", "Founders"),
    ("marketing", "Marketing"),
    ("tech", "Tech & apps"),
    ("operations", "Operations & admin"),
    ("debt", "Debt & financing"),
    ("taxes", "Taxes"),
    ("reimbursement", "Reimbursements (Spain / LATAM)"),
    ("other", "Other"),
]
SECTION_LABEL = dict(SECTIONS)
STATUSES = ["Pagado", "Por pagar", "Pendiente", "Iberoamérica paga", "España paga", "Aprobar en Wise", "Pausado"]
METHODS = ["ACH", "ACH - BoFa", "Zelle", "Transferwise", "Cash", "Melio", "Card", "ACH debit", "Check", "PayPal", "Wire"]
DIVISIONS = ["USA", "HQ", "Latam", "Spain", "All"]
PAID_BY = ["4Geeks USA", "Iberoamérica", "España", "LATAM"]
PRIORITIES = ["Alta", "Media", "Baja"]
USA = "4Geeks USA"


# ---------- helpers ----------

def _sections(db: Session) -> list[tuple[str, str]]:
    """Built-in sections + categories created in the app."""
    custom = [(c.key, c.label) for c in db.query(CostCategory).order_by(CostCategory.created_at).all()]
    out = list(SECTIONS)
    out.insert(len(out) - 1, ("__custom__", ""))  # custom ones go before "Other"
    i = out.index(("__custom__", ""))
    return out[:i] + custom + out[i + 1:]


def _section_labels(db: Session) -> dict:
    return dict(_sections(db))


def _check_section(db: Session, key: Optional[str]):
    if key is None or key == "instructors_ref":
        return
    if key == "instructors" or key not in _section_labels(db):
        raise HTTPException(status_code=400, detail=f"Unknown category: {key}")


def _apply_paid_rules(e: CostEntry, data: dict):
    """Status Pagado <-> paid date stay in sync unless a date is given explicitly."""
    if "status" in data and "paid_date" not in data:
        if data["status"] == "Pagado" and not e.paid_date:
            e.paid_date = date.today()
        elif data["status"] != "Pagado" and e.paid_date:
            e.paid_date = None
    if "paid_date" in data and data["paid_date"] and "status" not in data and e.status != "Pagado":
        e.status = "Pagado"


def _log(db, user, action, entry_id=None, period_id=None, details=None):
    db.add(CostLog(user_id=user.id if user else None, action=action, entry_id=entry_id,
                   period_id=period_id, details=details))


def _period_state(db: Session, period_id: int) -> Optional[CostPeriodState]:
    return db.query(CostPeriodState).filter(CostPeriodState.period_id == period_id).first()


def _month_locked(db: Session, period_id: int) -> bool:
    st = _period_state(db, period_id)
    return bool(st and st.confirmed)


def _check_editable(db: Session, user: User, entry: Optional[CostEntry], period_id: int):
    if is_owner(user):
        return
    if _month_locked(db, period_id):
        raise HTTPException(status_code=400, detail="This month is confirmed by Marcelo and can't be edited")
    if entry is not None and entry.confirmed:
        raise HTTPException(status_code=400, detail="This line is confirmed by Marcelo and can't be edited")


def _f(v) -> float:
    return float(v or 0)


def _instructor_total(db: Session, period_id: int) -> float:
    rows = (db.query(Assignment)
            .filter(Assignment.period_id == period_id, Assignment.status != AssignmentStatus.rejected)
            .all())
    return round(sum(a.total_amount for a in rows), 2)


def _periods(db: Session):
    return db.query(PayPeriod).order_by(PayPeriod.start_date).all()


def _month_totals(db: Session, period: PayPeriod) -> dict:
    entries = db.query(CostEntry).filter(CostEntry.period_id == period.id).all()
    instr_rows = _instructor_total(db, period.id)
    instr_ref = sum(_f(e.amount) for e in entries if e.section == "instructors_ref")
    instructors = instr_rows if instr_rows > 0 else instr_ref
    by_section = defaultdict(float)
    by_section_usa = defaultdict(float)
    by_division = defaultdict(float)
    by_paid_by = defaultdict(float)
    gross = 0.0
    net_usa = 0.0
    for e in entries:
        if e.section == "instructors_ref":
            continue
        a = _f(e.amount)
        by_section[e.section] += a
        by_paid_by[e.paid_by or USA] += a
        by_division[e.division or "—"] += a
        if a > 0:
            gross += a
        if (e.paid_by or USA) == USA:
            by_section_usa[e.section] += a
            net_usa += a
    by_section["instructors"] += instructors
    by_section_usa["instructors"] += instructors
    by_paid_by[USA] += instructors
    by_division["USA"] += instructors
    gross += instructors
    net_usa += instructors
    st = _period_state(db, period.id)
    return {
        "period_id": period.id,
        "label": period.label,
        "start_date": period.start_date.isoformat(),
        "entry_count": len(entries),
        "confirmed_count": sum(1 for e in entries if e.confirmed),
        "projection_count": sum(1 for e in entries if e.is_projection),
        "month_confirmed": bool(st and st.confirmed),
        "instructors_source": "instructors section" if instr_rows > 0 else ("bank statements" if instr_ref else "none"),
        "gross": round(gross, 2),
        "net_usa": round(net_usa, 2),
        "by_section": {k: round(v, 2) for k, v in by_section.items()},
        "by_section_usa": {k: round(v, 2) for k, v in by_section_usa.items()},
        "by_division": {k: round(v, 2) for k, v in by_division.items()},
        "by_paid_by": {k: round(v, 2) for k, v in by_paid_by.items()},
    }


def _prev_period(db: Session, period: PayPeriod) -> Optional[PayPeriod]:
    return (db.query(PayPeriod).filter(PayPeriod.start_date < period.start_date)
            .order_by(PayPeriod.start_date.desc()).first())


def _next_month_bounds(d: date):
    first = (d.replace(day=1) + timedelta(days=32)).replace(day=1)
    last = (first + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    return first, last


def _key(e: CostEntry) -> str:
    return f"{e.section}|{(e.name or '').strip().lower()}"


# ---------- reference ----------

@router.get("/meta")
def meta(db: Session = Depends(get_db), user: User = Depends(require_costs_view)):
    builtin = {k for k, _ in SECTIONS}
    return {
        "sections": [{"key": k, "label": v, "custom": k not in builtin}
                     for k, v in _sections(db) if k != "instructors"],
        "statuses": STATUSES,
        "methods": METHODS,
        "divisions": DIVISIONS,
        "paid_by": PAID_BY,
        "priorities": PRIORITIES,
        "can_edit": can_edit_costs(user),
        "is_owner": is_owner(user),
        "ai_enabled": bool(os.getenv("ANTHROPIC_API_KEY")),
    }


@router.get("/periods")
def periods(db: Session = Depends(get_db), _u: User = Depends(require_costs_view)):
    return [_month_totals(db, p) for p in reversed(_periods(db))]


# ---------- entries ----------

@router.get("/entries", response_model=list[CostEntryOut])
def list_entries(period_id: int, section: Optional[str] = None,
                 db: Session = Depends(get_db), _u: User = Depends(require_costs_view)):
    q = db.query(CostEntry).filter(CostEntry.period_id == period_id)
    if section:
        q = q.filter(CostEntry.section == section)
    return q.order_by(CostEntry.section, CostEntry.division, CostEntry.name).all()


@router.post("/entries", response_model=CostEntryOut)
def create_entry(payload: CostEntryCreate, db: Session = Depends(get_db),
                 user: User = Depends(require_costs_edit)):
    if not db.query(PayPeriod.id).filter(PayPeriod.id == payload.period_id).first():
        raise HTTPException(status_code=400, detail="Invalid month")
    _check_editable(db, user, None, payload.period_id)
    _check_section(db, payload.section)
    e = CostEntry(**payload.model_dump(), created_by=user.id, updated_by=user.id)
    if e.status == "Pagado" and not e.paid_date:
        e.paid_date = date.today()
    db.add(e)
    db.flush()
    _log(db, user, "created", e.id, e.period_id, f"{e.name}: {e.amount}")
    db.commit()
    db.refresh(e)
    return e


@router.patch("/entries/{entry_id}", response_model=CostEntryOut)
def update_entry(entry_id: int, payload: CostEntryUpdate, db: Session = Depends(get_db),
                 user: User = Depends(require_costs_edit)):
    e = db.query(CostEntry).filter(CostEntry.id == entry_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="Entry not found")
    _check_editable(db, user, e, e.period_id)
    data = payload.model_dump(exclude_unset=True)
    if "period_id" in data:
        _check_editable(db, user, None, data["period_id"])
    if "section" in data:
        _check_section(db, data["section"])
    changes = []
    for k, v in data.items():
        old = getattr(e, k)
        if str(old) != str(v):
            changes.append(f"{k}: {old} → {v}")
        setattr(e, k, v)
    _apply_paid_rules(e, data)
    if changes:
        e.is_projection = False if ("amount" in data or "status" in data) else e.is_projection
        e.updated_by = user.id
        _log(db, user, "edited", e.id, e.period_id, "; ".join(changes))
    db.commit()
    db.refresh(e)
    return e


@router.delete("/entries/{entry_id}", status_code=204)
def delete_entry(entry_id: int, db: Session = Depends(get_db), user: User = Depends(require_costs_edit)):
    e = db.query(CostEntry).filter(CostEntry.id == entry_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="Entry not found")
    _check_editable(db, user, e, e.period_id)
    _log(db, user, "deleted", e.id, e.period_id, f"{e.name}: {e.amount}")
    db.delete(e)
    db.commit()
    return None


@router.post("/entries/{entry_id}/confirm", response_model=CostEntryOut)
def confirm_entry(entry_id: int, db: Session = Depends(get_db), user: User = Depends(require_owner)):
    e = db.query(CostEntry).filter(CostEntry.id == entry_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="Entry not found")
    e.confirmed, e.confirmed_by, e.confirmed_at = True, user.id, datetime.now(timezone.utc)
    e.is_projection = False
    _log(db, user, "confirmed", e.id, e.period_id)
    db.commit()
    db.refresh(e)
    return e


@router.post("/entries/{entry_id}/unconfirm", response_model=CostEntryOut)
def unconfirm_entry(entry_id: int, db: Session = Depends(get_db), user: User = Depends(require_owner)):
    e = db.query(CostEntry).filter(CostEntry.id == entry_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="Entry not found")
    e.confirmed, e.confirmed_by, e.confirmed_at = False, None, None
    _log(db, user, "unconfirmed", e.id, e.period_id)
    db.commit()
    db.refresh(e)
    return e


# ---------- months ----------

@router.post("/periods/{period_id}/confirm")
def confirm_month(period_id: int, db: Session = Depends(get_db), user: User = Depends(require_owner)):
    now = datetime.now(timezone.utc)
    st = _period_state(db, period_id) or CostPeriodState(period_id=period_id)
    st.confirmed, st.confirmed_by, st.confirmed_at = True, user.id, now
    db.add(st)
    n = 0
    for e in db.query(CostEntry).filter(CostEntry.period_id == period_id).all():
        if not e.confirmed:
            e.confirmed, e.confirmed_by, e.confirmed_at, e.is_projection = True, user.id, now, False
            n += 1
    _log(db, user, "month_confirmed", period_id=period_id, details=f"{n} lines confirmed")
    db.commit()
    return {"confirmed": True, "lines_confirmed": n}


@router.post("/periods/{period_id}/unlock")
def unlock_month(period_id: int, unconfirm_lines: bool = False, db: Session = Depends(get_db),
                 user: User = Depends(require_owner)):
    st = _period_state(db, period_id)
    if st:
        st.confirmed = False
    if unconfirm_lines:
        for e in db.query(CostEntry).filter(CostEntry.period_id == period_id).all():
            e.confirmed, e.confirmed_by, e.confirmed_at = False, None, None
    _log(db, user, "month_unlocked", period_id=period_id)
    db.commit()
    return {"confirmed": False}


@router.post("/periods/{period_id}/copy-forward")
def copy_forward(period_id: int, replace: bool = False, db: Session = Depends(get_db),
                 user: User = Depends(require_costs_edit)):
    """
    Copy a month's lines into the NEXT month as projections (creating that
    month if it doesn't exist). Status resets to Pendiente (or keeps the
    "who pays" status for Iberoamérica/España lines). By default refuses if
    the next month already has lines, so nothing is overwritten by accident.
    """
    src = db.query(PayPeriod).filter(PayPeriod.id == period_id).first()
    if not src:
        raise HTTPException(status_code=404, detail="Month not found")
    first, last = _next_month_bounds(src.start_date)
    tgt = db.query(PayPeriod).filter(PayPeriod.start_date == first).first()
    if not tgt:
        tgt = PayPeriod(label=first.strftime("%B %Y"), start_date=first, end_date=last)
        db.add(tgt)
        db.flush()
    _check_editable(db, user, None, tgt.id)
    existing = db.query(CostEntry).filter(CostEntry.period_id == tgt.id).all()
    if existing and not replace:
        raise HTTPException(status_code=400, detail=f"{tgt.label} already has {len(existing)} lines. "
                                                    "Use replace to overwrite unconfirmed lines.")
    if existing and replace:
        for e in existing:
            if e.confirmed and not is_owner(user):
                raise HTTPException(status_code=400, detail="Some lines in the next month are confirmed")
            db.delete(e)
    n = 0
    for e in db.query(CostEntry).filter(CostEntry.period_id == src.id).all():
        if e.section == "instructors_ref":
            continue
        status = e.status if e.status in ("Iberoamérica paga", "España paga", "Pausado") else "Pendiente"
        due = None
        if e.due_date:
            try:
                due = e.due_date.replace(year=first.year, month=first.month)
            except ValueError:
                due = last
        db.add(CostEntry(due_date=due,
            period_id=tgt.id, section=e.section, division=e.division, department=e.department,
            name=e.name, amount=e.target_amount if e.target_amount is not None else e.amount,
            status=status, method=e.method, frequency=e.frequency, paid_by=e.paid_by,
            priority=e.priority, notes=e.notes, source="projection", is_projection=True,
            target_amount=None, created_by=user.id, updated_by=user.id,
        ))
        n += 1
    _log(db, user, "copied_forward", period_id=tgt.id, details=f"{n} lines from {src.label}")
    db.commit()
    return {"target_period_id": tgt.id, "target_label": tgt.label, "lines": n}


# ---------- analysis ----------

@router.get("/summary")
def summary(db: Session = Depends(get_db), _u: User = Depends(require_costs_view)):
    months = [_month_totals(db, p) for p in _periods(db)]
    months = [m for m in months if m["entry_count"] or m["by_section"].get("instructors")]
    return {"months": months, "section_labels": _section_labels(db)}


@router.get("/compare")
def compare(a: int, b: int, section: Optional[str] = None, db: Session = Depends(get_db),
            _u: User = Depends(require_costs_view)):
    pa = db.query(PayPeriod).filter(PayPeriod.id == a).first()
    pb = db.query(PayPeriod).filter(PayPeriod.id == b).first()
    if not pa or not pb:
        raise HTTPException(status_code=404, detail="Month not found")
    ta, tb = _month_totals(db, pa), _month_totals(db, pb)
    labels = _section_labels(db)
    sections = sorted(set(ta["by_section"]) | set(tb["by_section"]))
    by_section = [{
        "section": s, "label": labels.get(s, s),
        "a": ta["by_section"].get(s, 0.0), "b": tb["by_section"].get(s, 0.0),
        "a_usa": ta["by_section_usa"].get(s, 0.0), "b_usa": tb["by_section_usa"].get(s, 0.0),
    } for s in sections]
    for r in by_section:
        r["delta"] = round(r["b"] - r["a"], 2)
        r["delta_usa"] = round(r["b_usa"] - r["a_usa"], 2)

    def lines(pid):
        q = db.query(CostEntry).filter(CostEntry.period_id == pid, CostEntry.section != "instructors_ref")
        if section:
            q = q.filter(CostEntry.section == section)
        d = defaultdict(lambda: {"amount": 0.0, "paid_by": USA, "division": None, "section": None, "name": None})
        for e in q.all():
            k = _key(e)
            d[k]["amount"] += _f(e.amount)
            d[k].update(paid_by=e.paid_by, division=e.division, section=e.section, name=e.name)
        return d
    la, lb = lines(a), lines(b)
    items = []
    for k in set(la) | set(lb):
        x, y = la.get(k), lb.get(k)
        ref = y or x
        items.append({
            "name": ref["name"], "section": ref["section"], "division": ref["division"], "paid_by": ref["paid_by"],
            "a": round(x["amount"], 2) if x else 0.0, "b": round(y["amount"], 2) if y else 0.0,
            "change": "new" if not x else ("gone" if not y else "same"),
        })
    for i in items:
        i["delta"] = round(i["b"] - i["a"], 2)
    items.sort(key=lambda i: -abs(i["delta"]))
    return {"a": ta, "b": tb, "by_section": by_section, "items": items}


def _adjust_findings(db: Session, period: PayPeriod) -> dict:
    prev = _prev_period(db, period)
    cur_entries = db.query(CostEntry).filter(CostEntry.period_id == period.id,
                                             CostEntry.section != "instructors_ref").all()
    prev_map = defaultdict(float)
    if prev:
        for e in db.query(CostEntry).filter(CostEntry.period_id == prev.id,
                                            CostEntry.section != "instructors_ref").all():
            prev_map[_key(e)] += _f(e.amount)
    cur_map = defaultdict(float)
    ref = {}
    for e in cur_entries:
        cur_map[_key(e)] += _f(e.amount)
        ref[_key(e)] = e

    increases, new_lines, targets, usa_pays_other = [], [], [], []
    for k, amt in cur_map.items():
        e = ref[k]
        before = prev_map.get(k)
        if before is None and amt > 0 and prev:
            new_lines.append({"id": e.id, "name": e.name, "section": e.section, "amount": round(amt, 2)})
        elif before is not None and amt - before >= 200 and (before == 0 or (amt - before) / before >= 0.10):
            increases.append({"id": e.id, "name": e.name, "section": e.section, "before": round(before, 2),
                              "now": round(amt, 2), "delta": round(amt - before, 2)})
    for e in cur_entries:
        if e.target_amount is not None and _f(e.target_amount) < _f(e.amount):
            targets.append({"id": e.id, "name": e.name, "section": e.section, "amount": _f(e.amount),
                            "target": _f(e.target_amount), "saving": round(_f(e.amount) - _f(e.target_amount), 2)})
        if (e.paid_by or USA) == USA and e.division in ("Latam", "Spain") and e.section in ("people", "marketing"):
            usa_pays_other.append({"id": e.id, "name": e.name, "division": e.division,
                                   "section": e.section, "amount": _f(e.amount)})
    top = sorted([e for e in cur_entries if (e.paid_by or USA) == USA and _f(e.amount) > 0],
                 key=lambda e: -_f(e.amount))[:10]
    totals = _month_totals(db, period)
    prev_totals = _month_totals(db, prev) if prev else None
    gone = []
    if prev:
        for k, amt in prev_map.items():
            if k not in cur_map and amt > 0:
                gone.append({"key": k, "amount": round(amt, 2)})
    return {
        "period": {"id": period.id, "label": period.label},
        "previous": {"id": prev.id, "label": prev.label} if prev else None,
        "totals": totals,
        "previous_totals": prev_totals,
        "increases": sorted(increases, key=lambda i: -i["delta"]),
        "new_lines": sorted(new_lines, key=lambda i: -i["amount"]),
        "targets": sorted(targets, key=lambda i: -i["saving"]),
        "planned_saving": round(sum(t["saving"] for t in targets), 2),
        "usa_pays_for_others": sorted(usa_pays_other, key=lambda i: -i["amount"]),
        "top_lines": [{"id": e.id, "name": e.name, "section": e.section, "amount": _f(e.amount)} for e in top],
        "gone_count": len(gone),
    }


@router.get("/adjust")
def adjust(period_id: int, db: Session = Depends(get_db), _u: User = Depends(require_costs_view)):
    p = db.query(PayPeriod).filter(PayPeriod.id == period_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Month not found")
    return _adjust_findings(db, p)


def _rule_insights(f: dict) -> list[dict]:
    out = []
    t = f["totals"]
    pt = f.get("previous_totals")
    if pt:
        d = t["net_usa"] - pt["net_usa"]
        out.append({"title": f"Net USA cost {'up' if d > 0 else 'down'} ${abs(d):,.0f} vs {f['previous']['label']}",
                    "detail": f"${pt['net_usa']:,.0f} → ${t['net_usa']:,.0f}. Biggest section moves are in Compare."})
    for i in f["increases"][:5]:
        out.append({"title": f"{i['name']}: +${i['delta']:,.0f}",
                    "detail": f"Was ${i['before']:,.0f}, now ${i['now']:,.0f}. Check whether the extra is one-off "
                              "or should go back to the previous level."})
    for n in f["new_lines"][:3]:
        out.append({"title": f"New this month: {n['name']} (${n['amount']:,.0f})",
                    "detail": "Confirm it's needed every month or mark it as a one-off."})
    for u in f["usa_pays_for_others"][:4]:
        out.append({"title": f"{u['name']} is {u['division']} but paid by 4Geeks USA",
                    "detail": f"${u['amount']:,.0f}. If the work is for {u['division']}, move it to Iberoamérica/España "
                              "or invoice it back."})
    sec = t["by_section_usa"]
    if sec.get("tech", 0) > 4000:
        out.append({"title": f"Tech & apps at ${sec['tech']:,.0f}/month",
                    "detail": "Look for duplicates (two dialers, two Notion bills) and hosting that can move to Railway."})
    if sec.get("debt", 0) > 0 and t["net_usa"] > 0:
        share = sec["debt"] / t["net_usa"] * 100
        out.append({"title": f"Debt is {share:.0f}% of net USA cost (${sec['debt']:,.0f})",
                    "detail": "Pause family loans in tight months; avoid new weekly-debit financing."})
    if f["planned_saving"]:
        out.append({"title": f"Planned savings entered: ${f['planned_saving']:,.0f}/month",
                    "detail": "From the target amounts set on lines below. Copy the month forward to apply them."})
    return out


def _save_insight(db, user, result, period_id=None, entry=None):
    db.add(InsightLog(period_id=period_id if entry is None else entry.period_id,
                      entry_id=entry.id if entry else None, entry_name=entry.name if entry else None,
                      scope="line" if entry else "month", source=result.get("source", "rules"),
                      items=json.dumps(result.get("items", [])), user_id=user.id))
    db.commit()


@router.post("/insights")
def insights(period_id: int, db: Session = Depends(get_db), user: User = Depends(require_costs_view)):
    result = _month_insight(period_id, db)
    _save_insight(db, user, result, period_id=period_id)
    return result


@router.get("/insights/history")
def insight_history(period_id: Optional[int] = None, entry_id: Optional[int] = None, entry_name: Optional[str] = None,
                    limit: int = 30, db: Session = Depends(get_db), _u: User = Depends(require_costs_view)):
    q = db.query(InsightLog)
    if entry_name:
        q = q.filter(InsightLog.entry_name == entry_name)
    elif entry_id:
        q = q.filter(InsightLog.entry_id == entry_id)
    else:
        q = q.filter(InsightLog.scope == "month")
        if period_id:
            q = q.filter(InsightLog.period_id == period_id)
    labels = {p.id: p.label for p in db.query(PayPeriod).all()}
    return [{"id": r.id, "scope": r.scope, "source": r.source, "period": labels.get(r.period_id),
             "period_id": r.period_id, "entry_name": r.entry_name, "user": r.user.name if r.user else None,
             "at": r.created_at.isoformat() if r.created_at else None, "items": json.loads(r.items or "[]")}
            for r in q.order_by(InsightLog.created_at.desc()).limit(min(limit, 100)).all()]


def _month_insight(period_id: int, db: Session):
    p = db.query(PayPeriod).filter(PayPeriod.id == period_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Month not found")
    f = _adjust_findings(db, p)
    rules = _rule_insights(f)
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return {"source": "rules", "items": rules}
    lines = db.query(CostEntry).filter(CostEntry.period_id == p.id, CostEntry.section != "instructors_ref").all()
    compact = [{"section": e.section, "division": e.division, "role": e.department, "name": e.name,
                "amount": _f(e.amount), "paid_by": e.paid_by, "status": e.status} for e in lines]
    prompt = (
        "You are the CFO advisor of 4Geeks Academy USA, a coding/AI school with tight cash. "
        "Below are this month's cost lines and the comparison with the previous month. "
        "Give 5-8 concrete, numbered recommendations to lower or improve costs without hurting enrollments "
        "or active cohorts. Each: a short title with the $ impact per month, then one or two sentences. "
        "Be specific to the lines (names, amounts). Answer in English. Return JSON: "
        '{"items":[{"title":"...","detail":"..."}]}\n\n'
        f"MONTH: {p.label}\nTOTALS: {json.dumps(f['totals'])}\n"
        f"PREVIOUS: {json.dumps(f.get('previous_totals'))}\n"
        f"INCREASES: {json.dumps(f['increases'][:15])}\nNEW: {json.dumps(f['new_lines'][:15])}\n"
        f"LINES: {json.dumps(compact)[:24000]}"
    )
    body = json.dumps({
        "model": os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
        "max_tokens": 1500,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body, headers={
        "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
        text = "".join(c.get("text", "") for c in data.get("content", []))
        start, end = text.find("{"), text.rfind("}")
        items = json.loads(text[start:end + 1]).get("items", [])
        if items:
            return {"source": "ai", "items": items, "rules": rules}
    except Exception as exc:  # noqa: BLE001 -- fall back to rules, never break the page
        return {"source": "rules", "items": rules, "error": f"AI unavailable: {exc.__class__.__name__}"}
    return {"source": "rules", "items": rules}


@router.get("/log")
def activity(period_id: Optional[int] = None, db: Session = Depends(get_db), _u: User = Depends(require_costs_view)):
    q = db.query(CostLog)
    if period_id:
        q = q.filter(CostLog.period_id == period_id)
    rows = q.order_by(CostLog.id.desc()).limit(100).all()
    return [{"id": r.id, "action": r.action, "details": r.details, "entry_id": r.entry_id,
             "user": r.user.name if r.user else None,
             "at": r.created_at.isoformat() if r.created_at else None} for r in rows]


# ---------- Loans segment ----------

from app.models.models import Loan  # noqa: E402
from app.schemas.schemas import LoanBase, LoanOut, LoanUpdate  # noqa: E402

LOAN_KINDS = ["MCA / revenue-based", "Family", "Founder", "Private", "Tax plan", "Credit card", "Other"]


def _loan_due_dates(loan: Loan, start: date, end: date) -> list[date]:
    """Dates in [start, end] when this loan is debited, from its schedule."""
    if loan.status != "Active" or _f(loan.payment) <= 0:
        return []
    first = loan.start_date or start
    last = loan.end_date or end
    lo, hi = max(start, first), min(end, last)
    if lo > hi:
        return []
    out = []
    if loan.frequency == "weekly":
        d = first
        if d < lo:
            d = d + timedelta(days=((lo - d).days + 6) // 7 * 7)
        while d <= hi:
            out.append(d)
            d += timedelta(days=7)
    else:
        try:
            day = int(loan.payment_day or first.day)
        except ValueError:
            day = first.day
        y, m = lo.year, lo.month
        while True:
            try:
                d = date(y, m, min(day, 28) if day > 28 else day)
            except ValueError:
                d = date(y, m, 28)
            if d > hi:
                break
            if d >= lo:
                out.append(d)
            m += 1
            if m > 12:
                y, m = y + 1, 1
    return out


@router.get("/loans", response_model=list[LoanOut])
def list_loans(db: Session = Depends(get_db), _u: User = Depends(require_costs_view)):
    return db.query(Loan).order_by(Loan.status, Loan.name).all()


@router.post("/loans", response_model=LoanOut)
def create_loan(payload: LoanBase, db: Session = Depends(get_db), user: User = Depends(require_costs_edit)):
    loan = Loan(**payload.model_dump(), updated_by=user.id)
    db.add(loan)
    db.flush()
    _log(db, user, "loan_created", details=f"{loan.name}: {loan.payment}/{loan.frequency}")
    db.commit()
    db.refresh(loan)
    return loan


@router.patch("/loans/{loan_id}", response_model=LoanOut)
def update_loan(loan_id: int, payload: LoanUpdate, db: Session = Depends(get_db),
                user: User = Depends(require_costs_edit)):
    loan = db.query(Loan).filter(Loan.id == loan_id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    changes = []
    for k, v in payload.model_dump(exclude_unset=True).items():
        if str(getattr(loan, k)) != str(v):
            changes.append(f"{k}: {getattr(loan, k)} → {v}")
        setattr(loan, k, v)
    loan.updated_by = user.id
    if changes:
        _log(db, user, "loan_edited", details=f"{loan.name}: " + "; ".join(changes))
    db.commit()
    db.refresh(loan)
    return loan


@router.delete("/loans/{loan_id}", status_code=204)
def delete_loan(loan_id: int, db: Session = Depends(get_db), user: User = Depends(require_costs_edit)):
    loan = db.query(Loan).filter(Loan.id == loan_id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    _log(db, user, "loan_deleted", details=loan.name)
    db.delete(loan)
    db.commit()
    return None


@router.get("/loans/schedule")
def loan_schedule(weeks: int = 16, start: Optional[date] = None, until: Optional[date] = None,
                  group: str = "week", db: Session = Depends(get_db), _u: User = Depends(require_costs_view)):
    """
    Debit calendar for every loan: per week (Monday-start) or per month.
    `until` overrides `weeks` (e.g. until=2027-12-31).
    """
    today = start or date.today()
    monday = today - timedelta(days=today.weekday())
    if until:
        weeks = max(1, ((until - monday).days // 7) + 1)
    weeks = min(weeks, 130)
    end = until or (monday + timedelta(days=7 * weeks - 1))
    if group == "month":
        b0 = today.replace(day=1)
        buckets = []
        d = b0
        while d <= end:
            buckets.append(d)
            d = (d + timedelta(days=32)).replace(day=1)
        idx = lambda x: (x.year - b0.year) * 12 + x.month - b0.month  # noqa: E731
        win_start = today
    else:
        buckets = [monday + timedelta(days=7 * i) for i in range(weeks)]
        idx = lambda x: (x - monday).days // 7  # noqa: E731
        win_start = monday
    n = len(buckets)
    loans = db.query(Loan).all()
    rows = []
    totals = [0.0] * n
    for loan in loans:
        cells = [0.0] * n
        last_due = None
        for d in _loan_due_dates(loan, win_start, end):
            i = idx(d)
            if 0 <= i < n:
                cells[i] += _f(loan.payment)
                last_due = d
        for i, v in enumerate(cells):
            totals[i] += v
        per_month = _f(loan.payment) * (52 / 12 if loan.frequency == "weekly" else 1) if loan.status == "Active" else 0
        rows.append({"id": loan.id, "name": loan.name, "kind": loan.kind, "frequency": loan.frequency,
                     "payment": _f(loan.payment), "per_month": round(per_month, 2), "status": loan.status,
                     "end_date": loan.end_date.isoformat() if loan.end_date else None,
                     "last_in_window": last_due.isoformat() if last_due else None,
                     "cells": [round(v, 2) for v in cells], "total": round(sum(cells), 2)})
    rows.sort(key=lambda r: -r["total"])
    active = [r for r in rows if r["status"] == "Active"]
    span_weeks = max(((end - win_start).days + 1) / 7, 1)
    return {
        "group": group,
        "weeks": [w.isoformat() for w in buckets],   # bucket starts (weeks or months)
        "until": end.isoformat(),
        "rows": rows,
        "totals": [round(v, 2) for v in totals],
        "window_total": round(sum(totals), 2),
        "per_month_total": round(sum(r["per_month"] for r in active), 2),
        "per_week_avg": round(sum(totals) / span_weeks, 2),
        "ending_in_window": [r for r in active if r["end_date"] and r["end_date"] <= end.isoformat()],
        "kinds": LOAN_KINDS,
    }


# ---------- Line-level advice ("how do I lower this one?") ----------

def _ask_claude(prompt: str, max_tokens: int = 900):
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return None
    body = json.dumps({"model": os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5"), "max_tokens": max_tokens,
                       "messages": [{"role": "user", "content": prompt}]}).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body, headers={
        "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
        text = "".join(c.get("text", "") for c in data.get("content", []))
        s, e = text.find("{"), text.rfind("}")
        return json.loads(text[s:e + 1]).get("items") or None
    except Exception:  # noqa: BLE001
        return None


_LINE_TIPS = {
    "marketing": "Cap spend to a CPL/CAC target; move budget from the worst campaign to the best; pause low-intent keywords.",
    "tech": "Check seats vs. active users; switch to annual only if cash allows; cancel duplicate tools.",
    "operations": "Ask for a quote from a second vendor; review whether the service is still used.",
    "people": "Agree a fixed monthly scope; cap hours; check whether Spain/LATAM should pay their share.",
    "debt": "Never stack new weekly-debit financing; ask for a pause or a lower payment in tight months.",
    "founders": "Defer part of the draw in tight months and book it as owed.",
    "payroll_w2": "Review hours and roles before the next payroll run.",
}


@router.post("/entries/{entry_id}/insight")
def line_insight(entry_id: int, db: Session = Depends(get_db), user: User = Depends(require_costs_view)):
    result = _line_insight(entry_id, db)
    e = db.query(CostEntry).filter(CostEntry.id == entry_id).first()
    _save_insight(db, user, result, entry=e)
    return result


def _line_insight(entry_id: int, db: Session):
    e = db.query(CostEntry).filter(CostEntry.id == entry_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="Line not found")
    hist_rows = (db.query(CostEntry, PayPeriod).join(PayPeriod, PayPeriod.id == CostEntry.period_id)
                 .filter(CostEntry.name == e.name).order_by(PayPeriod.start_date).all())
    history = [{"month": p.label, "amount": _f(x.amount), "current": x.id == e.id} for x, p in hist_rows]
    earlier = [_f(x.amount) for x, p in hist_rows if p.start_date < e.period.start_date and _f(x.amount)]
    rules = []
    if earlier:
        avg = sum(earlier) / len(earlier)
        cur = _f(e.amount)
        if avg and cur > avg * 1.1:
            rules.append({"title": f"Above its average by ${cur - avg:,.0f}",
                          "detail": f"Average of earlier months is ${avg:,.0f}; this month ${cur:,.0f}. "
                                    "Confirm whether the extra is a one-off."})
    if e.division in ("Latam", "Spain") and e.paid_by == "4Geeks USA":
        rules.append({"title": "USA is paying a Latam/Spain cost",
                      "detail": "Charge it back to the region or move it to the region's own payments."})
    rules.append({"title": "Typical levers", "detail": _LINE_TIPS.get(e.section, "Ask for a lower price, a pause or a smaller scope.")})
    prompt = (
        "You advise 4Geeks Academy USA (coding/AI school, tight cash) on one cost line. "
        "Give 3-4 concrete ways to lower, fix or improve this specific cost, each with an estimated $/month impact "
        "and the trade-off. Return JSON {\"items\":[{\"title\":\"...\",\"detail\":\"...\"}]}.\n"
        f"LINE: {json.dumps({'name': e.name, 'section': e.section, 'role': e.department, 'division': e.division, 'amount': _f(e.amount), 'paid_by': e.paid_by, 'method': e.method, 'frequency': e.frequency, 'notes': e.notes})}\n"
        f"HISTORY: {json.dumps(history)}"
    )
    items = _ask_claude(prompt)
    return {"source": "ai" if items else "rules", "items": items or rules, "history": history}


# ---------- categories + bulk ----------

@router.post("/categories")
def create_category(payload: CostCategoryCreate, db: Session = Depends(get_db),
                    user: User = Depends(require_costs_edit)):
    import re as _re
    label = payload.label.strip()
    if any(l.lower() == label.lower() for _, l in _sections(db)):
        raise HTTPException(status_code=400, detail="That category already exists")
    base = "c_" + (_re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:30] or "cat")
    key, n = base, 2
    while db.query(CostCategory).filter(CostCategory.key == key).first():
        key, n = f"{base}_{n}", n + 1
    db.add(CostCategory(key=key, label=label, created_by=user.id))
    _log(db, user, "category_created", details=label)
    db.commit()
    return {"key": key, "label": label, "custom": True}


@router.patch("/categories/{key}")
def rename_category(key: str, payload: CostCategoryCreate, db: Session = Depends(get_db),
                    user: User = Depends(require_costs_edit)):
    c = db.query(CostCategory).filter(CostCategory.key == key).first()
    if not c:
        raise HTTPException(status_code=404, detail="Only categories created in the app can be renamed")
    _log(db, user, "category_renamed", details=f"{c.label} → {payload.label.strip()}")
    c.label = payload.label.strip()
    db.commit()
    return {"key": c.key, "label": c.label, "custom": True}


@router.post("/entries/bulk")
def bulk_update(payload: CostBulkUpdate, db: Session = Depends(get_db), user: User = Depends(require_costs_edit)):
    if not payload.ids:
        return {"updated": 0}
    if payload.section:
        _check_section(db, payload.section)
    entries = db.query(CostEntry).filter(CostEntry.id.in_(payload.ids)).all()
    for e in entries:
        _check_editable(db, user, e, e.period_id)
    today = date.today()
    for e in entries:
        changes = []
        if payload.section and e.section != payload.section:
            changes.append(f"section: {e.section} → {payload.section}")
            e.section = payload.section
        if payload.paid_by and e.paid_by != payload.paid_by:
            changes.append(f"paid_by: {e.paid_by} → {payload.paid_by}")
            e.paid_by = payload.paid_by
        if payload.paid is True and e.status != "Pagado":
            changes.append(f"status: {e.status} → Pagado")
            e.status, e.paid_date = "Pagado", e.paid_date or today
        elif payload.paid is False and e.status == "Pagado":
            changes.append("status: Pagado → Pendiente")
            e.status, e.paid_date = "Pendiente", None
        elif payload.status and e.status != payload.status:
            changes.append(f"status: {e.status} → {payload.status}")
            _apply_paid_rules(e, {"status": payload.status})
            e.status = payload.status
        if changes:
            e.updated_by = user.id
            e.is_projection = False
            _log(db, user, "edited", e.id, e.period_id, "; ".join(changes) + " (bulk)")
    db.commit()
    return {"updated": len(entries)}


@router.get("/entries/{entry_id}/history")
def line_history(entry_id: int, db: Session = Depends(get_db), _u: User = Depends(require_costs_view)):
    """Amount of this line (same name) in every month."""
    e = db.query(CostEntry).filter(CostEntry.id == entry_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="Line not found")
    rows = (db.query(CostEntry, PayPeriod).join(PayPeriod, PayPeriod.id == CostEntry.period_id)
            .filter(CostEntry.name == e.name).order_by(PayPeriod.start_date).all())
    return [{"month": p.label, "amount": _f(x.amount), "current": x.id == e.id} for x, p in rows]
