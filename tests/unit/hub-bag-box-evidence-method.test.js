/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs = require('fs');
const path = require('path');
const bagBox = require('../../services/hub-bag-box-service');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = {
  bagUnitId: id(1), boxUnitId: id(2), parcelId: id(3), expectedMarketId: id(4), actorId: id(5),
  bagReferenceScan: 'SAC-1', boxReferenceScan: 'BOX-1',
};

describe('Hub sac -> KOM-BOX : provenance explicite (#3900 P0-2)', () => {
  test.each([
    [{}, 'HUB_BAG_EVIDENCE_METHOD_REQUIRED'],
    [{ evidenceMethod: 'KEYBOARD' }, 'HUB_BAG_EVIDENCE_METHOD_REQUIRED'],
    [{ evidenceMethod: 'MANUAL' }, 'HUB_BAG_MANUAL_EVIDENCE_REQUIRED'],
    [{ evidenceMethod: 'MANUAL', evidenceRef: 'court' }, 'HUB_BAG_MANUAL_EVIDENCE_REQUIRED'],
    [{ evidenceMethod: 'SCAN', evidenceRef: 'justification inutile' }, 'HUB_BAG_SCAN_EVIDENCE_REF_FORBIDDEN'],
  ])('refuse %j avant toute écriture', async (extra, code) => {
    await expect(bagBox.attachBagToBox({ ...base, ...extra })).rejects.toMatchObject({ code });
  });

  test('route et interface transmettent la provenance, jamais un SCAN présumé', () => {
    const route = fs.readFileSync(path.join(__dirname, '../../routes/admin-operations-workspace.js'), 'utf8');
    const ui = fs.readFileSync(path.join(__dirname,
      '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
    expect(route).toContain('evidenceMethod: body.evidence_method, evidenceRef: body.evidence_ref');
    expect(route).not.toContain('HUB_BAG_MANUAL_APPROVAL_REQUIRED');
    expect(route).toContain('evidence_method:body.evidence_method');
    expect(ui).toContain("data-hub-box-evidence-method");
    expect(ui).toContain("data-hub-box-manual-proof");
    expect(ui).toContain("{evidence_method:'MANUAL',evidence_ref:boxProofRef}:{evidence_method:'SCAN'}");
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
