import { Suspense } from "react";
import PaymentReturnStatus from "./payment-return-status";

export default function PaymentReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ paymentId?: string; returnTo?: string }>;
}) {
  return (
    <Suspense fallback={<main className="page-loading">Chargement…</main>}>
      <PaymentReturnContent searchParams={searchParams} />
    </Suspense>
  );
}

async function PaymentReturnContent({
  searchParams,
}: {
  searchParams: Promise<{ paymentId?: string; returnTo?: string }>;
}) {
  const { paymentId = "", returnTo = "" } = await searchParams;
  const safeReturnTo = /^\/(?:dashboard(?:\?tab=subscription)?|[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)$/i.test(returnTo)
    ? returnTo
    : "/dashboard";
  return <PaymentReturnStatus paymentId={paymentId} returnTo={safeReturnTo} />;
}
