const LABELS = {
  draft: "Draft",
  submitted: "Submitted",
  admin_reviewed: "Admin reviewed",
  approved: "Approved",
  registered: "Registered",
  paid: "Paid",
  rejected: "Rejected",
};

export default function StatusPill({ status }) {
  return <span className={`pill ${status}`}>{LABELS[status] || status}</span>;
}
