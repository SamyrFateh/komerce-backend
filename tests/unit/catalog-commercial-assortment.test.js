'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const assortment = require('../../services/catalog-commercial-assortment');

test('projection commerciale conserve UNKNOWN au lieu de fabriquer zéro', () => {
  expect(assortment.projectRow({
    product_ref:'KPR-1',
    name:'Produit',
    price_kmf:null,
    price_aed:null,
    stock:null,
    is_active:true,
    is_available:true,
    needs_review:false,
    approved_markets:['KM'],
    source_lots:['KIR-000004'],
  })).toMatchObject({
    product_ref:'KPR-1',
    price_kmf:null,
    price_aed:null,
    stock:null,
    approved_markets:['KM'],
    source_lots:['KIR-000004'],
  });
});

test('assortiment exige KIR clos et approbation vente exposition + LOCAL_ACTIVE', async () => {
  const executor = {
    query: jest.fn().mockResolvedValue({ rows:[{
      product_ref:'KPR-1',
      name:'Produit',
      category:'Maison',
      is_active:true,
      is_available:true,
      lifecycle_status:'active',
      needs_review:false,
      approved_markets:['KM'],
      source_lots:['KIR-000004'],
    }] }),
  };

  const rows = await assortment.listCommercialAssortment({ search:'Prod', category:'Maison', limit:50 }, executor);
  expect(rows).toHaveLength(1);
  const [sql, params] = executor.query.mock.calls[0];
  const text = String(sql);
  expect(text).toContain("pt.run_status = 'COMPLETED'");
  expect(text).toContain("pme.commercial_exposure = 'ENABLED'");
  expect(text).toContain("pp.status = 'LOCAL_ACTIVE'");
  expect(text).toContain("pme.commercial_exposure = 'DISABLED'");
  expect(text).toContain("HAVING COUNT(pt.product_id) = COUNT(pt.product_id) FILTER");
  expect(text).toContain("COALESCE(NULLIF(pt.intake->>'quarantined','')::int, 0) = 0");
  expect(text).toContain("p.is_active = TRUE");
  expect(text).toContain("p.lifecycle_status = 'active'");
  expect(params).toEqual(['%Prod%', 'Maison', 50]);
});

test('assortiment global n’écrit jamais', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'catalog-commercial-assortment.js'), 'utf8');
  expect(source).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b\s+(?:INTO|FROM|products|product_)/i);
});
