/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * @komerce-arch-lite
 * @role          boutique-core-unit-tests
 * @domain        boutique
 * @layer         test
 * @status        production
 * @owner         public/boutique/tests/unit/
 * @purpose       Tests unitaires Jest sur les fonctions pures ou DOM-pures des
 *                modules critiques b-utils.js, b-cart-core.js,
 *                b-checkout-render.js.
 * @impact-areas  boutique, checkout, catalog, identity, cart
 * @version       2026-06 (D8)
 */

'use strict';

/**
 * KOMERCE BOUTIQUE — Tests unitaires N3
 *
 * Stratégie :
 * - tests rapides, sans fetch, sans backend, sans state global ;
 * - jsdom requis pour sanitize(), renderFulfillmentSelector(),
 *   buildIdentityRecapDOM() et applyIdentityToCard() ;
 * - logique inline volontaire : les modules boutique sont ESM et parfois liés
 *   au store/bus DOM. Ici on fige les invariants purs sans déclencher le runtime.
 *
 * Commande attendue :
 *   npm run test:unit
 */

/* ── Helpers inline : b-utils.js ─────────────────────────────────────────── */

const _rates = { EUR: 495, KMF: 1 };

function optimizeImgUrl(url, w) {
  if (!url || url.indexOf('res.cloudinary.com') === -1) return url;
  if (url.indexOf('f_auto') !== -1) return url;
  return url.replace('/upload/', '/upload/f_auto,q_auto' + (w ? ',w_' + w : '') + '/');
}

function sanitize(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function fmt(kmf, currency) {
  const c = currency || 'EUR';
  const rate = _rates[c] || 1;
  const val = Math.round(kmf / rate);
  return val.toLocaleString('fr-FR') + (c === 'EUR' ? ' €' : ' KMF');
}

function fmtPrice(kmf) {
  return new Intl.NumberFormat('fr-FR').format(kmf) + ' KMF';
}

function productEmoji(p) {
  return p.emoji || '📦';
}

function genIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/* ── Helpers inline : b-cart-core.js ─────────────────────────────────────── */

function cartQty(cart) {
  return cart.reduce((s, i) => s + i.qty, 0);
}

function cartTotal(cart) {
  return cart.reduce((s, i) => s + (i.product.price_kmf || 0) * i.qty, 0);
}

function isFav(favs, id) {
  const sid = String(id);
  return favs.some(f => String(f) === sid);
}

/* ── Helpers inline : b-checkout-render.js ───────────────────────────────── */

function renderFulfillmentSelector(container, od, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'ck-fulfillment-switch';
  wrap.innerHTML =
    '<button type="button" class="ck-fulfillment-btn" data-zone="comoros">Retrait aux Comores</button>' +
    '<button type="button" class="ck-fulfillment-btn" data-zone="france">Retrait en France</button>';

  function syncActive() {
    wrap.querySelectorAll('.ck-fulfillment-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.zone === od.fulfillment_zone);
    });
  }

  wrap.querySelectorAll('.ck-fulfillment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (od.fulfillment_zone === btn.dataset.zone) return;
      od.fulfillment_zone = btn.dataset.zone;
      od.selectedRelaisId = null;
      syncActive();
      onChange();
    });
  });

  syncActive();
  container.appendChild(wrap);
}

function _idInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function buildIdentityRecapDOM(identity) {
  const el = document.createElement('div');
  el.id = 'ck-identity-recap';
  el.className = 'k-ck-identity-recap';
  const dName  = identity.full_name || identity.name  || '';
  const dPhone = identity.phone || '';
  el.innerHTML =
    '<div class="k-ck-id-card">'
    +   '<span class="k-ck-id-avatar" aria-hidden="true">'
    +     '<span class="k-ck-id-initials">' + sanitize(_idInitials(dName || dPhone)) + '</span>'
    +     '<span class="k-ck-id-check" title="Identité vérifiée">✓</span>'
    +   '</span>'
    +   '<span class="k-ck-id-ident">'
    +     '<span class="k-ck-id-value"><span class="k-ck-id-hi" aria-hidden="true">👋</span> '
    +       '<span class="k-ck-id-name">' + sanitize(dName || dPhone) + '</span>'
    +       '<span class="k-ck-id-verified" aria-label="Identité vérifiée"><span class="k-ck-id-verified-ic" aria-hidden="true">✅</span> identifié</span>'
    +     '</span>'
    +     (dName && dPhone ? '<span class="k-ck-id-num">' + sanitize(dPhone) + '</span>' : '')
    +   '</span>'
    +   '<span class="k-ck-id-actions-col">'
    +     '<button type="button" class="k-ck-id-change">Votre numéro a changé&nbsp;?</button>'
    +     '<button type="button" class="k-ck-id-notyou">Ce n’est pas vous&nbsp;?</button>'
    +   '</span>'
    + '</div>';
  return el;
}

function applyIdentityToCard(card, identity) {
  if (!card || !identity) return;
  const n = identity.full_name || identity.name || '';
  const p = identity.phone || '';
  const iv = card.querySelector('.k-ck-id-initials'); if (iv) iv.textContent = _idInitials(n || p);
  const nv = card.querySelector('.k-ck-id-name');     if (nv) nv.textContent = n || p;
  let pv = card.querySelector('.k-ck-id-num');
  if (n && p) {
    if (!pv) {
      pv = document.createElement('span');
      pv.className = 'k-ck-id-num';
      const ident = card.querySelector('.k-ck-id-ident');
      ident?.appendChild(pv);
    }
    pv.textContent = p;
  } else if (pv) {
    pv.remove();
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   b-utils.js
   ═══════════════════════════════════════════════════════════════════════════ */

describe('optimizeImgUrl', () => {
  test('retourne l’url inchangée si pas Cloudinary', () => {
    expect(optimizeImgUrl('https://example.com/img.jpg')).toBe('https://example.com/img.jpg');
  });

  test('retourne l’url inchangée si déjà optimisée', () => {
    const url = 'https://res.cloudinary.com/dloffvvdz/image/upload/f_auto,q_auto/v1/prod.jpg';
    expect(optimizeImgUrl(url)).toBe(url);
  });

  test('injecte f_auto,q_auto sans largeur', () => {
    const url = 'https://res.cloudinary.com/dloffvvdz/image/upload/v1/prod.jpg';
    expect(optimizeImgUrl(url)).toContain('/upload/f_auto,q_auto/');
  });

  test('injecte la largeur demandée', () => {
    const url = 'https://res.cloudinary.com/dloffvvdz/image/upload/v1/prod.jpg';
    expect(optimizeImgUrl(url, 400)).toContain('w_400');
  });

  test('retourne null si null', () => {
    expect(optimizeImgUrl(null)).toBeNull();
  });
});

describe('sanitize', () => {
  test('échappe les balises HTML', () => {
    expect(sanitize('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('conserve le texte simple', () => {
    expect(sanitize('Komerce')).toBe('Komerce');
  });

  test('échappe &', () => {
    expect(sanitize('a & b')).toBe('a &amp; b');
  });

  test('neutralise une injection attributaire', () => {
    expect(sanitize('<img src=x onerror=alert(1)>')).not.toContain('<img');
  });
});

describe('fmt', () => {
  test('convertit KMF en EUR au taux 495', () => {
    expect(fmt(9900, 'EUR')).toBe('20 €');
  });

  test('retourne KMF sans conversion', () => {
    expect(fmt(5000, 'KMF')).toBe('5\u202f000 KMF');
  });

  test('arrondit à l’entier le plus proche', () => {
    expect(fmt(1000, 'EUR')).toBe('2 €');
  });
});

describe('fmtPrice', () => {
  test('formate 12500 en KMF', () => {
    expect(fmtPrice(12500)).toBe('12\u202f500 KMF');
  });

  test('formate 0 en KMF', () => {
    expect(fmtPrice(0)).toBe('0 KMF');
  });
});

describe('productEmoji', () => {
  test('retourne l’emoji du produit si défini', () => {
    expect(productEmoji({ emoji: '👗' })).toBe('👗');
  });

  test('retourne le colis par défaut si absent', () => {
    expect(productEmoji({})).toBe('📦');
  });

  test('retourne le colis par défaut si null', () => {
    expect(productEmoji({ emoji: null })).toBe('📦');
  });
});

describe('genIdempotencyKey', () => {
  test('retourne une string non vide', () => {
    const key = genIdempotencyKey();
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });

  test('deux appels retournent deux clés différentes', () => {
    expect(genIdempotencyKey()).not.toBe(genIdempotencyKey());
  });

  test('respecte le format UUID v4', () => {
    expect(genIdempotencyKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   b-cart-core.js
   ═══════════════════════════════════════════════════════════════════════════ */

describe('cartQty', () => {
  test('retourne 0 pour un panier vide', () => {
    expect(cartQty([])).toBe(0);
  });

  test('somme les quantités', () => {
    const cart = [
      { qty: 2, product: { price_kmf: 1000 } },
      { qty: 3, product: { price_kmf: 2000 } },
    ];
    expect(cartQty(cart)).toBe(5);
  });

  test('gère un seul article', () => {
    expect(cartQty([{ qty: 1, product: { price_kmf: 500 } }])).toBe(1);
  });
});

describe('cartTotal', () => {
  test('retourne 0 pour un panier vide', () => {
    expect(cartTotal([])).toBe(0);
  });

  test('calcule correctement le total', () => {
    const cart = [
      { qty: 2, product: { price_kmf: 1000 } },
      { qty: 1, product: { price_kmf: 3000 } },
    ];
    expect(cartTotal(cart)).toBe(5000);
  });

  test('traite price_kmf manquant comme 0', () => {
    expect(cartTotal([{ qty: 2, product: {} }])).toBe(0);
  });
});

describe('isFav', () => {
  test('retourne true si présent', () => {
    expect(isFav(['42', '7'], '42')).toBe(true);
  });

  test('retourne false si absent', () => {
    expect(isFav(['42', '7'], '99')).toBe(false);
  });

  test('compare en string', () => {
    expect(isFav([42], '42')).toBe(true);
    expect(isFav(['42'], 42)).toBe(true);
  });

  test('retourne false sur favoris vides', () => {
    expect(isFav([], '1')).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   b-checkout-render.js
   ═══════════════════════════════════════════════════════════════════════════ */

describe('renderFulfillmentSelector', () => {
  test('crée les deux boutons Comores et France', () => {
    const container = document.createElement('div');
    renderFulfillmentSelector(container, { fulfillment_zone: 'comoros' }, jest.fn());
    expect(container.querySelectorAll('.ck-fulfillment-btn')).toHaveLength(2);
    expect(container.textContent).toContain('Retrait aux Comores');
    expect(container.textContent).toContain('Retrait en France');
  });

  test('marque la zone courante comme active', () => {
    const container = document.createElement('div');
    renderFulfillmentSelector(container, { fulfillment_zone: 'france' }, jest.fn());
    expect(container.querySelector('[data-zone="france"]').classList.contains('active')).toBe(true);
  });

  test('change de zone, reset selectedRelaisId et appelle onChange', () => {
    const container = document.createElement('div');
    const od = { fulfillment_zone: 'comoros', selectedRelaisId: 'anjouan-1' };
    const onChange = jest.fn();
    renderFulfillmentSelector(container, od, onChange);
    container.querySelector('[data-zone="france"]').click();
    expect(od.fulfillment_zone).toBe('france');
    expect(od.selectedRelaisId).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('ne rappelle pas onChange si clic sur la même zone', () => {
    const container = document.createElement('div');
    const od = { fulfillment_zone: 'comoros', selectedRelaisId: 'anjouan-1' };
    const onChange = jest.fn();
    renderFulfillmentSelector(container, od, onChange);
    container.querySelector('[data-zone="comoros"]').click();
    expect(onChange).not.toHaveBeenCalled();
    expect(od.selectedRelaisId).toBe('anjouan-1');
  });
});

describe('_idInitials', () => {
  test('initiales d’un nom complet', () => {
    expect(_idInitials('Ali Mohamed')).toBe('AM');
  });

  test('initiale d’un prénom seul', () => {
    expect(_idInitials('Ali')).toBe('A');
  });

  test('retourne ? si vide', () => {
    expect(_idInitials('')).toBe('?');
  });

  test('prend première et dernière initiale sur 3 mots', () => {
    expect(_idInitials('Ali Ben Mohamed')).toBe('AM');
  });

  test('gère les espaces multiples', () => {
    expect(_idInitials('Ali  Mohamed')).toBe('AM');
  });
});

describe('buildIdentityRecapDOM', () => {
  test('retourne un élément avec id ck-identity-recap', () => {
    const el = buildIdentityRecapDOM({ full_name: 'Ali Mohamed', phone: '+269600001' });
    expect(el.id).toBe('ck-identity-recap');
  });

  test('affiche le nom', () => {
    const el = buildIdentityRecapDOM({ full_name: 'Ali Mohamed', phone: '+269600001' });
    expect(el.querySelector('.k-ck-id-name').textContent).toBe('Ali Mohamed');
  });

  test('affiche le téléphone quand nom et phone présents', () => {
    const el = buildIdentityRecapDOM({ full_name: 'Ali Mohamed', phone: '+269600001' });
    expect(el.querySelector('.k-ck-id-num').textContent).toBe('+269600001');
  });

  test('n’affiche pas .k-ck-id-num si seulement phone', () => {
    const el = buildIdentityRecapDOM({ phone: '+269600001' });
    expect(el.querySelector('.k-ck-id-num')).toBeNull();
  });

  test('calcule les initiales', () => {
    const el = buildIdentityRecapDOM({ full_name: 'Ali Mohamed' });
    expect(el.querySelector('.k-ck-id-initials').textContent).toBe('AM');
  });

  test('échappe le HTML dans le nom', () => {
    const el = buildIdentityRecapDOM({ full_name: '<img src=x onerror=alert(1)>' });
    expect(el.querySelector('.k-ck-id-name').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(el.innerHTML).not.toContain('<img src=x');
  });

  test('contient les deux boutons d’action', () => {
    const el = buildIdentityRecapDOM({ full_name: 'Ali Mohamed' });
    expect(el.querySelector('.k-ck-id-change')).not.toBeNull();
    expect(el.querySelector('.k-ck-id-notyou')).not.toBeNull();
  });
});

describe('applyIdentityToCard', () => {
  test('ne jette pas si card null', () => {
    expect(() => applyIdentityToCard(null, { full_name: 'Ali' })).not.toThrow();
  });

  test('ne jette pas si identity null', () => {
    const card = buildIdentityRecapDOM({ full_name: 'Ali Mohamed', phone: '+269600001' });
    expect(() => applyIdentityToCard(card, null)).not.toThrow();
  });

  test('met à jour le nom, les initiales et le téléphone existant', () => {
    const card = buildIdentityRecapDOM({ full_name: 'Ali Mohamed', phone: '+269600001' });
    applyIdentityToCard(card, { full_name: 'Sara Abdou', phone: '+269600002' });
    expect(card.querySelector('.k-ck-id-name').textContent).toBe('Sara Abdou');
    expect(card.querySelector('.k-ck-id-initials').textContent).toBe('SA');
    expect(card.querySelector('.k-ck-id-num').textContent).toBe('+269600002');
  });

  test('crée le téléphone si la carte n’en avait pas encore', () => {
    const card = buildIdentityRecapDOM({ full_name: 'Ali Mohamed' });
    applyIdentityToCard(card, { full_name: 'Ali Mohamed', phone: '+269600003' });
    expect(card.querySelector('.k-ck-id-num').textContent).toBe('+269600003');
  });

  test('supprime le téléphone si le nouveau payload n’a plus de phone', () => {
    const card = buildIdentityRecapDOM({ full_name: 'Ali Mohamed', phone: '+269600001' });
    applyIdentityToCard(card, { full_name: 'Ali Mohamed' });
    expect(card.querySelector('.k-ck-id-num')).toBeNull();
  });

  test('utilise le téléphone comme libellé si le nom est absent', () => {
    const card = buildIdentityRecapDOM({ full_name: 'Ali Mohamed', phone: '+269600001' });
    applyIdentityToCard(card, { phone: '+269600004' });
    expect(card.querySelector('.k-ck-id-name').textContent).toBe('+269600004');
  });
});
