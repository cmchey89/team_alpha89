// lib/db/spatial.ts
//
// All spatial logic lives here, using PostGIS functions via raw SQL through
// Drizzle's `sql` template. This replaces the prototype's hand-rolled
// segment-intersection JS — PostGIS's ST_Intersects is the industry-standard,
// battle-tested way to do this and handles edge cases (curved boundaries,
// antimeridian, precision) that the JS version did not attempt to.

import { neon } from '@neondatabase/serverless';
import { db } from './client';
import type { Feature, Polygon, LineString } from 'geojson';

function rawSql() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  return neon(process.env.DATABASE_URL);
}

export interface ConflictResult {
  infraLineId: string;
  utilityType: string;
  label: string | null;
}

/**
 * Given a contractor's working zone (GeoJSON Polygon) and an owner's user id,
 * returns every infra_lines row owned by that owner whose geometry
 * intersects the zone.
 *
 * SRID 4326 (lat/lng) is used throughout — ST_Intersects works correctly on
 * 4326 geometries for this kind of "does A cross B" check at city scale;
 * we are not doing precise area/distance math here, which would need a
 * projected SRID (e.g. SVY21 / EPSG:3414 for Singapore) instead.
 */
export async function findConflicts(
  ownerId: string,
  zoneGeoJSON: Feature<Polygon> | Polygon
): Promise<ConflictResult[]> {
  const geomJson = JSON.stringify(
    'geometry' in zoneGeoJSON ? zoneGeoJSON.geometry : zoneGeoJSON
  );

  const rows = await rawSql()`
    SELECT
      id AS "infraLineId",
      utility_type AS "utilityType",
      label
    FROM infra_lines
    WHERE owner_id = ${ownerId}
      AND ST_Intersects(
        geom,
        ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326)
      )
  `;

  return rows as unknown as ConflictResult[];
}

/**
 * Inserts a single infra line (one feature from the owner's uploaded GIS
 * file, or one hand-drawn line in Owner Setup mode).
 */
export async function insertInfraLines(rows: {
  ownerId: string;
  sourceUploadId?: string;
  utilityType: 'telecom_pipe' | 'manhole' | 'other';
  label?: string;
  sourceProperties?: Record<string, unknown>;
  geometry: LineString;
}[]) {
  if (rows.length === 0) return;
  const { neonConfig, neon: neonFn } = await import('@neondatabase/serverless');
  neonConfig.fetchConnectionCache = true;
  const sqlClient = neonFn(process.env.DATABASE_URL!, { fullResults: false });

  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    // Build a single multi-row INSERT using unnest for true bulk insert
    const ownerIds      = chunk.map((p) => p.ownerId);
    const uploadIds     = chunk.map((p) => p.sourceUploadId ?? null);
    const utilityTypes  = chunk.map((p) => p.utilityType);
    const labels        = chunk.map((p) => p.label ?? null);
    const props         = chunk.map((p) => p.sourceProperties ? JSON.stringify(p.sourceProperties) : null);
    const geoms         = chunk.map((p) => JSON.stringify(p.geometry));

    await sqlClient`
      INSERT INTO infra_lines (owner_id, source_upload_id, utility_type, label, source_properties, geom)
      SELECT
        unnest(${ownerIds}::uuid[]),
        unnest(${uploadIds}::uuid[]),
        unnest(${utilityTypes}::text[]),
        unnest(${labels}::text[]),
        unnest(${props}::jsonb[]),
        ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(unnest(${geoms}::text[])), 3414), 4326)
    `;
  }
}

/**
 * Atomically inserts a work zone, finds conflicts, updates the zone status,
 * and records conflict rows — all in a single SQL statement so no intermediate
 * state is visible to concurrent requests and no partial writes are possible.
 *
 * Replaces the three-step insertWorkZone → findConflicts → UPDATE pattern
 * which could leave a zone stuck in 'checking' if the process died between steps.
 */
export async function checkAndInsertWorkZone(params: {
  contractorId: string;
  ownerId: string;
  reference: string;
  geometry: Polygon;
  areaSqm: number;
}): Promise<{ zoneId: string; conflicts: ConflictResult[] }> {
  const geomJson = JSON.stringify(params.geometry);
  const sql = rawSql();

  const rows = await sql`
    WITH
      zone_geom AS (
        SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326) AS geom
      ),
      new_zone AS (
        INSERT INTO work_zones (contractor_id, owner_id, reference, geom, area_sqm, status)
        SELECT
          ${params.contractorId}::uuid,
          ${params.ownerId}::uuid,
          ${params.reference},
          zone_geom.geom,
          ${params.areaSqm},
          'checking'
        FROM zone_geom
        RETURNING id
      ),
      conflicts AS (
        SELECT il.id AS "infraLineId", il.utility_type AS "utilityType", il.label
        FROM infra_lines il
        CROSS JOIN zone_geom
        WHERE il.owner_id = ${params.ownerId}::uuid
          AND ST_Intersects(il.geom, zone_geom.geom)
      ),
      zone_update AS (
        UPDATE work_zones
        SET
          status     = CASE WHEN EXISTS(SELECT 1 FROM conflicts) THEN 'affected_unpaid' ELSE 'clear' END,
          checked_at = NOW()
        FROM new_zone
        WHERE work_zones.id = new_zone.id
      ),
      conflict_insert AS (
        INSERT INTO work_zone_conflicts (work_zone_id, infra_line_id)
        SELECT new_zone.id, c."infraLineId"
        FROM new_zone
        CROSS JOIN conflicts c
      )
    SELECT
      new_zone.id AS "zoneId",
      COALESCE(
        json_agg(
          json_build_object('infraLineId', c."infraLineId", 'utilityType', c."utilityType", 'label', c.label)
        ) FILTER (WHERE c."infraLineId" IS NOT NULL),
        '[]'::json
      ) AS conflicts
    FROM new_zone
    LEFT JOIN conflicts c ON true
    GROUP BY new_zone.id
  `;

  const row = rows[0] as { zoneId: string; conflicts: ConflictResult[] };
  return { zoneId: row.zoneId, conflicts: row.conflicts ?? [] };
}

/** @deprecated Use checkAndInsertWorkZone instead */
export async function insertWorkZone(params: {
  contractorId: string;
  ownerId: string;
  reference: string;
  geometry: Polygon;
  areaSqm: number;
}): Promise<string> {
  const geomJson = JSON.stringify(params.geometry);
  const rows = await rawSql()`
    INSERT INTO work_zones (contractor_id, owner_id, reference, geom, area_sqm, status)
    VALUES (
      ${params.contractorId},
      ${params.ownerId},
      ${params.reference},
      ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326),
      ${params.areaSqm},
      'checking'
    )
    RETURNING id
  `;
  return (rows[0] as { id: string }).id;
}
