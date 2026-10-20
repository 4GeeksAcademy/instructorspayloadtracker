export const money = (v, opts = {}) => {
  const n = Number(v || 0);
  const s = Math.abs(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: opts.cents ? 2 : 0,
    minimumFractionDigits: opts.cents ? 2 : 0,
  });
  return n < 0 ? `−${s}` : s;
};

export const kmoney = (v) => {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1000) return `${n < 0 ? "−" : ""}$${(Math.abs(n) / 1000).toFixed(Math.abs(n) >= 100000 ? 0 : 1)}k`;
  return money(n);
};

export const signed = (v) => {
  const n = Number(v || 0);
  if (Math.abs(n) < 0.5) return "$0";
  return `${n > 0 ? "+" : "−"}${money(Math.abs(n))}`;
};

export const pct = (a, b) => (a ? ((b - a) / Math.abs(a)) * 100 : null);

export const shortMonth = (label = "") => {
  const [m, y] = label.split(" ");
  return `${(m || "").slice(0, 3)} ${y ? y.slice(2) : ""}`.trim();
};

// Section display order across the Costs Hub.
export const SECTION_ORDER = [
  "people", "instructors", "payroll_w2", "founders", "marketing", "tech",
  "operations", "debt", "taxes", "reimbursement", "other",
];

export const STATUS_TONE = {
  Pagado: "paid",
  "Por pagar": "submitted",
  Pendiente: "draft",
  "Iberoamérica paga": "admin_reviewed",
  "España paga": "admin_reviewed",
  "Aprobar en Wise": "submitted",
  Pausado: "rejected",
};

export function downloadCsv(filename, rows) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
