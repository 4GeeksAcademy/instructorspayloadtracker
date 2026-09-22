"""
Single source of truth for suggesting a WorkCategory from a free-text
work_reference. Used by the assignments router (to suggest a value when one
isn't given) and by seed.py (to classify the August import) -- previously
this logic was duplicated between a one-off script and the app, and the
duplication silently drifted (one copy missed the " All " mid-string case
and misclassified a row). Keeping it in one importable function means that
class of bug can't recur.
"""
from app.models.models import WorkCategory


def suggest_work_category(work_reference: str) -> WorkCategory:
    wr = work_reference.strip().lower()
    if wr.endswith("all") or " all " in f" {wr} ":
        return WorkCategory.mentorship_private
    if "extra hours" in wr or "meetings" in wr or "admin" in wr:
        return WorkCategory.overhead_admin
    return WorkCategory.cohort_class
