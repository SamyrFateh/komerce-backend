/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const ws = require('../../public/dashboards/canonical/js/finance-journal-workspace.js');

describe('finance-journal-workspace', () => {
  test('endpoint borné au marché, filtres encodés', () => {
    expect(ws.endpointFor('km', 'summary', { from: '2026-10-01' })).toBe('/api/admin/workspaces/accounting/market/KM/journal/summary?from=2026-10-01');
  });
  test('marché invalide refusé', () => {
    expect(() => ws.endpointFor('../x', 'summary')).toThrow('canonical_accounting_journal_market_required');
  });
  test('onglets : Synthèse, Journal, Rapprochements, Pièces justificatives, Garde des espèces & dépôts (réception des dépôts par le responsable marché)', () => {
    expect(ws.TABS.map(t => t.label)).toEqual(['Synthèse', 'Journal', 'Rapprochements', 'Pièces justificatives', 'Garde des espèces & dépôts']);
  });
});


test('B4 : poste réservé à Finance, écrit uniquement le fait via la route autorisée',async()=>{
  const make=tag=>({tag,children:[],style:{},listeners:{},appendChild(n){this.children.push(n);return n;},replaceChildren(){this.children=[];},setAttribute(){},addEventListener(k,f){this.listeners[k]=f;}});
  const root=make('div'),doc={createElement:make};
  const payload={payments:[{id:'p1',purchase_order_id:'po1',supplier_name:'Fournisseur',payment_ref:'PAY1',currency:'USD',expected_amount:'12.00',recorded_amount:'0',commitment_proof:'C',authorization_proof:'A',can_record:true},{id:'p2',supplier_name:'Non autorisé',currency:'USD',expected_amount:'12',recorded_amount:'0',can_record:false}],pagination:{total:2}};
  const fetch=jest.fn(async()=>({ok:true,json:async()=>payload}));
  await ws.mountSupplierPayments({root,document:doc,fetch,user:{role:'admin'}});expect(fetch).not.toHaveBeenCalled();
  await ws.mountSupplierPayments({root,document:doc,fetch,user:{role:'finance'}});
  const walk=n=>[n,...n.children.flatMap(walk)];
  const forms=walk(root).filter(n=>n.tag==='form');expect(forms).toHaveLength(1);
  const fields=Object.fromEntries(walk(forms[0]).filter(n=>n.name).map(n=>[n.name,n]));
  Object.entries({kind:'payment',amount_currency:'12.00',debit_currency:'AED',debit_amount:'45.00',fee_currency:'EUR',fee_amount:'2',debit_at:'2026-11-27T10:00:00Z',proof_ref:'BANK-1'}).forEach(([k,v])=>fields[k].value=v);
  await forms[0].listeners.submit({preventDefault(){}});
  expect(fetch.mock.calls[1][0]).toBe('/api/purchasing/supplier-payments/p1/finance-settlements');
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({kind:'payment',currency:'USD',amount_currency:'12.00',debit_currency:'AED',debit_amount:'45.00',fee_currency:'EUR',fee_amount:'2',debit_at:'2026-11-27T10:00:00Z',proof_ref:'BANK-1',idempotency_key:'finance-ui:BANK-1'});
});
