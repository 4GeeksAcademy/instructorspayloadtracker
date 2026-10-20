// The Costs Hub can create future months (copy-forward), so "newest period"
// is no longer "current period". Default to the latest month that has started.
export function currentPeriod(list) {
  if (!list?.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  return list.find((p) => p.start_date <= today) || list[list.length - 1];
}
