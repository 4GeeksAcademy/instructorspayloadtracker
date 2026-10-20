// Access helpers shared by the nav and the routes. Mirrors backend/app/core/deps.py.
export const isOwner = (u) => u?.role === "owner";
export const canInstructors = (u) => isOwner(u) || !!u?.view_all || u?.instructors_access !== false;
export const canCosts = (u) => isOwner(u) || !!u?.view_all || ["viewer", "editor"].includes(u?.costs_access);
export const canEditCosts = (u) => isOwner(u) || u?.costs_access === "editor";
