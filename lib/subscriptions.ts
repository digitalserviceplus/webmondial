export function calculateSubscription(monthlyPrice: number, paidMonths: number, currency = "XOF") {
  if (!Number.isSafeInteger(monthlyPrice) || monthlyPrice < 0) {
    throw new Error("Monthly subscription price must be a non-negative integer.");
  }
  if (!Number.isSafeInteger(paidMonths) || paidMonths < 1 || paidMonths > 36) {
    throw new Error("Choose between 1 and 36 paid months.");
  }

  const bonusDays = paidMonths === 1 ? 7 : 0;
  const bonusMonths = paidMonths >= 2 ? 1 : 0;
  return {
    amount: monthlyPrice * paidMonths,
    currency,
    paidMonths,
    bonusDays,
    bonusMonths,
    totalMonths: paidMonths + bonusMonths,
  };
}

export const PARTNER_TRIAL_DAYS = 7;

export function getPartnerTrialEndDate(startedAt: Date) {
  return new Date(startedAt.getTime() + PARTNER_TRIAL_DAYS * 24 * 60 * 60_000);
}

export function canPublishContent(
  subscription: { status: string; currentPeriodEnd: Date; trialEndsAt?: Date | null } | null,
  now = new Date(),
) {
  if (!subscription) return false;
  if (subscription.status === "ACTIVE") return subscription.currentPeriodEnd > now;
  return subscription.status === "TRIAL" && Boolean(subscription.trialEndsAt && subscription.trialEndsAt > now);
}

export function annualSubscriptionCutoff(now = new Date()) {
  const cutoff = new Date(now);
  const day = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 13);
  const lastDay = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate();
  cutoff.setUTCDate(Math.min(day, lastDay));
  return cutoff;
}

export function canPublishPaidContent(
  subscription: { status: string; currentPeriodEnd: Date } | null,
  annualPaymentProcessedAt: Date | null,
  now = new Date(),
) {
  return Boolean(
    subscription?.status === "ACTIVE" &&
    subscription.currentPeriodEnd > now &&
    annualPaymentProcessedAt &&
    annualPaymentProcessedAt >= annualSubscriptionCutoff(now),
  );
}
