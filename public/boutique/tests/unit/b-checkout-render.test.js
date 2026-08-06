'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-checkout-render.test.js
 *
 * Module js/b-checkout-render.js (371L) — fonctions de rendu DOM pures du
 * checkout (S3.1). Doc du module : "ne lisent pas le state global, ne
 * déclenchent pas d'effets de bord métier". Systématiquement mocké dans
 * tests/unit/b-checkout.test.js (b-checkout.js le consomme comme
 * collaborateur) — jamais testé en direct avant cette session.
 *
 * Import réel du module + de b-utils.js (sanitize/fmt réels, pas de mock —
 * même pattern que render-categories.test.js).
 */

const {
  renderFulfillmentSelector,
  renderRelaisForIle,
  setCheckoutConfirmButton,
  makeInput,
  makePhoneInput,
  buildOrderSuccessDOM,
  buildIdentityRecapDOM,
  applyIdentityToCard,
} = require('../../js/b-checkout-render.js');
const { fmt } = require('../../js/b-utils.js');

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('renderFulfillmentSelector', () => {
  function setup(zone = 'comoros') {
    const container = document.createElement('div');
    const od = { fulfillment_zone: zone, selectedRelaisId: 'relais-1' };
    const onChange = jest.fn();
    renderFulfillmentSelector(container, od, onChange);
    return { container, od, onChange };
  }

  it('rend les 2 boutons de zone et attache au container', () => {
    const { container } = setup();
    const btns = container.querySelectorAll('.ck-fulfillment-btn');
    expect(btns.length).toBe(2);
  });

  it('marque le bouton actif correspondant à od.fulfillment_zone', () => {
    const { container } = setup('france');
    const franceBtn = container.querySelector('[data-zone="france"]');
    const comorosBtn = container.querySelector('[data-zone="comoros"]');
    expect(franceBtn.classList.contains('active')).toBe(true);
    expect(comorosBtn.classList.contains('active')).toBe(false);
  });

  it('clic sur un autre bouton change od.fulfillment_zone, reset selectedRelaisId, appelle onChange', () => {
    const { container, od, onChange } = setup('comoros');
    const franceBtn = container.querySelector('[data-zone="france"]');
    franceBtn.click();
    expect(od.fulfillment_zone).toBe('france');
    expect(od.selectedRelaisId).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(franceBtn.classList.contains('active')).toBe(true);
  });

  it('clic sur le bouton déjà actif ne fait rien (garde early-return)', () => {
    const { container, od, onChange } = setup('comoros');
    const comorosBtn = container.querySelector('[data-zone="comoros"]');
    comorosBtn.click();
    expect(od.selectedRelaisId).toBe('relais-1');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('renderRelaisForIle', () => {
  function makeListEl() {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
  }

  it('filtre les relais dont le nom/adresse contient "domoni"', () => {
    const listEl = makeListEl();
    const relais = [
      { id: '1', name: 'Relais Moroni' },
      { id: '2', name: 'Relais Domoni Centre' },
    ];
    renderRelaisForIle(listEl, relais, {}, jest.fn(), jest.fn());
    expect(listEl.querySelectorAll('.ck-relais-item').length).toBe(1);
    expect(listEl.textContent).toContain('Moroni');
    expect(listEl.textContent).not.toContain('Domoni');
  });

  it('un seul relais visible → auto-sélection sans clic, appelle onSelect et onClearError', () => {
    const listEl = makeListEl();
    const onSelect = jest.fn();
    const onClearError = jest.fn();
    const selectionRef = {};
    renderRelaisForIle(listEl, [{ id: 'r1', name: 'Seul Relais' }], selectionRef, onSelect, onClearError);
    expect(selectionRef.selectedRelaisId).toBe('r1');
    expect(onSelect).toHaveBeenCalledWith('r1');
    expect(onClearError).toHaveBeenCalledTimes(1);
    expect(listEl.querySelector('.ck-relais-item--compact.selected')).not.toBeNull();
  });

  it('plusieurs relais, aucun présélectionné → auto-clic sur le premier', () => {
    const listEl = makeListEl();
    const onSelect = jest.fn();
    const selectionRef = {};
    renderRelaisForIle(
      listEl,
      [{ id: 'a', name: 'Relais A' }, { id: 'b', name: 'Relais B' }],
      selectionRef, onSelect, jest.fn()
    );
    expect(selectionRef.selectedRelaisId).toBe('a');
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('plusieurs relais, un déjà présélectionné → pas d\'auto-clic, onSelect appelé avec la sélection existante', () => {
    const listEl = makeListEl();
    const onSelect = jest.fn();
    const selectionRef = { selectedRelaisId: 'b' };
    renderRelaisForIle(
      listEl,
      [{ id: 'a', name: 'Relais A' }, { id: 'b', name: 'Relais B' }],
      selectionRef, onSelect, jest.fn()
    );
    expect(selectionRef.selectedRelaisId).toBe('b');
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('clic sur un item : le sélectionne, désélectionne les autres, met à jour selectionRef', () => {
    const listEl = makeListEl();
    const onSelect = jest.fn();
    const onClearError = jest.fn();
    const selectionRef = {};
    renderRelaisForIle(
      listEl,
      [{ id: 'a', name: 'Relais A' }, { id: 'b', name: 'Relais B' }],
      selectionRef, onSelect, onClearError
    );
    onSelect.mockClear();
    onClearError.mockClear();

    const itemB = listEl.querySelector('[data-id="b"]');
    itemB.click();

    expect(selectionRef.selectedRelaisId).toBe('b');
    expect(itemB.classList.contains('selected')).toBe(true);
    expect(listEl.querySelector('[data-id="a"]').classList.contains('selected')).toBe(false);
    expect(onSelect).toHaveBeenCalledWith('b');
    expect(onClearError).toHaveBeenCalledTimes(1);
  });

  it('affiche l\'adresse si présente (fallback name/nom, address/adresse/location)', () => {
    const listEl = makeListEl();
    renderRelaisForIle(listEl, [{ id: '1', nom: 'Relais X', adresse: 'Rue Test' }], {}, jest.fn(), jest.fn());
    expect(listEl.textContent).toContain('Relais X');
    expect(listEl.textContent).toContain('Rue Test');
  });

  it('n\'affiche pas de bloc adresse si aucune adresse fournie', () => {
    const listEl = makeListEl();
    renderRelaisForIle(listEl, [{ id: '1', name: 'Relais Sans Adresse' }], {}, jest.fn(), jest.fn());
    expect(listEl.querySelector('.ck-relais-addr')).toBeNull();
  });

  it('onSelect/onClearError optionnels ne throw pas', () => {
    const listEl = makeListEl();
    expect(() => renderRelaisForIle(listEl, [{ id: '1', name: 'R' }], {})).not.toThrow();
  });

  it('reset le contenu de listEl à chaque appel (pas d\'accumulation)', () => {
    const listEl = makeListEl();
    renderRelaisForIle(listEl, [{ id: '1', name: 'R1' }], {}, jest.fn(), jest.fn());
    renderRelaisForIle(listEl, [{ id: '2', name: 'R2' }], {}, jest.fn(), jest.fn());
    expect(listEl.querySelectorAll('.ck-relais-item').length).toBe(1);
  });
});

describe('setCheckoutConfirmButton', () => {
  it('ne throw pas si button est null/undefined', () => {
    expect(() => setCheckoutConfirmButton(null, 'Payer')).not.toThrow();
  });

  it('remplace le contenu avec le texte principal', () => {
    const btn = document.createElement('button');
    setCheckoutConfirmButton(btn, 'Confirmer', undefined);
    expect(btn.querySelector('.ck-confirm-main').textContent).toBe('Confirmer');
    expect(btn.querySelector('.ck-confirm-subtext')).toBeNull();
  });

  it('ajoute le sous-texte si fourni', () => {
    const btn = document.createElement('button');
    setCheckoutConfirmButton(btn, 'Confirmer', '3 500 KMF');
    expect(btn.querySelector('.ck-confirm-subtext').textContent).toBe('3 500 KMF');
  });

  it('réinitialise le contenu précédent à chaque appel', () => {
    const btn = document.createElement('button');
    setCheckoutConfirmButton(btn, 'Premier', 'sub1');
    setCheckoutConfirmButton(btn, 'Second');
    expect(btn.querySelectorAll('.ck-confirm-main').length).toBe(1);
    expect(btn.querySelector('.ck-confirm-main').textContent).toBe('Second');
    expect(btn.querySelector('.ck-confirm-subtext')).toBeNull();
  });
});

describe('makeInput', () => {
  it('pré-remplit la valeur depuis dataObj[key]', () => {
    const data = { name: 'Ali' };
    const group = makeInput('id1', 'Nom', 'text', 'placeholder', data, 'name');
    const input = group.querySelector('input');
    expect(input.value).toBe('Ali');
    expect(input.id).toBe('id1');
    expect(input.placeholder).toBe('placeholder');
  });

  it('valeur vide si dataObj[key] absent', () => {
    const group = makeInput('id2', 'Label', 'text', '', {}, 'missing');
    expect(group.querySelector('input').value).toBe('');
  });

  it('la saisie met à jour dataObj[key] en direct (listener input)', () => {
    const data = {};
    const group = makeInput('id3', 'Label', 'text', '', data, 'foo');
    const input = group.querySelector('input');
    input.value = 'nouvelle valeur';
    input.dispatchEvent(new Event('input'));
    expect(data.foo).toBe('nouvelle valeur');
  });

  it('affiche le label', () => {
    const group = makeInput('id4', 'Mon Label', 'text', '', {}, 'k');
    expect(group.querySelector('label').textContent).toBe('Mon Label');
  });
});

describe('makePhoneInput', () => {
  it('affiche le préfixe +269 et pré-remplit la valeur', () => {
    const data = { phone: '321 12 34' };
    const group = makePhoneInput('idp', 'Téléphone', data, 'phone');
    expect(group.querySelector('.k-ck-km-code').textContent).toBe('+269');
    expect(group.querySelector('input').value).toBe('321 12 34');
  });

  it('omet le label si vide/absent', () => {
    const group = makePhoneInput('idp2', '', {}, 'phone');
    expect(group.querySelector('label')).toBeNull();
  });

  it('formate la saisie en groupes 3-2-2 (321 12 34)', () => {
    const data = {};
    const group = makePhoneInput('idp3', 'Tel', data, 'phone');
    const input = group.querySelector('input');
    input.value = '3211234';
    input.dispatchEvent(new Event('input'));
    expect(input.value).toBe('321 12 34');
    expect(data.phone).toBe('321 12 34');
  });

  it('supprime les caractères non numériques à la saisie', () => {
    const data = {};
    const group = makePhoneInput('idp4', 'Tel', data, 'phone');
    const input = group.querySelector('input');
    input.value = '32a1-1b23c4';
    input.dispatchEvent(new Event('input'));
    expect(input.value).toBe('321 12 34');
  });

  it('tronque au-delà de 7 chiffres', () => {
    const data = {};
    const group = makePhoneInput('idp5', 'Tel', data, 'phone');
    const input = group.querySelector('input');
    input.value = '321123456789';
    input.dispatchEvent(new Event('input'));
    expect(input.value).toBe('321 12 34');
  });

  it('saisie courte (< 4 chiffres) reste brute, sans espace', () => {
    const data = {};
    const group = makePhoneInput('idp6', 'Tel', data, 'phone');
    const input = group.querySelector('input');
    input.value = '32';
    input.dispatchEvent(new Event('input'));
    expect(input.value).toBe('32');
  });
});

describe('buildOrderSuccessDOM', () => {
  function makeBody() {
    const body = document.createElement('div');
    document.body.appendChild(body);
    return body;
  }

  it('reset le contenu du body et construit la structure de base', () => {
    const body = makeBody();
    body.innerHTML = '<p>ancien contenu</p>';
    buildOrderSuccessDOM(body, { reference: 'REF-1' });
    expect(body.querySelector('p')).toBeNull();
    expect(body.querySelector('.k-confirm-ref').textContent).toBe('REF-1');
  });

  it('affiche "—" si reference absente', () => {
    const body = makeBody();
    buildOrderSuccessDOM(body, {});
    expect(body.querySelector('.k-confirm-ref').textContent).toBe('—');
  });

  it('retourne les 3 refs de bouton (copyBtn, closeBtn, trackBtn)', () => {
    const body = makeBody();
    const refs = buildOrderSuccessDOM(body, { reference: 'REF-2' });
    expect(refs.copyBtn.id).toBe('k-copy-ref-btn');
    expect(refs.closeBtn.id).toBe('k-order-close-btn');
    expect(refs.trackBtn.id).toBe('k-order-track-btn');
  });

  it('affiche le récap qty/total si items_count et total_kmf présents', () => {
    const body = makeBody();
    buildOrderSuccessDOM(body, { reference: 'R', items_count: 3, total_kmf: 15000 });
    const recap = body.querySelector('.k-confirm-recap');
    expect(recap).not.toBeNull();
    expect(recap.textContent).toContain('3 articles');
    expect(recap.querySelector('.k-confirm-recap-amount').textContent).toBe(fmt(15000, 'KMF'));
  });

  it('accord singulier "article" si qty=1', () => {
    const body = makeBody();
    buildOrderSuccessDOM(body, { reference: 'R', items_count: 1, total_kmf: 5000 });
    expect(body.querySelector('.k-confirm-recap-qty').textContent).toBe('1 article');
  });

  it('déduit orderQty depuis order.items.length si items_count absent', () => {
    const body = makeBody();
    buildOrderSuccessDOM(body, { reference: 'R', items: [{}, {}], total_kmf: 8000 });
    expect(body.querySelector('.k-confirm-recap-qty').textContent).toBe('2 articles');
  });

  it('pas de bloc récap si qty ou total manquant', () => {
    const body = makeBody();
    buildOrderSuccessDOM(body, { reference: 'R' });
    expect(body.querySelector('.k-confirm-recap')).toBeNull();
  });

  it('affiche le bloc cash_ref_code seulement si payment_mode === cash_relais', () => {
    const body = makeBody();
    buildOrderSuccessDOM(body, { reference: 'R', cash_ref_code: 'CASH-9', payment_mode: 'cash_relais' });
    expect(body.querySelector('.k-confirm-cash-code').textContent).toBe('CASH-9');
  });

  it('pas de bloc cash si payment_mode différent, même avec cash_ref_code présent', () => {
    const body = makeBody();
    buildOrderSuccessDOM(body, { reference: 'R', cash_ref_code: 'CASH-9', payment_mode: 'paypal_eur' });
    expect(body.querySelector('.k-confirm-cash-block')).toBeNull();
  });

  it('échappe le HTML dans reference et cash_ref_code (sanitize réel)', () => {
    const body = makeBody();
    buildOrderSuccessDOM(body, {
      reference: '<img src=x onerror=alert(1)>',
      cash_ref_code: '<b>x</b>', payment_mode: 'cash_relais',
    });
    expect(body.querySelector('.k-confirm-ref').innerHTML).not.toContain('<img');
    expect(body.querySelector('.k-confirm-cash-code').innerHTML).not.toContain('<b>');
  });
});

describe('buildIdentityRecapDOM', () => {
  it('affiche le nom si full_name présent', () => {
    const el = buildIdentityRecapDOM({ full_name: 'Ali Said', phone: '+2693312345' });
    expect(el.id).toBe('ck-identity-recap');
    expect(el.querySelector('.k-ck-id-name').textContent).toBe('Ali Said');
    expect(el.querySelector('.k-ck-id-num').textContent).toBe('+2693312345');
  });

  it('fallback sur phone si full_name/name absents', () => {
    const el = buildIdentityRecapDOM({ phone: '+2693312345' });
    expect(el.querySelector('.k-ck-id-name').textContent).toBe('+2693312345');
    expect(el.querySelector('.k-ck-id-num')).toBeNull();
  });

  it('name utilisé si full_name absent', () => {
    const el = buildIdentityRecapDOM({ name: 'Fatima' });
    expect(el.querySelector('.k-ck-id-name').textContent).toBe('Fatima');
  });

  it('initiales calculées depuis le nom (2 mots max, majuscules)', () => {
    const el = buildIdentityRecapDOM({ full_name: 'ali said mohamed' });
    expect(el.querySelector('.k-ck-id-initials').textContent).toBe('AS');
  });

  it('initiale "·" si aucun nom ni téléphone', () => {
    const el = buildIdentityRecapDOM({});
    expect(el.querySelector('.k-ck-id-initials').textContent).toBe('·');
  });

  it('boutons "changer" et "pas vous" présents', () => {
    const el = buildIdentityRecapDOM({ full_name: 'Ali' });
    expect(el.querySelector('.k-ck-id-change')).not.toBeNull();
    expect(el.querySelector('.k-ck-id-notyou')).not.toBeNull();
  });

  it('échappe le HTML dans le nom (sanitize réel)', () => {
    const el = buildIdentityRecapDOM({ full_name: '<script>alert(1)</script>' });
    expect(el.querySelector('.k-ck-id-name').innerHTML).not.toContain('<script>');
  });
});

describe('applyIdentityToCard', () => {
  function makeCard(identity) {
    return buildIdentityRecapDOM(identity);
  }

  it('ne throw pas si card ou identity est null/undefined', () => {
    expect(() => applyIdentityToCard(null, { full_name: 'A' })).not.toThrow();
    expect(() => applyIdentityToCard(makeCard({}), null)).not.toThrow();
  });

  it('met à jour initiales et nom', () => {
    const card = makeCard({ full_name: 'Ali Said' });
    applyIdentityToCard(card, { full_name: 'Fatima Ben' });
    expect(card.querySelector('.k-ck-id-name').textContent).toBe('Fatima Ben');
    expect(card.querySelector('.k-ck-id-initials').textContent).toBe('FB');
  });

  it('ajoute le span téléphone s\'il n\'existait pas et que name+phone sont fournis', () => {
    const card = makeCard({ full_name: 'Ali' }); // pas de phone initialement → pas de span num
    expect(card.querySelector('.k-ck-id-num')).toBeNull();
    applyIdentityToCard(card, { full_name: 'Ali', phone: '+2693312345' });
    expect(card.querySelector('.k-ck-id-num').textContent).toBe('+2693312345');
  });

  it('retire le span téléphone existant si le nouveau identity n\'a plus les deux (name+phone)', () => {
    const card = makeCard({ full_name: 'Ali', phone: '+2693312345' });
    expect(card.querySelector('.k-ck-id-num')).not.toBeNull();
    applyIdentityToCard(card, { full_name: '', phone: '+2693312345' });
    expect(card.querySelector('.k-ck-id-num')).toBeNull();
  });

  it('met à jour le span téléphone existant sans le recréer', () => {
    const card = makeCard({ full_name: 'Ali', phone: '+2693312345' });
    const before = card.querySelector('.k-ck-id-num');
    applyIdentityToCard(card, { full_name: 'Ali', phone: '+2699998877' });
    const after = card.querySelector('.k-ck-id-num');
    expect(after).toBe(before);
    expect(after.textContent).toBe('+2699998877');
  });
});
