// lib/payments/fomoPay.ts
//
// =============================================================================
// IMPORTANT — READ BEFORE USING IN PRODUCTION
// =============================================================================
// FOMO Pay's actual Web Payment API spec is only available as a PDF/doc you
// download directly from their developer portal after signing up as a
// merchant (https://developers.fomopay.com). I was not able to access that
// document from this environment, so the request/response shapes below are
// a best-effort, standard-payment-gateway-shaped INTERFACE — not a verified
// integration. Every place marked "// TODO: confirm" needs to be checked
// against the real FOMO Pay doc (or their sandbox) before this goes live.
//
// What IS solid here, regardless of the exact field names:
//   - The overall flow (create a payment intent server-side -> redirect or
//     embed their checkout -> receive a signed webhook on completion ->
//     verify the signature -> mark the order paid) is how essentially every
//     payment gateway works, FOMO Pay included.
//   - The webhook signature verification pattern (HMAC over the raw body)
//     is the standard approach; FOMO Pay's docs will specify which header
//     carries the signature and which hashing algorithm/secret to use.
// =============================================================================

import { createHmac, timingSafeEqual } from 'crypto';

const FOMO_PAY_API_BASE = process.env.FOMO_PAY_API_BASE || 'https://api.fomopay.com'; // TODO: confirm real base URL
const FOMO_PAY_MERCHANT_ID = process.env.FOMO_PAY_MERCHANT_ID;
const FOMO_PAY_API_KEY = process.env.FOMO_PAY_API_KEY;
const FOMO_PAY_WEBHOOK_SECRET = process.env.FOMO_PAY_WEBHOOK_SECRET;

export interface CreatePaymentParams {
  amountCents: number;
  currency: string; // 'SGD'
  reference: string; // our internal work zone reference, e.g. "DC-48213"
  description: string;
  successRedirectUrl: string;
  failureRedirectUrl: string;
}

export interface CreatePaymentResult {
  providerPaymentId: string;
  checkoutUrl: string; // where to redirect the contractor to pay
}

export async function createFomoPayPayment(
  params: CreatePaymentParams
): Promise<CreatePaymentResult> {
  if (!FOMO_PAY_MERCHANT_ID || !FOMO_PAY_API_KEY) {
    throw new Error(
      'FOMO_PAY_MERCHANT_ID / FOMO_PAY_API_KEY are not set. See .env.example.'
    );
  }

  // TODO: confirm against FOMO Pay's Web Payment API doc:
  //  - exact endpoint path (this guesses /v1/payments)
  //  - exact auth scheme (Bearer token? Basic auth? signed request?)
  //  - exact field names for amount (cents vs dollars), currency, reference
  const res = await fetch(`${FOMO_PAY_API_BASE}/v1/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${FOMO_PAY_API_KEY}`,
    },
    body: JSON.stringify({
      merchant_id: FOMO_PAY_MERCHANT_ID,
      amount: params.amountCents,
      currency: params.currency,
      order_id: params.reference,
      description: params.description,
      return_url: params.successRedirectUrl,
      cancel_url: params.failureRedirectUrl,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`FOMO Pay payment creation failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  // TODO: confirm actual response field names — guessing snake_case here.
  return {
    providerPaymentId: data.payment_id,
    checkoutUrl: data.checkout_url,
  };
}

/**
 * Verifies an incoming webhook's signature before trusting its payload.
 * NEVER mark a payment as paid based on a webhook you haven't verified —
 * an unverified webhook endpoint is a direct "get the drawing for free"
 * exploit against this system.
 */
export function verifyFomoPayWebhookSignature(
  rawBody: string,
  signatureHeader: string | null
): boolean {
  if (!FOMO_PAY_WEBHOOK_SECRET) {
    throw new Error('FOMO_PAY_WEBHOOK_SECRET is not set. See .env.example.');
  }
  if (!signatureHeader) return false;

  // TODO: confirm against FOMO Pay's doc — this assumes HMAC-SHA256 over the
  // raw request body, which is the most common pattern, but confirm the
  // exact algorithm and whether it signs the raw body or a constructed
  // string (some gateways sign `timestamp.body` instead of body alone).
  const expected = createHmac('sha256', FOMO_PAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  // Constant-time comparison to avoid timing attacks on the signature check.
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface FomoPayWebhookPayload {
  payment_id: string;
  order_id: string; // our reference, e.g. "DC-48213"
  status: 'succeeded' | 'failed' | string;
  amount: number;
  currency: string;
}

export function parseFomoPayWebhook(rawBody: string): FomoPayWebhookPayload {
  // TODO: confirm actual payload shape against FOMO Pay's doc.
  return JSON.parse(rawBody);
}
