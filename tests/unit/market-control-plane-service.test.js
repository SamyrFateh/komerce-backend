'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const { GAP_MESSAGES, computeGaps, readinessFromGaps, getControlPlane, listMarkets } = require('../../services/market-control-plane');

const healthy = () => ({
  market: { id: 'm1', code: 'KM', is_active: true, lifecycle_status:'ACTIVE' },
  assignment: { id: 'a1', status: 'ACTIVE', central_referent_user_id:'central-u' },
  ceiling: [
    { capability:'team.grant', amount_bearing:false, limit_amount:null },
    { capability:'finance.act', amount_bearing:true, limit_amount:1000 },
  ],
  team: [{ membership_id: 'x', user_id: 'u', is_operating_lead:true, capabilities: ['team.grant'] }],
  paymentProviders: [{ provider: 'orange_money', is_enabled: true }],
  cashPolicy: { cash_enabled: true, confirmation_mode: 'SINGLE' },
  relaisActive: 2,
  deliveryProof: { proven: true, basis: 'ATTESTATION' },
});

const codes = snapshot => computeGaps(snapshot).map(gap => gap.code);

describe('computeGaps — rapport d’écarts du Control Plane', () => {
  test('un marché complet n’a aucun écart', () => {
    expect(codes(healthy())).toEqual([]);
  });

  test('marché inactif sans affectation', () => {
    const s = healthy();
    s.market.is_active = false;
    s.assignment = null;
    expect(codes(s)).toEqual(['MARKET_INACTIVE', 'NO_ASSIGNMENT']);
  });

  test('affectation non ACTIVE, plafond vide, équipe absente', () => {
    const s = healthy();
    s.assignment.status = 'DRAFT';
    s.ceiling = [];
    s.team = [];
    expect(codes(s)).toEqual(['ASSIGNMENT_NOT_ACTIVE', 'EMPTY_CEILING', 'NO_ACTIVE_MEMBERSHIP']);
  });

  test('équipe sans team.grant : verrouillage local signalé', () => {
    const s = healthy();
    s.team[0].capabilities = ['network.read'];
    expect(codes(s)).toEqual(['NO_TEAM_GRANT_HOLDER']);
  });

  test('paiement, caisse et relais manquants', () => {
    const s = healthy();
    s.paymentProviders = [{ provider: 'mtn_momo', is_enabled: false }];
    s.cashPolicy = null;
    s.relaisActive = 0;
    expect(codes(s)).toEqual(['NO_PAYMENT_PROVIDER', 'NO_CASH_POLICY', 'NO_RELAIS']);
  });

  test('cash seul explicitement activé : aucun PSP imposé', () => {
    const s = healthy();
    s.market.lifecycle_status = 'PROVISIONING';
    s.market.is_active = false;
    s.paymentProviders = [];
    expect(codes(s)).toEqual(['MARKET_INACTIVE']);
    expect(readinessFromGaps(computeGaps(s)).ready_for_activation).toBe(true);
    s.cashPolicy.cash_enabled = false;
    expect(codes(s)).toContain('NO_PAYMENT_PROVIDER');
    expect(readinessFromGaps(computeGaps(s)).ready_for_activation).toBe(false);
  });

  test('un moyen central disponible suffit sans cash ; non configuré ne suffit pas', () => {
    const s = healthy();
    s.cashPolicy.cash_enabled = false;
    s.paymentProviders = [];
    s.paymentAvailability = [{mode:'stripe_eur',ready:true}];
    expect(codes(s)).not.toContain('NO_PAYMENT_PROVIDER');
    s.paymentAvailability[0].ready = false;
    expect(codes(s)).toContain('NO_PAYMENT_PROVIDER');
  });

  test('relais actif suffit : aucune attestation ni livraison historique obligatoire', () => {
    const s = healthy();
    s.deliveryProof = { proven: false, basis: null };
    expect(codes(s)).toEqual([]);
    expect(readinessFromGaps(computeGaps(s)).ready_for_activation).toBe(true);
    delete s.deliveryProof;
    expect(codes(s)).toEqual([]);
    s.relaisActive = 0;
    expect(codes(s)).toEqual(['NO_RELAIS']);
    expect(readinessFromGaps(computeGaps(s)).ready_for_activation).toBe(false);
  });

  test('chaque écart porte son message', () => {
    for (const gap of computeGaps({ ...healthy(), assignment: null, cashPolicy: null })) {
      expect(gap.message).toBe(GAP_MESSAGES[gap.code]);
    }
  });
});

describe('computeGaps — parité de devise (lot 8)', () => {
  test('devise sans parité canonique → écart plate-forme bloquant, message dédié', () => {
    const s = healthy();
    s.market.has_currency_parity = false;
    expect(codes(s)).toEqual(['NO_CURRENCY_PARITY']);
    const readiness = readinessFromGaps(computeGaps(s));
    expect(readiness.platform.blockers.map(g => g.code)).toEqual(['NO_CURRENCY_PARITY']);
    expect(readiness.ready_for_activation).toBe(false);
    expect(GAP_MESSAGES.NO_CURRENCY_PARITY).toMatch(/parité canonique/);
  });

  test('parité présente ou information absente → aucun écart fabriqué', () => {
    const present = healthy();
    present.market.has_currency_parity = true;
    expect(codes(present)).toEqual([]);
    expect(codes(healthy())).toEqual([]);
  });
});

describe('getControlPlane / listMarkets — lecture seule', () => {
  function fakeDb(plan) {
    const calls = [];
    return {
      calls,
      query: async (sql, params) => {
        calls.push(sql);
        const hit = plan.find(([needle]) => sql.includes(needle));
        return { rows: hit ? hit[1] : [] };
      },
    };
  }

  test('code invalide : 400 sans requête', async () => {
    const db = fakeDb([]);
    await expect(getControlPlane(db, 'KMF')).rejects.toMatchObject({ code: 'MARKET_CODE_INVALID', status: 400 });
    expect(db.calls).toHaveLength(0);
  });

  test('marché inconnu : 404', async () => {
    await expect(getControlPlane(fakeDb([]), 'zz')).rejects.toMatchObject({ code: 'MARKET_NOT_FOUND', status: 404 });
  });

  test('marché sans affectation : vue partielle et écarts', async () => {
    const db = fakeDb([
      ['FROM markets WHERE code', [{ id: 'm1', code: 'CG', name: 'Congo', currency: 'XAF', minor_unit: 0, is_active: false, lifecycle_status:'PROVISIONING' }]],
      ['FROM relais', [{ n: 0 }]],
      ['FROM currency_parities WHERE currency', [{rate:'655.957',updated_at:null}]],
    ]);
    const view = await getControlPlane(db, ' cg ');
    expect(view.assignment).toBeNull();
    expect(view.team).toEqual([]);
    expect(view.gaps.map(gap => gap.code)).toEqual(
      ['MARKET_INACTIVE', 'NO_ASSIGNMENT', 'NO_PAYMENT_PROVIDER', 'NO_CASH_POLICY', 'NO_RELAIS']
    );
  });

  test('marché complet : équipe et plafond lus, aucun écart, aucune écriture', async () => {
    const db = fakeDb([
      ['FROM markets WHERE code', [{ id: 'm1', code: 'KM', name: 'Comores', currency: 'KMF', minor_unit: 0, is_active: true, lifecycle_status:'ACTIVE' }]],
      ['FROM market_operating_assignments', [{ id: 'a1', status: 'ACTIVE', central_referent_user_id:'central-u' }]],
      ['FROM assignment_capability_ceiling', [{ capability: 'team.grant', amount_bearing:false, limit_amount:null }]],
      ['FROM assignment_memberships', [{ membership_id: 'x', user_id: 'u', is_operating_lead:true, capabilities: ['team.grant'] }]],
      ['FROM market_payment_providers', [{ provider: 'orange_money', currency: 'KMF', is_enabled: true, priority: 1 }]],
      ['FROM market_cash_control_policies', [{ cash_enabled: true, confirmation_mode: 'SINGLE' }]],
      ['FROM relais', [{ n: 3 }]],
      ['FROM currency_parities WHERE currency', [{rate:'491.96775',updated_at:null}]],
      ['FROM market_delivery_attestations', [{ id: 'att1', mode: 'SEA', origin_ref: 'DXB', freight_rate: '2.5', rate_currency: 'USD', rate_unit: 'PER_KG', transit_days: 30, evidence_ref: 'CONTRAT-1', attested_at: 'x', valid_until: 'y', carrier_name: 'C' }]],
    ]);
    const view = await getControlPlane(db, 'KM');
    expect(Object.keys(view).sort()).toEqual(
      ['assignment', 'carriers', 'cashPolicy', 'ceiling', 'centralCollectionModes', 'deliveryProof', 'gaps', 'market', 'paymentAvailability', 'paymentProviders', 'readiness', 'relaisActive', 'team']
    );
    expect(view.carriers).toEqual([]);
    expect(view.gaps).toEqual([]);
    expect(view.team[0].capabilities).toEqual(['team.grant']);
    expect(view.readiness.ready_for_activation).toBe(true);
    expect(db.calls.every(sql => /^\s*SELECT/i.test(sql))).toBe(true);
  });

  test('listMarkets exige un exécuteur et ne fait que lire', async () => {
    await expect(listMarkets(null)).rejects.toMatchObject({ code: 'EXECUTOR_REQUIRED' });
    const db = fakeDb([['FROM markets m', [{ code: 'KM' }]]]);
    expect(await listMarkets(db)).toEqual([{ code: 'KM' }]);
    expect(db.calls.every(sql => /^\s*SELECT/i.test(sql))).toBe(true);
  });
});

test('checklist preparation is never exposed without scoped team-read membership',async()=>{
  const { getPreparationChecklist } = require('../../services/market-control-plane');
  const db = {query:jest.fn()};
  await expect(getPreparationChecklist(db,{lifecycle_status:'ACTIVE',membership_id:'mem',capabilities:['team.read']})).resolves.toBeNull();
  await expect(getPreparationChecklist(db,{lifecycle_status:'PROVISIONING',membership_id:'mem',capabilities:['network.read']})).resolves.toBeNull();
  expect(db.query).not.toHaveBeenCalled();
});

test('economic template readiness uses exact center/family pairs, not total count',async()=>{
  const {getCostReferenceReadiness}=require('../../services/economic-cost-reference-service');
  const id='11111111-1111-4111-8111-111111111111';
  const rows=[
    ...['PERSONNEL','LOCAUX','EQUIPEMENTS','CONSOMMABLES'].map(family_code=>({center_code:'RELAIS_LOCAL',family_code})),
    ...['TRANSPORT','DOUANE','LIVRAISON'].map(family_code=>({center_code:'TRANSPORT_DOUANE',family_code})),
    ...['SERVICES','ADMINISTRATION'].map(family_code=>({center_code:'SERVICES_MARCHE',family_code})),
  ];
  const db={query:jest.fn().mockResolvedValue({rows})};
  await expect(getCostReferenceReadiness(db,id)).resolves.toEqual({ready:true,missing:[]});
  expect(db.query.mock.calls[0][1]).toEqual([id]);
  db.query.mockResolvedValue({rows:rows.map(row=>row.family_code==='LIVRAISON'?{...row,family_code:'OTHER'}:row)});
  await expect(getCostReferenceReadiness(db,id)).resolves.toEqual({ready:false,missing:['Transport et douane — Livraison locale']});
});

test('initialized first opening requires delivery, positive prepared price and canonical references',()=>{
  const s=healthy();
  s.market.lifecycle_status='PROVISIONING';s.market.is_active=false;
  s.deliveryProof={proven:false};
  s.preparation={economic:{ready:false,missing:['Transport et douane — Livraison locale']},prices:{drafts:0,authorized:0,active:0}};
  expect(codes(s)).toEqual(['MARKET_INACTIVE','NO_DELIVERY_PROOF','NO_PREPARED_PRICE','NO_ECONOMIC_REFERENCES']);
  expect(readinessFromGaps(computeGaps(s)).ready_for_activation).toBe(false);
  expect(computeGaps(s).find(g=>g.code==='NO_ECONOMIC_REFERENCES').message).toContain('Livraison locale');
  s.deliveryProof={proven:true};
  s.preparation.economic={ready:true,missing:[]};
  s.preparation.prices.drafts=1;
  expect(readinessFromGaps(computeGaps(s)).ready_for_activation).toBe(true);
  s.market.lifecycle_status='SUSPENDED';s.market.is_active=true;
  s.deliveryProof={proven:false};s.preparation.prices.drafts=0;
  expect(codes(s)).toEqual([]);
});

test('FX readiness uses the canonical conversion, never a fabricated parity',async()=>{
  const {resolveCurrencyReadiness}=require('../../services/market-control-plane');
  const db={query:jest.fn().mockResolvedValue({rows:[]})};
  await expect(resolveCurrencyReadiness(db,'EUR',2)).resolves.toEqual({fx_ready:true,currency_unit_valid:true});
  expect(db.query).not.toHaveBeenCalled();
  await expect(resolveCurrencyReadiness(db,'XAF',0)).resolves.toMatchObject({fx_ready:false,currency_unit_valid:true,fx_reason:'fx_rate_unavailable'});
  db.query.mockResolvedValue({rows:[{rate:'655.957',updated_at:null}]});
  await expect(resolveCurrencyReadiness(db,'XAF',0)).resolves.toEqual({fx_ready:true,currency_unit_valid:true});
  await expect(resolveCurrencyReadiness(db,'XAF',2)).resolves.toEqual({fx_ready:true,currency_unit_valid:false});
  await expect(resolveCurrencyReadiness(db,'ZZZ',0)).resolves.toMatchObject({fx_ready:false,currency_unit_valid:false,fx_reason:'fx_currency_unsupported'});
  db.query.mockRejectedValue(new Error('database offline'));
  await expect(resolveCurrencyReadiness(db,'XAF',0)).rejects.toThrow('database offline');
});
test('canonical FX readiness prevails over historical fixed-parity presence',()=>{
  const s=healthy();s.market.lifecycle_status='PROVISIONING';s.market.has_currency_parity=false;s.market.fx_ready=true;s.market.currency_unit_valid=true;
  expect(codes(s)).not.toContain('NO_CURRENCY_PARITY');
  s.market.fx_ready=false;s.market.currency_unit_valid=false;s.market.has_currency_parity=true;
  expect(codes(s)).toEqual(expect.arrayContaining(['NO_CURRENCY_PARITY','INVALID_CURRENCY_UNIT']));
  expect(readinessFromGaps(computeGaps(s)).ready_for_activation).toBe(false);
});

test('first opening refuses missing explicit business timezone',()=>{
  const s=healthy();s.market.lifecycle_status='PROVISIONING';s.market.is_active=false;s.market.business_timezone=null;
  s.preparation={economic:{ready:true,missing:[]},prices:{drafts:1,authorized:0,active:0}};
  expect(codes(s)).toEqual(['MARKET_INACTIVE','NO_BUSINESS_TIMEZONE']);
  expect(readinessFromGaps(computeGaps(s)).ready_for_activation).toBe(false);
  s.market.business_timezone='Africa/Libreville';
  expect(readinessFromGaps(computeGaps(s)).ready_for_activation).toBe(true);
});
