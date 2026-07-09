'use strict';

/**
 * tests/unit/group-helpers.test.js
 *
 * Module js/group/group-helpers.js (263L) — helpers de calcul purs du panier
 * partagé (montants, statuts, fenêtres de paiement/règlement, liens
 * personnalisés). Documenté "testable unitairement sans setup" mais jamais
 * testé en direct : seulement exercé en chemin heureux, indirectement, via
 * tests/unit/group-render-creator.test.js. Aucune dépendance réseau/DOM/state
 * — import réel, aucun mock.
 */

const {
  r,
  pct,
  engagementCoverage,
  statusLabel,
  BUSINESS,
  businessStatusOf,
  paymentWindowEndsAt,
  isPaymentWindowOpen,
  metaOf,
  isSettlementOpen,
  remainingKmf,
  settlementExpiresAt,
  timeRemaining,
  getGroupStep,
  buildPersonalizedShareUrl,
  readPersonalizedParams,
} = require('../../js/group/group-helpers.js');

describe('r (arrondi tolérant)', () => {
  it('arrondit un nombre', () => {
    expect(r(4.4)).toBe(4);
    expect(r(4.5)).toBe(5);
  });
  it('tolère string numérique', () => {
    expect(r('12.6')).toBe(13);
  });
  it('retourne 0 pour null/undefined/NaN/chaîne invalide', () => {
    expect(r(null)).toBe(0);
    expect(r(undefined)).toBe(0);
    expect(r(NaN)).toBe(0);
    expect(r('abc')).toBe(0);
  });
});

describe('pct (pourcentage plafonné 0–100)', () => {
  it('calcule un pourcentage normal', () => {
    expect(pct(50, 200)).toBe(25);
  });
  it('retourne 0 si total est falsy (0, null, undefined)', () => {
    expect(pct(50, 0)).toBe(0);
    expect(pct(50, null)).toBe(0);
    expect(pct(50, undefined)).toBe(0);
  });
  it('plafonne à 100 même si confirmed > total', () => {
    expect(pct(500, 200)).toBe(100);
  });
  it('ne descend jamais sous 0 (confirmed négatif)', () => {
    expect(pct(-50, 200)).toBe(0);
  });
});

describe('engagementCoverage', () => {
  it('calcule pctCapped/pctRaw/engagementsTotal sur une liste normale', () => {
    const result = engagementCoverage([{ amount_kmf: 1000 }, { amount_kmf: 2000 }], 4000);
    expect(result).toEqual({ pctCapped: 75, pctRaw: 75, engagementsTotal: 3000 });
  });
  it('liste vide → tout à 0', () => {
    expect(engagementCoverage([], 1000)).toEqual({ pctCapped: 0, pctRaw: 0, engagementsTotal: 0 });
  });
  it('paramètres par défaut (aucun argument)', () => {
    expect(engagementCoverage()).toEqual({ pctCapped: 0, pctRaw: 0, engagementsTotal: 0 });
  });
  it('total falsy → pctCapped/pctRaw à 0 mais engagementsTotal quand même calculé', () => {
    const result = engagementCoverage([{ amount_kmf: 500 }], 0);
    expect(result).toEqual({ pctCapped: 0, pctRaw: 0, engagementsTotal: 500 });
  });
  it('sur-couverture : pctRaw dépasse 100, pctCapped plafonné', () => {
    const result = engagementCoverage([{ amount_kmf: 6000 }], 4000);
    expect(result.pctRaw).toBe(150);
    expect(result.pctCapped).toBe(100);
  });
  it('tolère des montants non numériques dans les engagements (via r())', () => {
    const result = engagementCoverage([{ amount_kmf: 'abc' }, { amount_kmf: 1000 }], 1000);
    expect(result.engagementsTotal).toBe(1000);
  });
});

describe('statusLabel', () => {
  it('paymentOpen=true écrase tout statut', () => {
    expect(statusLabel('cancelled', true)).toBe('Ouvert au paiement');
  });
  it.each([
    ['open', 'En préparation'],
    ['active', 'En préparation'],
    ['commitment_open', 'En préparation'],
    ['closed', 'Fermé'],
    ['awaiting_choice', 'Fermé'],
    ['partially_funded', 'Fermé'],
    ['fully_funded', 'Fermé'],
    ['closed_for_settlement', 'Fermé'],
    ['settlement_in_progress', 'Fermé'],
    ['ready_to_finalize', 'Fermé'],
    ['ordered', 'Finalisé'],
    ['converted_to_order', 'Finalisé'],
    ['finalized', 'Finalisé'],
    ['cancelled', 'Annulé'],
    ['refunded', 'Annulé'],
    ['expired', 'Indisponible'],
    ['archived', 'Indisponible'],
  ])('statut "%s" (paymentOpen=false) → "%s"', (status, expected) => {
    expect(statusLabel(status, false)).toBe(expected);
  });
  it('statut inconnu/brut retombe sur "Fermé" (jamais de statut technique exposé)', () => {
    expect(statusLabel('some_unknown_backend_status', false)).toBe('Fermé');
    expect(statusLabel(undefined, false)).toBe('Fermé');
  });
});

describe('businessStatusOf', () => {
  it.each([
    ['open', BUSINESS.OPEN],
    ['closed', BUSINESS.CLOSED],
    ['awaiting_choice', BUSINESS.AWAITING_CHOICE],
    ['ordered', BUSINESS.ORDERED],
    ['cancelled', BUSINESS.CANCELLED],
    ['refunded', BUSINESS.CANCELLED],
    ['expired', BUSINESS.EXPIRED],
    ['archived', BUSINESS.ARCHIVED],
  ])('statut direct "%s" → %s', (status, expected) => {
    expect(businessStatusOf({ status })).toBe(expected);
  });
  it.each([
    ['converted_to_order', BUSINESS.ORDERED],
    ['finalized', BUSINESS.ORDERED],
    ['closed_for_settlement', BUSINESS.CLOSED],
    ['settlement_in_progress', BUSINESS.CLOSED],
    ['partially_funded', BUSINESS.CLOSED],
    ['fully_funded', BUSINESS.CLOSED],
    ['ready_to_finalize', BUSINESS.CLOSED],
    ['draft', BUSINESS.OPEN],
    ['active', BUSINESS.OPEN],
    ['commitment_open', BUSINESS.OPEN],
  ])('statut legacy "%s" → %s (rétrocompatibilité)', (status, expected) => {
    expect(businessStatusOf({ status })).toBe(expected);
  });
  it('statut legacy inconnu + metadata.settlement_open=true → CLOSED', () => {
    expect(businessStatusOf({ status: 'some_legacy_thing', metadata: { settlement_open: true } })).toBe(BUSINESS.CLOSED);
  });
  it('statut totalement inconnu, sans signal metadata → null', () => {
    expect(businessStatusOf({ status: 'totally_unknown' })).toBeNull();
  });
  it('cart null/undefined/sans status → null', () => {
    expect(businessStatusOf(null)).toBeNull();
    expect(businessStatusOf(undefined)).toBeNull();
    expect(businessStatusOf({})).toBeNull();
  });
});

describe('paymentWindowEndsAt', () => {
  it('retourne une Date si payment_window_ends_at présent', () => {
    const result = paymentWindowEndsAt({ payment_window_ends_at: '2026-08-01T00:00:00Z' });
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });
  it('retourne null si absent ou cart null', () => {
    expect(paymentWindowEndsAt({})).toBeNull();
    expect(paymentWindowEndsAt(null)).toBeNull();
  });
});

describe('isPaymentWindowOpen', () => {
  it('false si le statut métier n\'est pas CLOSED', () => {
    expect(isPaymentWindowOpen({ status: 'open' })).toBe(false);
    expect(isPaymentWindowOpen({ status: 'ordered' })).toBe(false);
  });
  it('true si CLOSED et fenêtre future', () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect(isPaymentWindowOpen({ status: 'closed', payment_window_ends_at: future })).toBe(true);
  });
  it('false si CLOSED mais fenêtre expirée', () => {
    const past = new Date(Date.now() - 3_600_000).toISOString();
    expect(isPaymentWindowOpen({ status: 'closed', payment_window_ends_at: past })).toBe(false);
  });
  it('true si CLOSED et aucune date de fin (fenêtre illimitée)', () => {
    expect(isPaymentWindowOpen({ status: 'closed' })).toBe(true);
  });
});

describe('metaOf', () => {
  it('retourne {} si metadata absent', () => {
    expect(metaOf({})).toEqual({});
    expect(metaOf(null)).toEqual({});
  });
  it('retourne directement l\'objet si déjà objet', () => {
    expect(metaOf({ metadata: { a: 1 } })).toEqual({ a: 1 });
  });
  it('parse une string JSON valide', () => {
    expect(metaOf({ metadata: '{"a":1}' })).toEqual({ a: 1 });
  });
  it('retourne {} si string JSON invalide (ne throw pas)', () => {
    expect(metaOf({ metadata: '{invalid' })).toEqual({});
  });
});

describe('isSettlementOpen', () => {
  it('true seulement si statut métier CLOSED', () => {
    expect(isSettlementOpen({ status: 'closed' })).toBe(true);
    expect(isSettlementOpen({ status: 'open' })).toBe(false);
    expect(isSettlementOpen({ status: 'ordered' })).toBe(false);
  });
});

describe('remainingKmf', () => {
  it('utilise cart.remaining_kmf si fourni (source backend prioritaire)', () => {
    expect(remainingKmf({ remaining_kmf: 1500, total_kmf_snapshot: 5000, contributed_kmf: 2000 })).toBe(1500);
  });
  it('fallback total - confirmé si remaining_kmf absent', () => {
    expect(remainingKmf({ total_kmf_snapshot: 5000, contributed_kmf: 2000 })).toBe(3000);
  });
  it('ne renvoie jamais de valeur négative (confirmé > total)', () => {
    expect(remainingKmf({ total_kmf_snapshot: 1000, contributed_kmf: 3000 })).toBe(0);
  });
  it('remaining_kmf=0 tombe sur le fallback (falsy) plutôt que de rester à 0', () => {
    // Comportement documenté par le code : `r(cart.remaining_kmf) || total - confirmed`
    // → 0 étant falsy, le fallback est utilisé même si remaining_kmf vaut explicitement 0.
    expect(remainingKmf({ remaining_kmf: 0, total_kmf_snapshot: 5000, contributed_kmf: 2000 })).toBe(3000);
  });
});

describe('settlementExpiresAt', () => {
  it('retourne la date de fin si statut CLOSED', () => {
    const result = settlementExpiresAt({ status: 'closed', payment_window_ends_at: '2026-08-01T00:00:00Z' });
    expect(result).toBeInstanceOf(Date);
  });
  it('retourne null si statut métier différent de CLOSED', () => {
    expect(settlementExpiresAt({ status: 'open', payment_window_ends_at: '2026-08-01T00:00:00Z' })).toBeNull();
  });
});

describe('timeRemaining', () => {
  it('retourne null si expiresAt est falsy', () => {
    expect(timeRemaining(null)).toBeNull();
    expect(timeRemaining(undefined)).toBeNull();
  });
  it('"Expiré" si la date est passée', () => {
    expect(timeRemaining(new Date(Date.now() - 1000))).toBe('Expiré');
  });
  it('format en jours si >= 48h restantes', () => {
    expect(timeRemaining(new Date(Date.now() + 50 * 3_600_000))).toBe('2j restants');
  });
  it('format en heures+minutes si >= 1h et < 48h', () => {
    const result = timeRemaining(new Date(Date.now() + (2 * 3_600_000 + 30 * 60_000)));
    expect(result).toBe('2h30min restantes');
  });
  it('format heures sans minutes si minutes = 0', () => {
    const result = timeRemaining(new Date(Date.now() + 3_600_000 + 5000));
    expect(result).toBe('1h restantes');
  });
  it('format en minutes seules si < 1h', () => {
    const result = timeRemaining(new Date(Date.now() + 30 * 60_000));
    expect(result).toBe('30min restantes');
  });
  it('minimum 1min affiché même si < 1min restante', () => {
    const result = timeRemaining(new Date(Date.now() + 10_000));
    expect(result).toBe('1min restantes');
  });
});

describe('getGroupStep', () => {
  it('ORDER_CREATED si statut métier ORDERED', () => {
    expect(getGroupStep({ status: 'ordered' })).toBe('ORDER_CREATED');
  });
  it('ORDER_CREATED si finalized_order_id présent même sans statut ORDERED', () => {
    expect(getGroupStep({ status: 'open', finalized_order_id: 'ord_123' })).toBe('ORDER_CREATED');
  });
  it('CONFIRM si statut métier CLOSED', () => {
    expect(getGroupStep({ status: 'closed' })).toBe('CONFIRM');
  });
  it('CONFIRM si statut métier AWAITING_CHOICE', () => {
    expect(getGroupStep({ status: 'awaiting_choice' })).toBe('CONFIRM');
  });
  it('SHARE_AND_LOCK par défaut (statut open, sans finalized_order_id)', () => {
    expect(getGroupStep({ status: 'open' })).toBe('SHARE_AND_LOCK');
  });
});

describe('buildPersonalizedShareUrl', () => {
  const base = 'https://komerce.km/share/tok123';

  it('retourne baseUrl tel quel si falsy', () => {
    expect(buildPersonalizedShareUrl('')).toBe('');
    expect(buildPersonalizedShareUrl(null)).toBeNull();
  });
  it('ajoute who et amt quand fournis', () => {
    const url = buildPersonalizedShareUrl(base, { who: 'Ali', amt: 15000 });
    expect(url).toBe('https://komerce.km/share/tok123?who=Ali&amt=15000');
  });
  it('n\'ajoute pas who si vide/absent', () => {
    const url = buildPersonalizedShareUrl(base, { amt: 5000 });
    expect(url).not.toContain('who=');
  });
  it('n\'ajoute pas amt si 0 ou négatif', () => {
    expect(buildPersonalizedShareUrl(base, { amt: 0 })).not.toContain('amt=');
    expect(buildPersonalizedShareUrl(base, { amt: -100 })).not.toContain('amt=');
  });
  it('tronque who à 40 caractères', () => {
    const longName = 'a'.repeat(60);
    const url = buildPersonalizedShareUrl(base, { who: longName });
    expect(url).toContain(`who=${'a'.repeat(40)}`);
  });
  it('retourne baseUrl inchangé si baseUrl invalide (URL() throw)', () => {
    expect(buildPersonalizedShareUrl('not-a-valid-url', { who: 'Ali' })).toBe('not-a-valid-url');
  });
  it('opts par défaut ({}) ne throw pas', () => {
    expect(() => buildPersonalizedShareUrl(base)).not.toThrow();
  });
});

describe('readPersonalizedParams', () => {
  it('lit who et amt depuis une URL fournie', () => {
    const result = readPersonalizedParams('https://komerce.km/share/tok?who=Ali&amt=15000');
    expect(result).toEqual({ who: 'Ali', amt: 15000 });
  });
  it('who absent → null', () => {
    const result = readPersonalizedParams('https://komerce.km/share/tok?amt=1000');
    expect(result.who).toBeNull();
  });
  it('amt absent → null', () => {
    const result = readPersonalizedParams('https://komerce.km/share/tok?who=Ali');
    expect(result.amt).toBeNull();
  });
  it('amt=0 ou négatif → null (montant suggéré invalide ignoré)', () => {
    expect(readPersonalizedParams('https://komerce.km/share/tok?amt=0').amt).toBeNull();
  });
  it('who tronqué à 40 caractères et trim', () => {
    const longName = 'b'.repeat(60);
    const result = readPersonalizedParams(`https://komerce.km/share/tok?who=${longName}`);
    expect(result.who).toBe('b'.repeat(40));
  });
  it('URL invalide → { who: null, amt: null } (ne throw pas)', () => {
    expect(readPersonalizedParams('::not a url::')).toEqual({ who: null, amt: null });
  });
  it('sans argument, retombe sur window.location.href', () => {
    expect(() => readPersonalizedParams()).not.toThrow();
  });
});
