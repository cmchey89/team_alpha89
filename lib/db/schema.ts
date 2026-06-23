// lib/db/schema.ts
//
// Database schema using Drizzle ORM, targeting Postgres + PostGIS.
// This is provider-agnostic: works identically against Supabase's Postgres
// or a standalone Neon/RDS Postgres instance, as long as the `postgis`
// extension is enabled (see lib/db/migrations/0000_init.sql).
//
// Geometry is stored using PostGIS's `geometry` type via raw SQL column
// definitions, since Drizzle does not have a first-class PostGIS column
// type. We define a small `geometry()` helper below to keep this readable.

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// --- PostGIS geometry custom column type -----------------------------------
// Stored as `geometry(Geometry, 4326)` — SRID 4326 (WGS84 lat/lng), which is
// what GPS, Leaflet, and GeoJSON all use natively. Keeping a single SRID
// throughout avoids reprojection bugs.
const geometry = customType<{ data: string }>({
  dataType() {
    return 'geometry(Geometry, 4326)';
  },
});

// --- Users (owner + contractor accounts) -----------------------------------
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['owner', 'contractor'] }).notNull().default('contractor'),
  companyName: text('company_name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// --- Underground infrastructure baseline (owner-uploaded) ------------------
// One row per line/feature imported from the owner's GIS upload (GeoPackage,
// shapefile, or hand-drawn in Owner Setup). `sourceUploadId` groups features
// that came from the same uploaded file, so a whole upload can be rolled back.
export const infraLines = pgTable('infra_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  sourceUploadId: uuid('source_upload_id'),
  utilityType: text('utility_type', {
    enum: ['electrical', 'water', 'gas', 'telecom', 'other'],
  }).notNull().default('other'),
  label: text('label'),
  // Original attribute fields from the uploaded GIS file, preserved as-is
  // in case the owner's source data has fields we don't model explicitly.
  sourceProperties: jsonb('source_properties'),
  geom: geometry('geom').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// --- GIS upload batches (audit trail for owner uploads) --------------------
export const gisUploads = pgTable('gis_uploads', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  filename: text('filename').notNull(),
  sourceFormat: text('source_format'), // 'GPKG' | 'ESRI Shapefile' | etc, from gdal3.js
  featureCount: integer('feature_count').notNull().default(0),
  status: text('status', { enum: ['processing', 'completed', 'failed'] })
    .notNull()
    .default('processing'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// --- Contractor work zone requests ------------------------------------------
export const workZones = pgTable('work_zones', {
  id: uuid('id').defaultRandom().primaryKey(),
  contractorId: uuid('contractor_id').notNull().references(() => users.id),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  reference: text('reference').notNull().unique(), // e.g. "DC-48213"
  geom: geometry('geom').notNull(),
  areaSqm: integer('area_sqm'),
  status: text('status', {
    enum: ['submitted', 'checking', 'clear', 'affected_unpaid', 'affected_paid'],
  })
    .notNull()
    .default('submitted'),
  paid: boolean('paid').notNull().default(false),
  paymentId: uuid('payment_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  checkedAt: timestamp('checked_at'),
});

// --- Which infra lines a given work zone was found to conflict with --------
// Computed once at check time and persisted, so the result is stable and
// auditable even if the owner's baseline changes later.
export const workZoneConflicts = pgTable('work_zone_conflicts', {
  id: uuid('id').defaultRandom().primaryKey(),
  workZoneId: uuid('work_zone_id').notNull().references(() => workZones.id),
  infraLineId: uuid('infra_line_id').notNull().references(() => infraLines.id),
});

// --- Payments (FOMO Pay) ----------------------------------------------------
export const payments = pgTable('payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  workZoneId: uuid('work_zone_id').notNull().references(() => workZones.id),
  provider: text('provider').notNull().default('fomo_pay'),
  providerPaymentId: text('provider_payment_id'), // ID FOMO Pay assigns, filled on create
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull().default('SGD'),
  status: text('status', {
    enum: ['pending', 'succeeded', 'failed', 'expired'],
  })
    .notNull()
    .default('pending'),
  rawWebhookPayload: jsonb('raw_webhook_payload'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  confirmedAt: timestamp('confirmed_at'),
});

// Helper export for raw SQL spatial queries (see lib/db/spatial.ts) — Drizzle
// doesn't model ST_Intersects etc. as query builder methods, so we drop to
// sql`` for those specific calls.
export { sql };
