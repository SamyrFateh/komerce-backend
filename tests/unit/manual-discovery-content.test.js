'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @feature providers-services
 */

const mockQuery = jest.fn();
const mockCreateProduct = jest.fn();
const mockUpdateProduct = jest.fn();
const mockSetLocalStock = jest.fn();
const mockSetLocalStockExposure = jest.fn();

jest.mock('../../db', () => ({
  query: (...args) => mockQuery(...args),
  pool: { end: jest.fn() },
}));

jest.mock('../../services/product-admin-service', () => ({
  createProduct: (...args) => mockCreateProduct(...args),
  updateProduct: (...args) => mockUpdateProduct(...args),
}));

jest.mock('../../services/local-stock-service', () => ({
  setLocalStock: (...args) => mockSetLocalStock(...args),
  setLocalStockExposure: (...args) => mockSetLocalStockExposure(...args),
}));

const {
  MAX_DISCOVERY_CANDIDATES,
  validateManifest,
  candidateToken,
  buildCandidateString,
  catalogPayload,
  applyManualDiscoveryContent,
} = require('../../scripts/apply-manual-discovery-content');

const PRODUCT_ID = '10000000-0000-4000-8000-000000000001';
const MARKET_ID = '20000000-0000-4000-8000-000000000001';
const PROVIDER_ID = '30000000-0000-4000-8000-000000000001';
const OFFER_ID = '40000000-0000-4000-8000-000000000001';
const SERVICE_ID = '50000000-0000-4000-8000-000000000001';

function manifest() {
  return {
    market: 'KM',
    catalog_products: [{
      product_ref: 'MANUAL-CLIM-001',
      name: 'Climatiseur 12000 BTU',
      description: 'Produit catalogue',
      category: 'Tech',
      price_kmf: 185000,
      image_url: '/clim.webp',
      is_active: true,
      is_available: true,
      local_stock: { location: 'KM_MAIN', qty_physical: 4, expose: true },
      discovery: { categories: ['Tech'], order: 10 },
    }],
    providers: [{
      id: PROVIDER_ID,
      name: 'Atelier Mutsamudu',
      phone: '+269000000101',
      status: 'active',
    }],
    local_products: [{
      id: OFFER_ID,
      provider_id: PROVIDER_ID,
      title: 'Ciment 32,5R',
      description: 'Produit local tiers',
      zone: 'Mutsamudu',
      image_ref: '/ciment.webp',
      status: 'active',
      expose: true,
      discovery: { categories: ['Maison', 'Bricolage'], order: 20 },
    }],
    services: [{
      id: SERVICE_ID,
      provider_id: PROVIDER_ID,
      title: 'Installation climatiseur',
      description: 'Service local',
      zone: 'Mutsamudu',
      image_ref: '/installation.webp',
      status: 'active',
      expose: true,
      discovery: { categories: ['Tech', 'Bricolage'], order: 30 },
    }],
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockCreateProduct.mockReset();
  mockUpdateProduct.mockReset();
  mockSetLocalStock.mockReset();
  mockSetLocalStockExposure.mockReset();
});

test('valide les trois familles sans les confondre', () => {
  const result = validateManifest(manifest());
  expect(result.ok).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.summary).toEqual({
    catalog_products: 1,
    providers: 1,
    local_products: 1,
    services: 1,
    discovery_candidates: 3,
  });
});

test('refuse une exposition locale qui ne porte pas sa vérité source', () => {
  const input = manifest();
  input.services[0].expose = false;
  input.local_products[0].status = 'draft';
  input.catalog_products[0].local_stock.expose = false;
  const result = validateManifest(input);
  expect(result.ok).toBe(false);
  expect(result.errors.join('\n')).toContain('local_stock.expose=true');
  expect(result.errors.join('\n')).toContain('status=active et expose=true');
});

test('refuse une politique Discovery ambiguë ou au-delà du cap runtime', () => {
  const input = manifest();
  input.services[0].discovery.order = 20;
  let result = validateManifest(input);
  expect(result.ok).toBe(false);
  expect(result.errors.join('\n')).toContain('order=20 est dupliqué');

  const tooMany = manifest();
  tooMany.services = Array.from({ length: MAX_DISCOVERY_CANDIDATES }, (_, index) => ({
    id: `60000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    provider_id: PROVIDER_ID,
    title: `Service ${index + 1}`,
    status: 'active',
    expose: true,
    discovery: { categories: ['Tech'], order: 100 + index },
  }));
  result = validateManifest(tooMany);
  expect(result.ok).toBe(false);
  expect(result.errors.join('\n')).toContain(`maximum runtime=${MAX_DISCOVERY_CANDIDATES}`);
});

test('la projection candidate ne contient que kind/ref/contexte et respecte ordre', () => {
  expect(candidateToken({ kind: 'service', id: SERVICE_ID, categories: ['Tech', 'Bricolage'] }))
    .toBe(`service:${SERVICE_ID}@Tech|Bricolage`);

  const value = buildCandidateString([
    { kind: 'service', id: SERVICE_ID, categories: ['Tech'], order: 30 },
    { kind: 'product', id: PRODUCT_ID, categories: ['Tech'], order: 10 },
    { kind: 'physical_offer', id: OFFER_ID, categories: ['Maison'], order: 20 },
  ]);
  expect(value).toBe(
    `product:${PRODUCT_ID}@Tech,physical_offer:${OFFER_ID}@Maison,service:${SERVICE_ID}@Tech`
  );
});

test('catalogPayload exclut local_stock et discovery de la vérité Product', () => {
  const payload = catalogPayload(manifest().catalog_products[0]);
  expect(payload.product_ref).toBe('MANUAL-CLIM-001');
  expect(payload.local_stock).toBeUndefined();
  expect(payload.discovery).toBeUndefined();
});

test('apply écrit chaque famille chez son owner puis produit seulement la politique de rail', async () => {
  mockQuery.mockImplementation(async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM markets WHERE code')) return { rows: [{ id: MARKET_ID }] };
    if (text.includes('FROM boutique_categories')) {
      return { rows: ['Tech', 'Maison', 'Bricolage'].map(key => ({ key })) };
    }
    if (text.includes('INSERT INTO providers')) {
      return { rows: [{ id: params[0], name: params[1], phone: params[2], market_id: params[3], status: params[4] }] };
    }
    if (text.includes('SELECT id FROM products WHERE product_ref')) return { rows: [] };
    if (text.includes('INSERT INTO physical_offers')) {
      return { rows: [{ id: params[0], provider_id: params[1], title: params[2] }] };
    }
    if (text.includes('INSERT INTO services')) {
      return { rows: [{ id: params[0], provider_id: params[1], title: params[2] }] };
    }
    throw new Error(`SQL inattendu: ${text}`);
  });

  mockCreateProduct.mockResolvedValue({
    status: 201,
    body: { id: PRODUCT_ID, product_ref: 'MANUAL-CLIM-001', name: 'Climatiseur 12000 BTU' },
  });
  mockSetLocalStock.mockResolvedValue({ id: 'stock-1' });
  mockSetLocalStockExposure.mockResolvedValue({ id: 'stock-1', commercial_exposure: 'ENABLED' });

  const result = await applyManualDiscoveryContent(manifest());

  expect(mockCreateProduct).toHaveBeenCalledTimes(1);
  expect(mockUpdateProduct).not.toHaveBeenCalled();
  expect(mockSetLocalStock).toHaveBeenCalledWith({
    productId: PRODUCT_ID,
    marketId: MARKET_ID,
    location: 'KM_MAIN',
    qtyPhysical: 4,
  });
  expect(mockSetLocalStockExposure).toHaveBeenCalledWith(
    PRODUCT_ID, MARKET_ID, 'ENABLED', 'KM_MAIN'
  );

  const sqlCalls = mockQuery.mock.calls.map(call => String(call[0]));
  expect(sqlCalls.some(sql => sql.includes('INSERT INTO providers'))).toBe(true);
  expect(sqlCalls.some(sql => sql.includes('INSERT INTO physical_offers'))).toBe(true);
  expect(sqlCalls.some(sql => sql.includes('INSERT INTO services'))).toBe(true);
  expect(sqlCalls.some(sql => /INSERT INTO\s+products/i.test(sql))).toBe(false);

  expect(result.discovery_candidates).toBe(
    `product:${PRODUCT_ID}@Tech,physical_offer:${OFFER_ID}@Maison|Bricolage,service:${SERVICE_ID}@Tech|Bricolage`
  );
});
