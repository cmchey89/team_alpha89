// app/api/payments/webhook/route.ts
//
// This is the single most security-critical route in the system: it's what
// actually flips a work zone from "affected_unpaid" to "affected_paid" and
// unlocks the drawing. If this route trusted an unverified request, anyone
// could POST a fake "payment succeeded" body and get the drawing for free.
//
// Rules followed here:
//   1. Read the RAW body before any JSON parsing, since signature
//      verification must hash the exact bytes FOMO Pay sent — re-serializing
//      a parsed object will not produce byte-identical output and the
//      signature check will fail (or worse, a naive implementation might
//      skip verification "to make it work", which is the actual exploit).
//   2. Verify the signature BEFORE touching the database at all.
//   3. Only mark paid if status indicates success — never assume.

export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { payments, workZones } from '@/lib/db/schema';
import { verifyFomoPayWebhookSignature, parseFomoPayWebhook } from '@/lib/payments/fomoPay';

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // TODO: confirm the exact header name FOMO Pay uses for the signature —
  // this guesses `x-fomopay-signature`, a common convention, but check
  // their webhook doc for the real header name.
  const signatureHeader = req.headers.get('x-fomopay-signature');

  let verified: boolean;
  try {
    verified = verifyFomoPayWebhookSignature(rawBody, signatureHeader);
  } catch (err) {
    console.error('[fomo webhook] signature verification threw:', err);
    return NextResponse.json({ error: 'Webhook verification not configured.' }, { status: 500 });
  }

  if (!verified) {
    console.warn('[fomo webhook] signature verification FAILED — rejecting webhook.');
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
  }

  const payload = parseFomoPayWebhook(rawBody);

  const paymentRows = await db
    .select()
    .from(payments)
    .where(eq(payments.providerPaymentId, payload.payment_id))
    .limit(1);
  const payment = paymentRows[0];

  if (!payment) {
    console.warn('[fomo webhook] received webhook for unknown payment_id:', payload.payment_id);
    // Return 200 anyway — returning an error here just causes the gateway to
    // retry a webhook we will never recognize. Log it for investigation instead.
    return NextResponse.json({ ok: true });
  }

  // Idempotency: payment gateways retry webhooks. If we've already recorded
  // this payment as succeeded, do nothing further rather than double-processing.
  if (payment.status === 'succeeded') {
    return NextResponse.json({ ok: true, alreadyProcessed: true });
  }

  if (payload.status === 'succeeded') {
    await db
      .update(payments)
      .set({ status: 'succeeded', confirmedAt: new Date(), rawWebhookPayload: payload })
      .where(eq(payments.id, payment.id));

    await db
      .update(workZones)
      .set({ status: 'affected_paid', paid: true })
      .where(eq(workZones.id, payment.workZoneId));
  } else {
    await db
      .update(payments)
      .set({ status: 'failed', rawWebhookPayload: payload })
      .where(eq(payments.id, payment.id));
  }

  return NextResponse.json({ ok: true });
}
