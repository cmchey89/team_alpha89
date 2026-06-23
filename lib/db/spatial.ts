// lib/db/spatial.ts
//
// All spatial logic lives here, using PostGIS functions via raw SQL through
// Drizzle's `sql` template. This replaces the prototype's hand-rolled
// segment-intersection JS — PostGIS's ST_Intersects is the industry-standard,
// battle-tested way to do this and handles edge cases (curved boundaries,
// antimeridian, precision) that the JS version did not attempt to.

import { sql } from 'drizzle-orm';
import { db } from './client';
import type { Feature, Polygon, LineString } from 'geojson';

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

  const rows = await db.execute(sql`
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
  `);

  return rows as unknown as ConflictResult[];
}

/**
 * Inserts a single infra line (one feature from the owner's uploaded GIS
 * file, or one hand-drawn line in Owner Setup mode).
 */
export async function insertInfraLines(rows: {
  ownerId: string;
  sourceUploadId?: string;
  utilityType: 'electrical' | 'water' | 'gas' | 'telecom' | 'other';
  label?: string;
  sourceProperties?: Record<string, unknown>;
  geometry: LineString;
}[]) {
  if (rows.length === 0) return;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk.map((p) =>
      sql`(${p.ownerId}, ${p.sourceUploadId ?? null}, ${p.utilityType}, ${p.label ?? null}, ${p.sourceProperties ? JSON.stringify(p.sourceProperties) : null}::jsonb, ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(p.geometry)}), 3414), 4326))`
    );
    await db.execute(sql`
      INSERT INTO infra_lines (owner_id, source_upload_id, utility_type, label, source_properties, geom)
      VALUES ${sql.join(values, sql`, `)}
    `);
  }
}

/**
 * Inserts a contractor's submitted work zone polygon.
 */
export async function insertWorkZone(params: {
  contractorId: string;
  ownerId: string;
  reference: string;
  geometry: Polygon;
  areaSqm: number;
}): Promise<string> {
  const geomJson = JSON.stringify(params.geometry);
  const rows = await db.execute(sql`
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
  `);
  return (rows[0] as { id: string }).id;
}
