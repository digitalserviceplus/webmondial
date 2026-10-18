export function hasBeenOnPlatformForMoreThanThreeMonths(createdAt: Date, now = new Date()) {
  const cutoff = new Date(now);
  const dayOfMonth = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 3);
  const lastDayOfCutoffMonth = new Date(
    Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0),
  ).getUTCDate();
  cutoff.setUTCDate(Math.min(dayOfMonth, lastDayOfCutoffMonth));
  return createdAt.getTime() < cutoff.getTime();
}
