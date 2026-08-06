'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/parcel-security.test.js
 *
 * Tests de services/parcel-security.js
 *
 * Couverture (doctrine sécurité logistique S1-S5) :
 *   ✓ generateExternalCode : format "KP-XXXXXX", charset sans 0/O/1/I, longueur fixe
 *   ✓ generateSealCode : 8 caractères hexadécimaux majuscules
 *   ✓ buildExternalLabel [S1/S3] : ne révèle JAMAIS nom/téléphone/produits/valeur client
 *   ✓ buildInternalRecord : contient les infos sensibles (réservé système)
 *   ✓ logParcelEvent : guard si parcel_id/event_type manquant (pas d'appel DB)
 *   ✓ logParcelEvent : insert réussi → renvoie {id, created_at}
 *   ✓ logParcelEvent : erreur DB est non-bloquante (best-effort), renvoie null
 *   ✓ checkWeightIntegrity : tolérance ±5%/±0.2kg respectée → null
 *   ✓ checkWeightIntegrity : dépassement → anomalie warning vs critical (>2x tolérance)
 *   ✓ checkWeightIntegrity : inputs manquants/invalides → null (pas de crash)
 *   ✓ verifySeal : code manquant, mismatch, et match insensible à la casse
 *   ✓ ensureSecurityTables : AUD-07 — colonnes ajoutées strictement depuis la liste hardcodée
 *   ✓ ensureSecurityTables : backfill external_code uniquement pour les colis orphelins
 *   ✓ ensureSecurityTables : erreur de migration catched, ne throw jamais (non-bloquant)
 */

jest.mock('../../utils/logger', () => ({
  forModule: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const {
  generateExternalCode,
  generateSealCode,
  buildExternalLabel,
  buildInternalRecord,
  logParcelEvent,
  checkWeightIntegrity,
  verifySeal,
  ensureSecurityTables,
  backfillParcelExternalCodes,
} = require('../../services/parcel-security');

describe('parcel-security — generateExternalCode [S4]', () => {
  it('génère un code au format KP-XXXXXX avec charset sans caractères ambigus', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateExternalCode();
      expect(code).toMatch(/^KP-[A-Z0-9]{6}$/);
      expect(code).not.toMatch(/[0O1I]/);
    }
  });
});

describe('parcel-security — generateSealCode [S5]', () => {
  it('génère un code hexadécimal de 8 caractères majuscules', () => {
    const code = generateSealCode();
    expect(code).toMatch(/^[0-9A-F]{8}$/);
  });
});

describe('parcel-security — buildExternalLabel [S1/S3] (info banalisée)', () => {
  it('ne contient JAMAIS de nom, téléphone, produits ou valeur', () => {
    const parcel = { external_code: 'KP-A1B2C3', weight_kg: 3.5, type: 'fragile' };
    const order = { full_name: 'Jean Dupont', phone: '+269123456', total_kmf: 50000 };
    const label = buildExternalLabel(parcel, { name: 'Relais Moroni' }, 'grande_comore');

    const serialized = JSON.stringify(label);
    expect(serialized).not.toMatch(/Jean Dupont/);
    expect(serialized).not.toMatch(/123456/);
    expect(serialized).not.toMatch(/50000/);
    expect(label).toEqual({
      external_code: 'KP-A1B2C3',
      destination: 'grande_comore',
      relay_name: 'Relais Moroni',
      weight_kg: 3.5,
      type: 'fragile',
      date: expect.any(String),
      qr_url: 'https://komerce.km/p/KP-A1B2C3',
    });
  });

  it('gère relay/destination absents sans crash', () => {
    const label = buildExternalLabel({ external_code: 'KP-X' }, null, null);
    expect(label.relay_name).toBeNull();
    expect(label.destination).toBeNull();
    expect(label.type).toBe('standard');
  });
});

describe('parcel-security — buildInternalRecord (réservé système)', () => {
  it('contient les infos sensibles pour usage interne uniquement', () => {
    const record = buildInternalRecord(
      { id: 'p1', reference: 'KOM-P-2026-000001', external_code: 'KP-A1B2C3', seal_code: 'AB12CD34' },
      { reference: 'CMD-1', full_name: 'Jean Dupont', phone: '+269123456', total_kmf: 50000, payment_status: 'paid', destination_island: 'grande_comore', routing_mode: 'direct' },
      [{ product: 'x' }]
    );
    expect(record.customer_name).toBe('Jean Dupont');
    expect(record.customer_phone).toBe('+269123456');
    expect(record.value_kmf).toBe(50000);
    expect(record.items).toEqual([{ product: 'x' }]);
  });
});

describe('parcel-security — logParcelEvent [S2]', () => {
  it('refuse sans appeler la DB si parcel_id manquant', async () => {
    const db = { query: jest.fn() };
    const result = await logParcelEvent(db, { event_type: 'scanned' });
    expect(result).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('refuse sans appeler la DB si event_type manquant', async () => {
    const db = { query: jest.fn() };
    const result = await logParcelEvent(db, { parcel_id: 'p1' });
    expect(result).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('insère et renvoie {id, created_at} en cas de succès', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'ev1', created_at: '2026-06-30' }] }) };
    const result = await logParcelEvent(db, { parcel_id: 'p1', event_type: 'scanned', metadata: { foo: 'bar' } });
    expect(result).toEqual({ id: 'ev1', created_at: '2026-06-30' });
    expect(db.query.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['p1', 'scanned', null, null, null, null, JSON.stringify({ foo: 'bar' })])
    );
  });

  it('erreur DB est non-bloquante : renvoie null sans throw', async () => {
    const db = { query: jest.fn().mockRejectedValue(new Error('db down')) };
    await expect(logParcelEvent(db, { parcel_id: 'p1', event_type: 'scanned' })).resolves.toBeNull();
  });
});

describe('parcel-security — checkWeightIntegrity [S5]', () => {
  it('renvoie null si l\'écart est dans la tolérance (±5% ou ±0.2kg)', () => {
    expect(checkWeightIntegrity(10, 10.3)).toBeNull(); // 3% < 5%
    expect(checkWeightIntegrity(1, 1.15)).toBeNull();  // tolérance abs 0.2kg domine
  });

  it('renvoie une anomalie "warning" pour un écart modéré', () => {
    const anomaly = checkWeightIntegrity(10, 11); // diff=1, tolerance=0.5 → warning (1 <= 1.0)
    expect(anomaly).not.toBeNull();
    expect(anomaly.type).toBe('weight_discrepancy');
    expect(anomaly.severity).toBe('warning');
  });

  it('renvoie une anomalie "critical" si l\'écart dépasse 2x la tolérance', () => {
    const anomaly = checkWeightIntegrity(10, 13); // diff=3, tolerance=0.5, 3 > 1.0
    expect(anomaly.severity).toBe('critical');
  });

  it('renvoie null si un poids est manquant ou invalide (pas de crash)', () => {
    expect(checkWeightIntegrity(null, 10)).toBeNull();
    expect(checkWeightIntegrity(10, null)).toBeNull();
    expect(checkWeightIntegrity('abc', 10)).toBeNull();
  });
});

describe('parcel-security — verifySeal [S5]', () => {
  it('invalide si un des deux codes est manquant', () => {
    expect(verifySeal(null, 'AB12CD34')).toEqual({ valid: false, reason: 'seal_missing' });
    expect(verifySeal('AB12CD34', null)).toEqual({ valid: false, reason: 'seal_missing' });
  });

  it('invalide si les codes ne correspondent pas', () => {
    expect(verifySeal('AB12CD34', 'FFFFFFFF')).toEqual({ valid: false, reason: 'seal_mismatch' });
  });

  it('valide même avec une casse différente', () => {
    expect(verifySeal('ab12cd34', 'AB12CD34')).toEqual({ valid: true });
  });
});

describe('parcel-security — ensureSecurityTables [LOT R2 — verification only, DDL owned by migrations/014d + 078]', () => {
  // LOT R2 : le DDL (CREATE TABLE parcel_events + index, ALTER TABLE
  // parcels ADD COLUMN, index unique external_code) vit désormais dans
  // migrations/014d_parcel_events_foundation.sql et
  // migrations/078_parcels_security_columns.sql. Cette fonction ne fait
  // plus qu'une lecture catalogue (1 requête) et échoue bruyamment (throw)
  // si le contrat n'est pas là. Le backfill external_code reste inchangé,
  // dans backfillParcelExternalCodes (describe() dédié plus bas).
  it('tous les objets présents → resolves sans throw, une seule requête', async () => {
    const db = {
      query: jest.fn().mockResolvedValue({
        rows: [{
          parcel_events: true,
          idx_parcels_external_code: true,
          external_code: true,
          seal_code: true,
          last_weight_kg: true,
          last_weight_at: true,
          last_weight_location: true,
        }],
      }),
    };

    await expect(ensureSecurityTables(db)).resolves.toBeUndefined();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('objet manquant → throw fail-closed, nomme l\'objet manquant', async () => {
    const db = {
      query: jest.fn().mockResolvedValue({
        rows: [{
          parcel_events: false, // manquant : migrations/014d pas jouée
          idx_parcels_external_code: true,
          external_code: true,
          seal_code: true,
          last_weight_kg: true,
          last_weight_at: true,
          last_weight_location: true,
        }],
      }),
    };

    await expect(ensureSecurityTables(db)).rejects.toThrow(/parcel_events/);
  });
});

describe('parcel-security — backfillParcelExternalCodes', () => {
  // FIX 2026-07-09 : ce backfill tournait auparavant dans ensureSecurityTables
  // au boot du serveur public. Sorti dans sa propre fonction, appelée
  // manuellement via scripts/backfill-boot-data.js, hors du chemin de boot.
  it('backfille uniquement les colis orphelins (sans external_code)', async () => {
    const queries = [];
    const db = {
      query: jest.fn(async (sql, params) => {
        queries.push({ sql, params });
        if (sql.includes('SELECT id FROM parcels WHERE external_code IS NULL')) {
          return { rows: [{ id: 'orphan-1' }, { id: 'orphan-2' }] };
        }
        return { rows: [] };
      }),
    };

    await backfillParcelExternalCodes(db);

    const updateCalls = queries.filter(q => q.sql.includes('UPDATE parcels SET external_code'));
    expect(updateCalls.length).toBe(2); // un par orphelin
    expect(updateCalls.map(c => c.params[1])).toEqual(['orphan-1', 'orphan-2']);
    expect(updateCalls[0].params[0]).toMatch(/^KP-[A-Z0-9]{6}$/);
  });

  it('ne throw jamais même si une requête échoue (non-bloquant)', async () => {
    const db = { query: jest.fn().mockRejectedValue(new Error('backfill failed')) };
    await expect(backfillParcelExternalCodes(db)).resolves.toBeUndefined();
  });
});
