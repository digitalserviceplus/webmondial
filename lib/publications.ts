export function isEffectivelyPaid(
  visibility: string,
  price: number | { toNumber(): number } | null | undefined,
) {
  const amount = typeof price === "number" ? price : price?.toNumber();
  return visibility === "PAID" && typeof amount === "number" && amount > 0;
}

export function canAccessPublication({
  visibility,
  price,
  isOwner,
  isMember,
  hasPurchase,
}: {
  visibility: string;
  price: number | { toNumber(): number } | null | undefined;
  isOwner: boolean;
  isMember: boolean;
  hasPurchase: boolean;
}) {
  if (isOwner || visibility === "PUBLIC") return true;
  if (isEffectivelyPaid(visibility, price)) return hasPurchase;
  if (visibility === "PAID") return true;
  return visibility === "TENANT_PLAYERS" && isMember;
}
