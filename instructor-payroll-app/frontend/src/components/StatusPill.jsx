const LABELS = {
  draft: "Draft",
  submitted: "Waiting approval",
  admin_reviewed: "Waiting approval",
  approved: "Approved — to pay",
  registered: "Registered — to pay",
  paid: "Paid",
  rejected: "Rejected",
};

export default function StatusPill({ status }) {
  return <span className={`pill ${status}`}>{LABELS[status] || status}</span>;
}
