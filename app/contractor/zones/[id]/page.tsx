// app/contractor/zones/[id]/page.tsx
//
// Landing page after a contractor returns from FOMO Pay's hosted checkout
// (see successRedirectUrl / failureRedirectUrl in
// app/api/payments/create/route.ts). This page does NOT trust the `paid=1`
// query param for anything except showing an optimistic "checking
// payment..." message — the actual unlock is enforced server-side by
// /api/zones/[id]/release, which only returns conflict details if the DB
// row's status is 'affected_paid' (set exclusively by the verified webhook).

'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface ConflictDetail {
  infraLineId: string;
  utilityType: string;
  label: string | null;
}

interface ReleaseResponse {
  cleared: boolean;
  reference?: string;
  conflicts: ConflictDetail[];
}

export default function ZoneDetailPage({ params }: { params: { id: string } }) {
  const searchParams = useSearchParams();
  const justReturnedFromPayment = searchParams.get('paid') === '1';

  const [status, setStatus] = useState<'loading' | 'ready' | 'pending_payment' | 'error'>('loading');
  const [data, setData] = useState<ReleaseResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function fetchRelease() {
      try {
        const res = await fetch(`/api/zones/${params.id}/release`);
        if (res.status === 402) {
          // Not paid yet according to our DB. If we just came back from
          // FOMO Pay's checkout, the webhook may simply not have arrived
          // yet — poll a few times before giving up, since webhook
          // delivery is asynchronous and can lag the redirect by a second
          // or two.
          if (cancelled) return;
          if (justReturnedFromPayment && pollCount < 8) {
            setStatus('pending_payment');
            setTimeout(() => setPollCount((c) => c + 1), 1500);
          } else {
            setStatus('pending_payment');
          }
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to load (${res.status})`);
        }
        const json: ReleaseResponse = await res.json();
        if (cancelled) return;
        setData(json);
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setErrorMsg(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    }

    fetchRelease();
    return () => {
      cancelled = true;
    };
    // pollCount intentionally drives the retry; params.id/justReturnedFromPayment are stable per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollCount]);

  if (status === 'loading') return <main className="zone-detail">Loading…</main>;

  if (status === 'pending_payment') {
    return (
      <main className="zone-detail">
        <h1>Confirming payment…</h1>
        <p>
          We're waiting for payment confirmation from FOMO Pay. This page will update automatically —
          it usually takes a few seconds. If this doesn't resolve, contact support with reference{' '}
          <code>{params.id}</code>.
        </p>
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main className="zone-detail">
        <h1>Something went wrong</h1>
        <p>{errorMsg}</p>
      </main>
    );
  }

  if (data?.cleared) {
    return (
      <main className="zone-detail">
        <h1>CLEAR</h1>
        <p>No payment was required for this zone.</p>
      </main>
    );
  }

  return (
    <main className="zone-detail">
      <h1>AFFECTED — drawing released</h1>
      <p>Reference: {data?.reference}</p>
      <ul>
        {data?.conflicts.map((c) => (
          <li key={c.infraLineId}>
            {c.label ?? c.utilityType} ({c.utilityType})
          </li>
        ))}
      </ul>
      {/* PDF/GeoJSON download buttons would call the same export logic as
          the prototype here — omitted in this scaffold for brevity, but the
          data needed (conflicts[].geom, via the release endpoint) is
          already available to build them the same way as
          buildDrawingSheetPDF() in the artifact prototype. */}
    </main>
  );
}
