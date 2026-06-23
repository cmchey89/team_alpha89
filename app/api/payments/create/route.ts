// app/api/payments/create/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { workZones, payments } from '@/lib/db/schema';
import { createFomoPayPayment } from '@/lib/payments/fomoPay';
import { requireUser } from '@/lib/auth/session';

const DRAWING_FEE_CENTS = 4500; // SGD 45.00 — matches the prototype's price

const CreatePaymentBody = z.object({
  zoneId: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const contractor = await requireUser(req, { role: 'contractor' });
  if (!contractor) {
    return NextResponse.json({ error: 'Contractor account required.' }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = CreatePaymentBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const zoneRows = await db.select().from(workZones).where(eq(workZones.id, parsed.data.zoneId)).limit(1);
  const zone = zoneRows[0];

  if (!zone || zone.contractorId !== contractor.id) {
    return NextResponse.json({ error: 'Work zone not found.' }, { status: 404 });
  }
  if (zone.status !== 'affected_unpaid') {
    return NextResponse.json(
      { error: `This zone is not awaiting payment (status: ${zone.status}).` },
      { status: 400 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  const fomoResult = await createFomoPayPayment({
    amountCents: DRAWING_FEE_CENTS,
    currency: 'SGD',
    reference: zone.reference,
    description: `DigClear drawing fee — ${zone.reference}`,
    successRedirectUrl: `${appUrl}/contractor/zones/${zone.id}?paid=1`,
    failureRedirectUrl: `${appUrl}/contractor/zones/${zone.id}?paid=0`,
  });

  const [payment] = await db
    .insert(payments)
    .values({
      workZoneId: zone.id,
      provider: 'fomo_pay',
      providerPaymentId: fomoResult.providerPaymentId,
      amountCents: DRAWING_FEE_CENTS,
      currency: 'SGD',
      status: 'pending',
    })
    .returning();

  await db.update(workZones).set({ paymentId: payment.id }).where(eq(workZones.id, zone.id));

  return NextResponse.json({ checkoutUrl: fomoResult.checkoutUrl });
}
