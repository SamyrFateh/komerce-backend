/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
// Le test de service est isolé : aucune connexion PostgreSQL, writer mocké.
jest.mock('../../db', () => ({ withTransaction: jest.fn() }));
const fs = require('fs');
const path = require('path');
const bagBox = require('../../services/hub-bag-box-service');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = {
  bagUnitId: id(1), boxUnitId: id(2), parcelId: id(3), expectedMarketId: id(4), actorId: id(5),
  bagReferenceScan: 'SAC-1', boxReferenceScan: 'BOX-1',
};

describe('Composition directe en COMBOX : provenance explicite (#3900 P0-2)', () => {
  test.each([
    [{}, 'HUB_BAG_EVIDENCE_METHOD_REQUIRED'],
    [{ evidenceMethod: 'KEYBOARD' }, 'HUB_BAG_EVIDENCE_METHOD_REQUIRED'],
    [{ evidenceMethod: 'MANUAL' }, 'HUB_BAG_MANUAL_EVIDENCE_REQUIRED'],
    [{ evidenceMethod: 'MANUAL', evidenceRef: 'court' }, 'HUB_BAG_MANUAL_EVIDENCE_REQUIRED'],
    [{ evidenceMethod: 'SCAN', evidenceRef: 'justification inutile' }, 'HUB_BAG_SCAN_EVIDENCE_REF_FORBIDDEN'],
  ])('refuse %j avant toute écriture', async (extra, code) => {
    await expect(bagBox.attachBagToBox({ ...base, ...extra })).rejects.toMatchObject({ code });
  });

  test('route et interface transmettent la preuve article et le scan de la COMBOX', () => {
    const route = fs.readFileSync(path.join(__dirname, '../../routes/admin-operations-workspace.js'), 'utf8');
    const ui = fs.readFileSync(path.join(__dirname,
      '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
    expect(route).toContain('evidence_method: body.evidence_method, evidence_code: body.evidence_code, evidence_ref: body.evidence_ref');
    expect(route).toContain('box_reference_scan');
    expect(ui).toContain("boxScan.setAttribute('data-hub-box-scan','')");
    expect(ui).toContain("method.value==='MANUAL'");
    expect(ui).toContain("body:{box_reference_scan:boxScan.value.trim()}");
    expect(ui).toContain("evidence_method:'SCAN',evidence_code:code.value.trim()");
    expect(ui).toContain("evidence_method:'MANUAL',evidence_ref:proofRef");
    expect(ui).not.toContain('data-hub-bag-preparation');
  });
});

describe('Réception fournisseur Hub : saisie manuelle (#3900 P0-2)', () => {
  const identity = require('../../services/hub-physical-identity');
  const po = id(10);
  const sku = id(11);
  const src = fs.readFileSync(path.join(__dirname, '../../services/hub-physical-identity.js'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname,
    '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
  const call = contents => identity.receiveSupplierPackage({ query: async () => { throw new Error('no-db'); } },
    { reference: 'R', contents });

  test.each([
    [{ evidence_method: 'MANUAL' }, 'HUB_INBOUND_MANUAL_EVIDENCE_REQUIRED'],
    [{ evidence_method: 'MANUAL', evidence_ref: 'court' }, 'HUB_INBOUND_MANUAL_EVIDENCE_REQUIRED'],
    [{ evidence_method: 'MANUAL', evidence_ref: 'constat colis ouvert', evidence_code: '123456' },
      'HUB_INBOUND_MANUAL_CODE_FORBIDDEN'],
  ])('refuse %j avant toute écriture', async (extra, code) => {
    await expect(call([{ purchase_order_id: po, product_sku_id: sku, quantity: 1, ...extra }]))
      .rejects.toMatchObject({ code });
  });

  test('refuse une saisie manuelle sans variante', async () => {
    await expect(call([{ purchase_order_id: po, quantity: 1, evidence_method: 'MANUAL', evidence_ref: 'constat colis ouvert' }]))
      .rejects.toMatchObject({ code: 'HUB_INBOUND_MANUAL_SKU_REQUIRED' });
  });

  test('le writer stocke MANUAL + justification, jamais SCAN, et l\'interface la transmet', () => {
    expect(src).toContain("item.evidenceCode ? 'SCAN' : item.evidenceMethod, item.evidenceCode, item.evidenceRef");
    expect(src).toContain("if (entry.content.evidence_method === 'MANUAL') return null;");
    expect(ui).toContain("data-receive-manual-proof");
    // R4 : interrupteur explicite ; sans lui, jamais de MANUAL ; avec lui, jamais de evidence_code.
    expect(ui).toContain('data-receive-manual-toggle');
    expect(ui).toMatch(/manualToggle\.checked\s*\?\s*\(line\.product_sku_id && String\(manualProof/);
    expect(ui).toContain('matched.confirmed && !manualToggle.checked');
    expect(ui).toContain("{ evidence_method: 'MANUAL', evidence_ref: String(manualProof.value).trim() }");
  });
});

describe('Compatibilité historique sac -> colis', () => {
  const db = jest.requireMock('../../db');
  afterEach(() => jest.restoreAllMocks());

  function mockCandidates(candidates) {
    const writes = [];
    jest.spyOn(db, 'withTransaction').mockImplementation(async work => work({
      query: async (sql, args) => {
        if (sql.includes('SELECT b.id, b.order_id')) return {
          rows: [{ id: base.bagUnitId, order_id: id(6), market_id: base.expectedMarketId }],
        };
        if (sql.includes('SELECT DISTINCT p.id')) {
          expect(args).toEqual([id(6)]);
          return { rows: candidates.map(value => ({ id: value })) };
        }
        if (sql.includes('FROM hub_box_bags WHERE')) return { rows: [] };
        if (sql.includes('INSERT INTO hub_box_bags')) {
          writes.push({ sql, args });
          return { rows: [{ bag_unit_id: base.bagUnitId, box_unit_id: base.boxUnitId,
            parcel_id: args[2], evidence_method: 'SCAN' }] };
        }
        throw new Error('SQL inattendu: ' + sql);
      },
    }));
    return writes;
  }

  test('le serveur rattache un colis import unique en conservant les deux preuves scannées', async () => {
    const writes = mockCandidates([base.parcelId]);
    const result = await bagBox.attachBagToBox({
      ...base, parcelId: undefined, evidenceMethod: 'SCAN',
    });
    expect(result.parcel_id).toBe(base.parcelId);
    expect(result.already_linked).toBe(false);
    expect(writes).toHaveLength(1);
    expect(writes[0].args.slice(0, 3)).toEqual([base.bagUnitId, base.boxUnitId, base.parcelId]);
    expect(writes[0].args.slice(4, 6)).toEqual([base.bagReferenceScan, base.boxReferenceScan]);
  });

  test.each([
    [[], 'HUB_BAG_PARCEL_NOT_READY'],
    [[id(3), id(7)], 'HUB_BAG_PARCEL_AMBIGUOUS'],
  ])('refuse une déduction absente ou ambiguë sans écrire', async (candidates, code) => {
    const writes = mockCandidates(candidates);
    await expect(bagBox.attachBagToBox({
      ...base, parcelId: undefined, evidenceMethod: 'SCAN',
    })).rejects.toMatchObject({ code, status: 409 });
    expect(writes).toHaveLength(0);
  });

  test('Hub Live compose directement une COMBOX sans interface de sac', () => {
    const source = fs.readFileSync(path.join(__dirname,
      '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
    expect(source).toContain("boxScan.setAttribute('data-hub-box-scan','')");
    expect(source).toContain("'Fermer la COMBOX'");
    expect(source).not.toContain('data-hub-bag-preparation');
    expect(source).not.toContain('bag_reference_scan');
  });
});
