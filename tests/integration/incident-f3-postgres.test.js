'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration incident-f3-postgres.test.js
 * @brief HUB-000 / F3 — concurrence SLA, rollback du sink et preuve physique atomique sur PostgreSQL réel.
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { escalateOneOverdueIncident } = require('../../services/incident-escalation');
const { resolvePhysicalProofIncident } = require('../../services/incident-write-service');

jest.setTimeout(30000);

const schema = `f3_incident_${process.pid}_${Date.now()}`.replace(/[^a-zA-Z0-9_]/g, '_');

async function clientInSchema() {
  const client = await pool.connect();
  await client.query(`SET search_path TO ${schema}, public`);
  return client;
}

async function query(sql, params = []) {
  const client = await clientInSchema();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

async function seedParcel({ parcelId, orderId, marketId = null } = {}) {
  if (orderId) {
    await query('INSERT INTO orders(id, reference, market_id) VALUES ($1,$2,$3)', [orderId, `ORD-${orderId}`, marketId]);
  }
  await query('INSERT INTO parcels(id, reference, order_id) VALUES ($1,$2,$3)', [parcelId, `PCL-${parcelId}`, orderId || null]);
}

async function seedIncident(overrides = {}) {
  const row = {
    id: `inc-${Date.now()}-${Math.random()}`,
    incident_type: 'weight_mismatch', severity: 'high', status: 'open', title: 'Weight mismatch',
    parcel_id: null, order_id: null, order_item_id: null, scan_event_id: null,
    details: {}, origin_domain: 'LOGISTICS', resolver_domain: 'LOGISTICS',
    resolution_class: 'PHYSICAL_PROOF', due_at: new Date(Date.now() - 60_000), escalation_level: 0,
    created_at: new Date(Date.now() - 120_000),
    ...overrides,
  };
  await query(`
    INSERT INTO incidents(
      id, incident_type, severity, status, title, parcel_id, order_id, order_item_id, scan_event_id,
      details, origin_domain, resolver_domain, resolution_class, due_at, escalation_level, created_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16)
  `, [
    row.id, row.incident_type, row.severity, row.status, row.title, row.parcel_id, row.order_id,
    row.order_item_id, row.scan_event_id, JSON.stringify(row.details), row.origin_domain,
    row.resolver_domain, row.resolution_class, row.due_at, row.escalation_level, row.created_at,
  ]);
  return row;
}

beforeAll(async () => {
  await pool.query(`CREATE SCHEMA ${schema}`);
  const client = await clientInSchema();
  try {
    await client.query(`
      CREATE TABLE orders (
        id TEXT PRIMARY KEY,
        reference TEXT,
        market_id TEXT
      );
      CREATE TABLE parcels (
        id TEXT PRIMARY KEY,
        reference TEXT,
        order_id TEXT
      );
      CREATE TABLE scan_events (
        id TEXT PRIMARY KEY,
        parcel_id TEXT,
        event_type TEXT,
        status TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        corrects_event_id TEXT,
        photo_urls TEXT[] NOT NULL DEFAULT '{}',
        notes TEXT
      );
      CREATE TABLE incidents (
        id TEXT PRIMARY KEY,
        incident_type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'open',
        title TEXT,
        parcel_id TEXT,
        order_id TEXT,
        order_item_id TEXT,
        scan_event_id TEXT,
        details JSONB NOT NULL DEFAULT '{}',
        origin_domain TEXT NOT NULL,
        resolver_domain TEXT NOT NULL,
        resolution_class TEXT NOT NULL,
        due_at TIMESTAMPTZ,
        escalation_level INTEGER NOT NULL DEFAULT 0,
        resolution_type TEXT,
        resolution JSONB,
        resolved_at TIMESTAMPTZ,
        resolved_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE signals (
        id TEXT PRIMARY KEY DEFAULT md5(random()::text || clock_timestamp()::text),
        signal_ref TEXT NOT NULL DEFAULT ('KSG-' || floor(random() * 1000000000)::bigint::text),
        signal_type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info',
        title TEXT NOT NULL,
        summary TEXT,
        source_module TEXT,
        target_shell TEXT,
        target_view TEXT,
        target_filters JSONB NOT NULL DEFAULT '{}',
        owner_role TEXT,
        entity_type TEXT,
        entity_id TEXT,
        recommendation TEXT,
        confidence TEXT,
        meta JSONB NOT NULL DEFAULT '{}',
        expires_at TIMESTAMPTZ,
        market_id TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        snoozed_until TIMESTAMPTZ,
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX idx_signals_active_fact_unique
        ON signals(signal_type, market_id, entity_type, entity_id) NULLS NOT DISTINCT
        WHERE status IN ('open','acknowledged','snoozed');
    `);
  } finally {
    client.release();
  }
});

afterEach(async () => {
  await query('TRUNCATE signals, incidents, scan_events, parcels, orders');
});

afterAll(async () => {
  try { await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await pool.end(); }
});

describe('F3 PostgreSQL — SLA escalation', () => {
  test('two workers cannot double-escalate the same overdue incident', async () => {
    await seedParcel({ parcelId: 'p-concurrent', orderId: 'o-concurrent', marketId: 'market-a' });
    const inc = await seedIncident({ id: 'inc-concurrent', parcel_id: 'p-concurrent', order_id: 'o-concurrent' });

    const c1 = await clientInSchema();
    const c2 = await clientInSchema();
    try {
      await c1.query('BEGIN');
      await c2.query('BEGIN');

      const first = await escalateOneOverdueIncident(c1);
      expect(first).toMatchObject({ incident_id: inc.id, escalation_level: 1, status: 'open' });

      const second = await escalateOneOverdueIncident(c2);
      expect(second).toBeNull(); // FOR UPDATE SKIP LOCKED, no wait/no duplicate

      await c1.query('COMMIT');
      await c2.query('COMMIT');
    } finally {
      try { await c1.query('ROLLBACK'); } catch (_) {}
      try { await c2.query('ROLLBACK'); } catch (_) {}
      c1.release();
      c2.release();
    }

    const { rows: [state] } = await query('SELECT status, escalation_level FROM incidents WHERE id=$1', [inc.id]);
    const { rows: signals } = await query("SELECT * FROM signals WHERE signal_type='incident_sla_overdue' AND entity_id=$1", [inc.id]);
    expect(state).toEqual({ status: 'open', escalation_level: 1 });
    expect(signals).toHaveLength(1);
    expect(signals[0].owner_role).toBe('hub');
  });

  test('Action Center sink failure rolls back escalation marker', async () => {
    const inc = await seedIncident({ id: 'inc-sink-rollback' });
    const client = await clientInSchema();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE signals RENAME TO signals_unavailable');
      await expect(escalateOneOverdueIncident(client)).rejects.toThrow();
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const { rows: [state] } = await query('SELECT status, escalation_level FROM incidents WHERE id=$1', [inc.id]);
    expect(state).toEqual({ status: 'open', escalation_level: 0 });
    const { rows: signals } = await query("SELECT * FROM signals WHERE entity_id=$1", [inc.id]);
    expect(signals).toHaveLength(0);
  });
});

describe('F3 PostgreSQL — physical proof resolution', () => {
  test('fresh proof + predicate pass is atomic; caller rollback keeps incident open and evidence unchanged', async () => {
    await seedParcel({ parcelId: 'p-proof', orderId: null });
    await query(`INSERT INTO scan_events(id, parcel_id, event_type, status, created_at, photo_urls, notes)
                 VALUES ('scan-trigger','p-proof','weigh','applied','2026-09-15T10:00:00Z',ARRAY['before.jpg'],'trigger')`);
    await query(`INSERT INTO scan_events(id, parcel_id, event_type, status, created_at, photo_urls, notes)
                 VALUES ('scan-fresh','p-proof','weigh','applied','2026-09-15T11:00:00Z',ARRAY['after.jpg'],'fresh')`);
    const inc = await seedIncident({
      id: 'inc-proof-rollback', parcel_id: 'p-proof', scan_event_id: 'scan-trigger',
      created_at: new Date('2026-09-15T10:00:30Z'),
    });
    const before = (await query("SELECT * FROM scan_events WHERE id='scan-fresh'")).rows[0];

    const client = await clientInSchema();
    try {
      await client.query('BEGIN');
      const result = await resolvePhysicalProofIncident(client, {
        incidentId: inc.id,
        proofScanEventId: 'scan-fresh',
        revalidate: async (executor) => {
          const { rows: [proof] } = await executor.query("SELECT notes FROM scan_events WHERE id='scan-fresh'");
          return proof.notes === 'fresh';
        },
      });
      expect(result.resolved).toBe(true);
      const { rows: [inside] } = await client.query('SELECT status FROM incidents WHERE id=$1', [inc.id]);
      expect(inside.status).toBe('resolved');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const { rows: [afterIncident] } = await query('SELECT status, resolved_at FROM incidents WHERE id=$1', [inc.id]);
    const afterProof = (await query("SELECT * FROM scan_events WHERE id='scan-fresh'")).rows[0];
    expect(afterIncident.status).toBe('open');
    expect(afterIncident.resolved_at).toBeNull();
    expect(afterProof).toEqual(before);
  });

  test('stale proof cannot close an incident', async () => {
    await seedParcel({ parcelId: 'p-stale', orderId: null });
    await query(`INSERT INTO scan_events(id, parcel_id, event_type, status, created_at)
                 VALUES ('scan-trigger-stale','p-stale','weigh','applied','2026-09-15T10:00:00Z')`);
    const inc = await seedIncident({
      id: 'inc-stale', parcel_id: 'p-stale', scan_event_id: 'scan-trigger-stale',
      created_at: new Date('2026-09-15T10:00:30Z'),
    });

    const client = await clientInSchema();
    try {
      await client.query('BEGIN');
      await expect(resolvePhysicalProofIncident(client, {
        incidentId: inc.id, proofScanEventId: 'scan-trigger-stale', revalidate: async () => true,
      })).rejects.toMatchObject({ code: 'STALE_PHYSICAL_PROOF' });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const { rows: [state] } = await query('SELECT status FROM incidents WHERE id=$1', [inc.id]);
    expect(state.status).toBe('open');
  });

  test('predicate failure never resolves despite a fresh scan', async () => {
    await seedParcel({ parcelId: 'p-fail', orderId: null });
    await query(`INSERT INTO scan_events(id, parcel_id, event_type, status, created_at)
                 VALUES ('scan-new-fail','p-fail','content_verified','applied','2026-09-15T12:00:00Z')`);
    const inc = await seedIncident({ id: 'inc-predicate-fail', parcel_id: 'p-fail', created_at: new Date('2026-09-15T10:00:00Z') });

    const client = await clientInSchema();
    try {
      await client.query('BEGIN');
      const result = await resolvePhysicalProofIncident(client, {
        incidentId: inc.id, proofScanEventId: 'scan-new-fail', revalidate: async () => false,
      });
      expect(result).toMatchObject({ resolved: false, reason: 'PREDICATE_STILL_FAILS' });
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const { rows: [state] } = await query('SELECT status FROM incidents WHERE id=$1', [inc.id]);
    expect(state.status).toBe('open');
  });
});
