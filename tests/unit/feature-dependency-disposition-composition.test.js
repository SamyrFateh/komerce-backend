'use strict';
const { classifyPair } = require('../../scripts/lib/feature-dependency-disposition');

const ctx = {
  kindOf: name => ({ 'platform-ops': 'technical-transversal', catalog: 'business-feature', auth: 'technical-transversal' }[name]),
  compRootOwners: new Set(['platform-ops']),
  wiringFiles: new Set(['public/boutique/js/main.js']),
};

test('mixed composition and interface uses non-wiring evidence', () => {
  const pair = { from: 'platform-ops', to: 'catalog', conformanceStatus: 'OBSERVED_UNDECLARED', channels: [
    { channel: 'static-code', evidence: [{ sourceFileId: 'public/boutique/js/main.js', targetFile: 'public/boutique/js/b-catalog.js' }] },
    { channel: 'interface', evidence: [{ consumerFileId: 'public/boutique/js/komerce-api.js', endpoint: '/api/products' }] },
  ] };
  expect(classifyPair(pair, ctx).family).toBe('BUSINESS_FEATURE_INTERFACE');
});

test('pure composition remains composition wiring', () => {
  const pair = { from: 'platform-ops', to: 'catalog', conformanceStatus: 'OBSERVED_UNDECLARED', channels: [
    { channel: 'static-code', evidence: [{ sourceFileId: 'public/boutique/js/main.js', targetFile: 'public/boutique/js/b-catalog.js' }] },
  ] };
  expect(classifyPair(pair, ctx).family).toBe('COMPOSITION_ROOT_WIRING');
});

test('non-wiring technical dependency remains technical', () => {
  const pair = { from: 'platform-ops', to: 'auth', conformanceStatus: 'OBSERVED_UNDECLARED', channels: [
    { channel: 'static-code', evidence: [{ sourceFileId: 'routes/health.js', targetFile: 'middleware/auth.js' }] },
  ] };
  expect(classifyPair(pair, ctx).family).toBe('TECHNICAL_PRIMITIVE');
});
