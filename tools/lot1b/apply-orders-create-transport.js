'use strict';

const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
}

function write(rel, content) {
  fs.writeFileSync(path.resolve(process.cwd(), rel), content, 'utf8');
}

function replaceOnce(source, oldText, newText, label) {
  const first = source.indexOf(oldText);
  if (first < 0) throw new Error(`${label}: motif introuvable`);
  if (source.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error(`${label}: motif non unique`);
  }
  return source.slice(0, first) + newText + source.slice(first + oldText.length);
}

function patchCreate() {
  const rel = 'routes/orders/create.js';
  let s = read(rel);

  s = replaceOnce(
    s,
    "const { quoteTransportPriceForOrder, TransportPricingError } = require('../../services/transport-pricing');",
    "const { quoteTransportForOrder, TransportPricingError } = require('../../services/transport-pricing');",
    'import transport'
  );

  s = replaceOnce(
    s,
    '      maxQty, fretPerKg, aedFallback, customsPct, cashTimeout,\n      seaKmfPerKgCommercial, airKmfPerKgTaxable, airVolumetricDivisor,',
    '      maxQty, aedFallback, customsPct, cashTimeout,\n      seaWmKgPerM3, seaKmfPerKgCommercial, seaEurPerM3Cost, airKmfPerKgTaxable, airVolumetricDivisor,',
    'destructuring rules'
  );

  s = replaceOnce(s, "      getRule('FREIGHT_KMF_PER_KG', 65),\n", '', 'remove legacy freight rule');

  s = replaceOnce(
    s,
    "      getRule('CASH_PAYMENT_TIMEOUT_HOURS', 36),\n      // §8 — tarifs commerciaux transport (distincts du coût interne fretPerKg)",
    "      getRule('CASH_PAYMENT_TIMEOUT_HOURS', 36),\n      getRule('SEA_WM_KG_PER_M3', null),\n      // LOT 1B-1 — coût et prix transport ont des policies distinctes.\n      // Aucune constante économique inventée : migration 124 doit fournir le coût SEA.\n",
    'insert SEA W/M policy'
  );

  s = replaceOnce(
    s,
    "      getRule('SEA_KMF_PER_KG_COMMERCIAL', 65),\n      getRule('AIR_KMF_PER_KG_TAXABLE', 2500),",
    "      getRule('SEA_KMF_PER_KG_COMMERCIAL', 65),\n      getRule('SEA_EUR_PER_M3_COST', null),\n      getRule('AIR_KMF_PER_KG_TAXABLE', 2500),",
    'insert SEA cost policy'
  );

  s = replaceOnce(
    s,
    '    const transportRates = {\n      SEA_KMF_PER_KG_COMMERCIAL: seaKmfPerKgCommercial,\n      AIR_KMF_PER_KG_TAXABLE: airKmfPerKgTaxable,',
    '    const transportRates = {\n      SEA_WM_KG_PER_M3: seaWmKgPerM3,\n      SEA_EUR_PER_M3_COST: seaEurPerM3Cost,\n      SEA_KMF_PER_KG_COMMERCIAL: seaKmfPerKgCommercial,\n      EUR_KMF: eurKmfFinal,\n      AIR_KMF_PER_KG_TAXABLE: airKmfPerKgTaxable,',
    'transport rates'
  );

  s = replaceOnce(
    s,
    '      const fret_kmf = (product.weight_kg || 0.5) * qty * fretPerKg;\n',
    '',
    'remove legacy freight calculation'
  );

  s = replaceOnce(
    s,
    '      cost_estimated += base_aed_kmf + fret_kmf + customs_est;',
    '      cost_estimated += base_aed_kmf + customs_est;',
    'remove freight from legacy cost estimate'
  );

  s = replaceOnce(
    s,
    '    let transport_price_kmf = 0;',
    '    let transport_price_kmf = 0;\n    let transport_cost_kmf = 0;',
    'transport cost variable'
  );

  s = replaceOnce(
    s,
    '      const transportQuote = quoteTransportPriceForOrder({',
    '      const transportQuote = quoteTransportForOrder({',
    'combined quote call'
  );

  s = replaceOnce(
    s,
    '      transport_price_kmf = transportQuote.transport_price_kmf;',
    '      transport_price_kmf = transportQuote.transport_price_kmf;\n      transport_cost_kmf = transportQuote.transport_cost_kmf;',
    'read combined quote'
  );

  s = replaceOnce(
    s,
    '    total_kmf += transport_price_kmf;',
    '    total_kmf += transport_price_kmf;\n    cost_estimated += transport_cost_kmf;',
    'apply transport cost'
  );

  write(rel, s);
  console.log(`✓ ${rel} patched`);
}

function patchTests() {
  const rel = 'tests/unit/orders-create-route.test.js';
  let s = read(rel);
  const oldText = "  getRule.mockImplementation((key, fallback) => Promise.resolve(fallback));";
  const newText = [
    '  getRule.mockImplementation((key, fallback) => Promise.resolve(({',
    '    SEA_WM_KG_PER_M3: 1000,',
    '    SEA_EUR_PER_M3_COST: 180,',
    '  })[key] ?? fallback));',
  ].join('\n');
  s = replaceOnce(s, oldText, newText, 'default getRule mock');
  write(rel, s);
  console.log(`✓ ${rel} patched`);
}

try {
  patchCreate();
  patchTests();
  console.log('✓ LOT 1B-1 orders/create codemod complete');
} catch (err) {
  console.error(`✗ CODemod aborted: ${err.message}`);
  process.exit(2);
}
