'use strict';
const ws = require('../../public/dashboards/canonical/js/finance-journal-workspace.js');

describe('finance-journal-workspace', () => {
  test('endpoint borné au marché, filtres encodés', () => {
    expect(ws.endpointFor('km', 'summary', { from: '2026-10-01' })).toBe('/api/admin/workspaces/accounting/market/KM/journal/summary?from=2026-10-01');
  });
  test('marché invalide refusé', () => {
    expect(() => ws.endpointFor('../x', 'summary')).toThrow('canonical_accounting_journal_market_required');
  });
  test('onglets : Synthèse, Journal, Rapprochements, Pièces puis Cash & dépôts', () => {
    expect(ws.TABS.map(t => t.label)).toEqual(['Synthèse', 'Journal', 'Rapprochements', 'Pièces justificatives', 'Cash & dépôts']);
  });
});
