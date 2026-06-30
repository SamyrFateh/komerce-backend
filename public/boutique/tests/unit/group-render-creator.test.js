'use strict';

/**
 * tests/unit/group-render-creator.test.js
 *
 * Module #10 — js/group/group-render-creator.js (745L)
 *
 * Exports réels (ESM) : renderCreatorCartSwitcher, renderOwnerIdentityCard,
 * renderCreatorArticlesPanel, renderCreatorIdentityCard,
 * renderCreatorFinancialSummary, renderProgress, renderCreatorUnifiedCard,
 * renderCreatorActions, renderArticlesAccordion.
 * (Le prompt initial listait à tort renderCreatorActions,
 * renderCreatorArticlesPanel, renderArticlesAccordion, optionsBlock,
 * _phaseBadge, _accOpenAttr, hue comme exports — _phaseBadge/_accOpenAttr/
 * _optionsAccordion sont internes, optionsBlock et hue sont de simples
 * variables locales, pas des fonctions.)
 *
 * Toutes ces fonctions sont déclarées PURES dans le JSDoc du module
 * (pas de state, pas de fetch, pas de DOM touché — juste des templates
 * string). Dépendances réelles : group-helpers.js, group-state.js, b-utils.js
 * (déjà couvertes par group-helpers.test.js / group-state.test.js).
 */

const {
  renderCreatorCartSwitcher,
  renderOwnerIdentityCard,
  renderCreatorArticlesPanel,
  renderCreatorIdentityCard,
  renderCreatorFinancialSummary,
  renderProgress,
  renderCreatorUnifiedCard,
  renderCreatorActions,
  renderArticlesAccordion,
} = require('../../js/group/group-render-creator.js');

describe('renderCreatorCartSwitcher', () => {
  it('0 ou 1 panier visible → string vide (pas de switcher utile)', () => {
    expect(renderCreatorCartSwitcher([], null)).toBe('');
    expect(renderCreatorCartSwitcher([{ id: 1, status: 'open' }], 1)).toBe('');
  });

  it('plusieurs paniers visibles → un onglet par panier, actif marqué', () => {
    const carts = [
      { id: 1, status: 'open', title: 'Panier A', total_kmf_snapshot: 1000 },
      { id: 2, status: 'open', title: 'Panier B', total_kmf_snapshot: 2000 },
    ];
    const html = renderCreatorCartSwitcher(carts, 2);
    expect(html).toContain('data-k-group-cart-id="1"');
    expect(html).toContain('data-k-group-cart-id="2"');
    expect(html).toMatch(/k-group-cart-tab is-active[^"]*"\s+data-k-group-cart-id="2"/);
  });

  it("panier sans titre → libellé par défaut 'Panier groupe'", () => {
    const carts = [
      { id: 1, status: 'open', total_kmf_snapshot: 1000 },
      { id: 2, status: 'open', total_kmf_snapshot: 2000 },
    ];
    const html = renderCreatorCartSwitcher(carts, 1);
    expect(html).toContain('Panier groupe');
  });
});

describe('renderOwnerIdentityCard', () => {
  it('rend titre, total formaté et statut', () => {
    const html = renderOwnerIdentityCard({ title: 'Mariage Aicha', total_kmf_snapshot: 15000, status: 'open' }, 3);
    expect(html).toContain('Mariage Aicha');
    expect(html).toContain('3 articles');
  });

  it('1 seul article → singulier (pas de "s")', () => {
    const html = renderOwnerIdentityCard({ title: 'Test', total_kmf_snapshot: 1000, status: 'open' }, 1);
    expect(html).toContain('1 article');
    expect(html).not.toContain('1 articles');
  });

  it('sans titre → fallback "Panier groupe"', () => {
    const html = renderOwnerIdentityCard({ total_kmf_snapshot: 0, status: 'open' }, 0);
    expect(html).toContain('Panier groupe');
  });
});

describe('renderCreatorArticlesPanel', () => {
  it('liste vide → message "Aucun article à afficher"', () => {
    const html = renderCreatorArticlesPanel([], {});
    expect(html).toContain('Aucun article à afficher');
  });

  it('articles présents → une ligne par article, nom/qty/prix formatés', () => {
    const items = [
      { product_name: 'T-shirt', quantity: 2, unit_price_kmf: 5000 },
      { name: 'Casquette', qty: 1, price_kmf: 3000 },
    ];
    const html = renderCreatorArticlesPanel(items, { total_kmf_snapshot: 13000 });
    expect(html).toContain('T-shirt');
    expect(html).toContain('×2');
    expect(html).toContain('Casquette');
    expect(html).toContain('🛒 2 articles');
  });

  it('plus de 8 articles → tronque à 8 lignes affichées (compteur reste réel)', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ product_name: `Item ${i}`, quantity: 1, unit_price_kmf: 100 }));
    const html = renderCreatorArticlesPanel(items, {});
    expect(html).toContain('🛒 12 articles');
    expect((html.match(/k-group-side-item-fallback|<img/g) || []).length).toBe(8);
  });

  it('article sans image → fallback emoji 📦', () => {
    const html = renderCreatorArticlesPanel([{ name: 'Sans image', qty: 1 }], {});
    expect(html).toContain('k-group-side-item-fallback');
    expect(html).toContain('📦');
  });

  it('article avec image → balise <img> avec src sanitizé', () => {
    const html = renderCreatorArticlesPanel([{ name: 'Avec image', qty: 1, image: '/img/x.jpg' }], {});
    expect(html).toContain('<img src="/img/x.jpg"');
  });

  it('items non-array (ex. undefined par défaut) → ne throw pas, traite comme vide', () => {
    expect(() => renderCreatorArticlesPanel(undefined, {})).not.toThrow();
  });
});

describe('renderCreatorIdentityCard', () => {
  it('nom + téléphone présents → avatar initiales + numéro affiché', () => {
    const html = renderCreatorIdentityCard({ owner_name: 'Awa Mohamed', owner_phone: '+269 123 456' });
    expect(html).toContain('AM');
    expect(html).toContain('Awa Mohamed');
    expect(html).toContain('+269 123 456');
  });

  it('sans téléphone → pas de bloc téléphone affiché', () => {
    const html = renderCreatorIdentityCard({ owner_name: 'Solo' });
    expect(html).not.toContain('k-group-creator-id-phone');
  });

  it("sans aucun nom → fallback 'Créateur', initiale '?'", () => {
    const html = renderCreatorIdentityCard({});
    expect(html).toContain('Créateur');
    expect(html).toContain('>C<'); // initiale du mot "Créateur"
  });

  it('utilise beneficiary_name_snapshot en dernier recours', () => {
    const html = renderCreatorIdentityCard({ beneficiary_name_snapshot: 'Fatima Ali' });
    expect(html).toContain('Fatima Ali');
  });
});

describe('renderCreatorFinancialSummary', () => {
  it('stats de base : total, estimé, payé toujours présents', () => {
    const cart = { total_kmf_snapshot: 10000, contributed_kmf: 3000 };
    const html = renderCreatorFinancialSummary(cart, []);
    expect(html).toContain('Total panier');
    expect(html).toContain('Estimé');
    expect(html).toContain('Payé');
  });

  it('reste > 0 → carte "Reste" affichée avec highlight', () => {
    const cart = { total_kmf_snapshot: 10000, contributed_kmf: 3000, remaining_kmf: 7000 };
    const html = renderCreatorFinancialSummary(cart, []);
    expect(html).toContain('Reste');
    expect(html).toContain('is-highlight');
  });

  it('entièrement payé (reste = 0) → pas de carte "Reste"', () => {
    const cart = { total_kmf_snapshot: 10000, contributed_kmf: 10000, remaining_kmf: 0 };
    const html = renderCreatorFinancialSummary(cart, []);
    expect(html).not.toContain('>Reste<');
  });

  it('estimations présentes → légende "estimé" affichée dans la barre', () => {
    const cart = { total_kmf_snapshot: 10000, contributed_kmf: 0 };
    const estimations = [{ amount_kmf: 5000 }];
    const html = renderCreatorFinancialSummary(cart, estimations);
    expect(html).toContain('k-group-progress-legend-engaged');
  });
});

describe('renderProgress', () => {
  it('aucune estimation → message "Aucune estimation encore"', () => {
    const html = renderProgress({ status: 'open', total_kmf_snapshot: 1000 }, [], []);
    expect(html).toContain('Aucune estimation encore');
  });

  it('estimations présentes → une ligne par participant, initiales et montant', () => {
    const cart = { status: 'open', total_kmf_snapshot: 10000 };
    const estimations = [{ participant_name: 'Ali Hassan', participant_phone: '0612345678', amount_kmf: 2000 }];
    const html = renderProgress(cart, [], estimations);
    expect(html).toContain('Ali');
    expect(html).toMatch(/2.000 KMF/); // espace insécable fine (Intl.NumberFormat fr-FR)
  });

  it('participant payé (présent dans contributions avec status paid) → badge "✅ Payé"', () => {
    const cart = { status: 'closed', total_kmf_snapshot: 10000 };
    const estimations = [{ participant_name: 'Ali', participant_phone: '0612345678', amount_kmf: 2000 }];
    const contributions = [{ contributor_phone: '0612345678', status: 'paid' }];
    const html = renderProgress(cart, contributions, estimations);
    expect(html).toContain('✅ Payé');
  });

  it('statut CLOSED (paiement ouvert) → bandeau "Paiement ouvert" affiché', () => {
    const cart = { status: 'closed', total_kmf_snapshot: 5000, contributed_kmf: 0 };
    const html = renderProgress(cart, [], []);
    expect(html).toContain('Paiement ouvert');
  });

  it('statut OPEN (pas en paiement) → pas de bandeau paiement', () => {
    const cart = { status: 'open', total_kmf_snapshot: 5000 };
    const html = renderProgress(cart, [], []);
    expect(html).not.toContain('💳 Paiement ouvert');
  });
});

describe('renderCreatorUnifiedCard', () => {
  it('statut open → badge "En préparation", actions Partager le panier', () => {
    const cart = { status: 'open', title: 'Test', total_kmf_snapshot: 5000 };
    const html = renderCreatorUnifiedCard(cart, [], [], []);
    expect(html).toContain('En préparation');
    expect(html).toContain('📤 Partager le panier');
  });

  it('statut closed avec solde restant → actions de partage règlement, pas de bouton finaliser', () => {
    const cart = { status: 'closed', title: 'Test', total_kmf_snapshot: 5000, contributed_kmf: 2000, remaining_kmf: 3000 };
    const html = renderCreatorUnifiedCard(cart, [], [], []);
    expect(html).toContain('💳 Paiement ouvert');
    expect(html).not.toContain('id="k-group-finalize"');
  });

  it('statut closed, totalement financé (remaining 0) → bouton "Confirmer la commande"', () => {
    const cart = { status: 'closed', title: 'Test', total_kmf_snapshot: 5000, contributed_kmf: 5000, remaining_kmf: 0 };
    const html = renderCreatorUnifiedCard(cart, [], [], []);
    expect(html).toContain('id="k-group-finalize"');
    expect(html).toContain('Confirmer la commande');
  });

  it('statut ordered → badge "Commande créée", note de fin', () => {
    const cart = { status: 'ordered', title: 'Test', total_kmf_snapshot: 5000 };
    const html = renderCreatorUnifiedCard(cart, [], [], []);
    expect(html).toContain('📦 Commande créée');
    expect(html).toContain('Le panier est terminé.');
  });

  it('statut ordered avec finalized_order_id → bouton "Voir la commande"', () => {
    const cart = { status: 'ordered', title: 'Test', total_kmf_snapshot: 5000, finalized_order_id: 'ord_1' };
    const html = renderCreatorUnifiedCard(cart, [], [], []);
    expect(html).toContain('📦 Voir la commande');
  });

  it('statut cancelled → note "Panier annulé"', () => {
    const cart = { status: 'cancelled', title: 'Test', total_kmf_snapshot: 5000 };
    const html = renderCreatorUnifiedCard(cart, [], [], []);
    expect(html).toContain('❌ Panier annulé');
  });

  it('statut expired → note "Panier expiré"', () => {
    const cart = { status: 'expired', title: 'Test', total_kmf_snapshot: 5000 };
    const html = renderCreatorUnifiedCard(cart, [], [], []);
    expect(html).toContain('⏱️ Panier expiré');
  });

  it('statut open avec estimations → bloc estimations affiché', () => {
    const cart = { status: 'open', title: 'Test', total_kmf_snapshot: 10000 };
    const estimations = [{ participant_name: 'Ali Ben', amount_kmf: 3000 }];
    const html = renderCreatorUnifiedCard(cart, estimations, [], []);
    expect(html).toContain('Estimations reçues');
    expect(html).toContain('Ali');
  });

  it('titre échappé via sanitize (pas d\'injection HTML)', () => {
    const cart = { status: 'open', title: '<img src=x onerror=alert(1)>', total_kmf_snapshot: 1000 };
    const html = renderCreatorUnifiedCard(cart, [], [], []);
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
  });
});

describe('renderCreatorActions', () => {
  it('statut cancelled → carte terminale "Panier annulé", aucune action', () => {
    const html = renderCreatorActions({ status: 'cancelled' });
    expect(html).toContain('❌ Panier annulé');
    expect(html).not.toContain('<button');
  });

  it('statut expired → carte terminale "Panier expiré"', () => {
    const html = renderCreatorActions({ status: 'expired' });
    expect(html).toContain('⏱️ Panier expiré');
  });

  it('step ORDER_CREATED (status ordered) → badge commande créée, pas de bouton confirmer', () => {
    const html = renderCreatorActions({ status: 'ordered' });
    expect(html).toContain('📦 Commande créée');
    expect(html).toContain('Le panier est terminé.');
  });

  it('step ORDER_CREATED avec finalized_order_id → bouton "Voir la commande"', () => {
    const html = renderCreatorActions({ status: 'ordered', finalized_order_id: 'o1' });
    expect(html).toContain('id="k-group-to-track"');
  });

  it('step CONFIRM (status closed), sans relais → avertissement relais affiché', () => {
    const html = renderCreatorActions({ status: 'closed', total_kmf_snapshot: 5000, contributed_kmf: 0 });
    expect(html).toContain('Choisissez un relais de livraison');
  });

  it('step CONFIRM avec relais fourni → pas d\'avertissement relais', () => {
    const html = renderCreatorActions(
      { status: 'closed', total_kmf_snapshot: 5000, contributed_kmf: 0 },
      { relayId: 'relay_1' }
    );
    expect(html).not.toContain('Choisissez un relais de livraison');
  });

  it('step CONFIRM, totalement payé → bouton "Confirmer la commande" actif (relais présent)', () => {
    const html = renderCreatorActions(
      { status: 'closed', total_kmf_snapshot: 5000, contributed_kmf: 5000, remaining_kmf: 0 },
      { relayId: 'relay_1' }
    );
    expect(html).toContain('Tout est payé');
    expect(html).toContain('Confirmer la commande');
    expect(html).not.toMatch(/id="k-group-finalize"[^>]*disabled/);
  });

  it('step CONFIRM, totalement payé mais sans relais → bouton confirmer désactivé', () => {
    const html = renderCreatorActions(
      { status: 'closed', total_kmf_snapshot: 5000, contributed_kmf: 5000, remaining_kmf: 0 }
    );
    expect(html).toMatch(/id="k-group-finalize"\s*\n?\s*disabled/);
  });

  it('step CONFIRM, reste à payer → bouton "Je paie le reste" avec montant', () => {
    const html = renderCreatorActions(
      { status: 'closed', total_kmf_snapshot: 5000, contributed_kmf: 2000, remaining_kmf: 3000 },
      { relayId: 'relay_1' }
    );
    expect(html).toContain('Je paie le reste');
    expect(html).toContain('Il reste');
  });

  it('step SHARE_AND_LOCK (status open par défaut) → bouton "Partager le panier"', () => {
    const html = renderCreatorActions({ status: 'open', total_kmf_snapshot: 1000 });
    expect(html).toContain('En préparation');
    expect(html).toContain('📤 Partager le panier');
  });
});

describe('renderArticlesAccordion', () => {
  it('liste vide → string vide', () => {
    expect(renderArticlesAccordion([])).toBe('');
    expect(renderArticlesAccordion(undefined)).toBe('');
  });

  it('articles présents → accordéon avec compteur et lignes', () => {
    const items = [
      { product_name_snapshot: 'Sac', quantity: 1, unit_price_kmf_snapshot: 8000 },
      { name: 'Ceinture', quantity: 2, unit_price_kmf: 1500 },
    ];
    const html = renderArticlesAccordion(items);
    expect(html).toContain('Voir les articles (2)');
    expect(html).toContain('Sac');
    expect(html).toContain('Ceinture');
    expect(html).toContain('×2');
  });
});
