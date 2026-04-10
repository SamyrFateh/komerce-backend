/* =========================================
   boutique.js — Komerce Boutique v4
   Logique UI, API, panier, modales, PWA
   Requires: DOMPurify (loaded before this)
   API: https://komerce-backend-production.up.railway.app
   ========================================= */

/* Module-level state */
var _firstLoad = true;
setTimeout(function(){ _firstLoad = false; }, 2000);

/* ── safe innerHTML wrapper (Sprint 4b — S6 XSS fix) ── */
var _dpConfig = { ADD_ATTR: ['style'], ADD_TAGS: ['img'], ALLOW_DATA_ATTR: true };
function safeHTML(el, h) { el.innerHTML = (typeof DOMPurify !== 'undefined') ? DOMPurify.sanitize(h, _dpConfig) : h; }
function sanitize(h) { return (typeof DOMPurify !== 'undefined') ? DOMPurify.sanitize(h, _dpConfig) : h; }

/* ── Proverbes africains ── */
var _proverbes = [
  "Seul on va vite, ensemble on va loin.",
  "La patience est un arbre dont la racine est amère mais le fruit très doux.",
  "Celui qui a été mordu par un serpent se méfie d'une corde.",
  "L'eau chaude n'oublie pas qu'elle a été froide.",
  "La lune brille mais ne chauffe pas.",
  "Quand la musique change, la danse change aussi.",
  "Un seul doigt ne peut pas ramasser un caillou.",
  "Le singe ne voit pas sa propre nuque.",
  "La parole est comme l'eau : une fois versée, on ne la ramasse plus.",
  "Là où l'on s'aime, il ne fait jamais nuit.",
  "Le feu qui te brûlera, c'est celui auquel tu te chauffes.",
  "L'arbre ne tombe pas du premier coup de hache.",
  "Ce n'est pas la force du courant qui fait tourner le moulin, c'est l'eau.",
  "Quand tu ne sais pas où tu vas, regarde d'où tu viens.",
  "La nuit a beau durer, le jour finit par arriver.",
  "Un vieillard assis voit plus loin qu'un jeune debout.",
  "Le monde est une marmite, chacun y remue sa cuillère.",
  "Celui qui plante un arbre n'a pas vécu pour rien.",
  "La terre n'est pas un héritage de nos parents, c'est un prêt de nos enfants.",
  "Le caméléon change de couleur mais ne change pas de nature."
];
var _proIdx = Math.floor(Math.random() * _proverbes.length);
function rotateProverbe() {
  _proIdx = (_proIdx + 1) % _proverbes.length;
  var el = document.getElementById('hero-proverbe');
  if (el) {
    el.style.opacity = '0';
    setTimeout(function() {
      el.textContent = '« ' + _proverbes[_proIdx] + ' »';
      el.style.opacity = '1';
    }, 400);
  }
}
// Auto-rotate every 12s
setInterval(rotateProverbe, 12000);




/* ═══════════════════════════════════════════════════
   BLOOM NAVIGATION JS — Injected from Web
   ═══════════════════════════════════════════════════ */
// ═══════════════════════════════════════════════════════════════════
//  INNOVATIVE CATEGORY NAVIGATION — v2 Genius
// ═══════════════════════════════════════════════════════════════════

var _situations = {
  mode: {
    icon: '\u{1F457}', label: 'Mode & accessoires', color: '#7c3aed', rgb: '124,58,237',
    matchCats: ['mode','vetements','fashion','tissus','chaussures','accessoires','wax','ceremonie','tenues'],
    subcats: [
      { id:'mode-vetements',  name:'V\u00eatements & boubous', emoji:'\u{1F458}', category:'vetements',  desc:'Tenues, boubous, abayas' },
      { id:'mode-tissus',     name:'Tissus & couture',    emoji:'\u{1F9F5}', category:'tissus',     desc:'Wax, bazin, dentelle' },
      { id:'mode-chaussures', name:'Chaussures',          emoji:'\u{1F45F}', category:'chaussures', desc:'Sneakers, sandales' },
      { id:'mode-access',     name:'Accessoires',         emoji:'\u{1F48D}', category:'accessoires',desc:'Sacs, bijoux, montres' }
    ]
  },
  maison: {
    icon: '\u{1F3E0}', label: 'Maison', color: '#0891b2', rgb: '8,145,178',
    matchCats: ['maison','home','cuisine','decoration','entretien','equipement','electromenager'],
    subcats: [
      { id:'maison-cuisine',  name:'Cuisine',         emoji:'\u{1F373}', category:'cuisine',     desc:'Ustensiles, appareils' },
      { id:'maison-deco',     name:'D\u00e9coration', emoji:'\u{1FAB4}', category:'decoration',  desc:'Tableaux, luminaires' },
      { id:'maison-entret',   name:'Entretien',       emoji:'\u{1F9F9}', category:'entretien',   desc:'Nettoyage, m\u00e9nager' },
      { id:'maison-equip',    name:'\u00c9quipement', emoji:'\u{1F50C}', category:'equipement',  desc:'Ventilo, multiprises' }
    ]
  },
  tech: {
    icon: '\u{1F4F1}', label: '\u00c9lectronique', color: '#0369a1', rgb: '3,105,161',
    matchCats: ['tech','telephones','electronique','electronics','audio','hightech','accessoires-tel'],
    subcats: [
      { id:'tech-phones',    name:'T\u00e9l\u00e9phones', emoji:'\u{1F4F1}', category:'telephones',     desc:'Samsung, Xiaomi' },
      { id:'tech-access',    name:'Accessoires tel',  emoji:'\u{1F50B}', category:'accessoires-tel',desc:'Coques, chargeurs' },
      { id:'tech-audio',     name:'Audio & image',    emoji:'\u{1F3A7}', category:'audio',          desc:'\u00c9couteurs, enceintes' },
      { id:'tech-hightech',  name:'High-tech',        emoji:'\u{1F4BB}', category:'hightech',       desc:'Tablettes, PC' }
    ]
  },
  beaute: {
    icon: '\u{1F484}', label: 'Beaut\u00e9 & bien-\u00eatre', color: '#db2777', rgb: '219,39,119',
    matchCats: ['beaute','beauty','soins','cheveux','parfums','maquillage','services'],
    subcats: [
      { id:'beaute-soins',    name:'Soins',       emoji:'\u{1F9F4}', category:'soins',     desc:'Visage, corps' },
      { id:'beaute-cheveux',  name:'Cheveux',     emoji:'\u{1F487}', category:'cheveux',   desc:'Huiles, soins' },
      { id:'beaute-parfums',  name:'Parfums',     emoji:'\u{1F338}', category:'parfums',   desc:'Oud, musc' },
      { id:'beaute-makeup',   name:'Maquillage',  emoji:'\u{1F484}', category:'maquillage',desc:'Palettes, rouges' }
    ]
  },
  enfants: {
    icon: '\u{1F9F8}', label: 'Enfants & b\u00e9b\u00e9', color: '#e11d48', rgb: '225,29,72',
    matchCats: ['enfants','enfant','bebe','jouets','ecole','kids'],
    subcats: [
      { id:'enf-vetements', name:'V\u00eatements enfant', emoji:'\u{1F476}', category:'vetements-enfant', desc:'Boubous, robes' },
      { id:'enf-bebe',      name:'B\u00e9b\u00e9',       emoji:'\u{1F37C}', category:'bebe',             desc:'Couches, biberons' },
      { id:'enf-jouets',    name:'Jouets',            emoji:'\u{1F3AE}', category:'jouets',           desc:'Jeux, peluches' },
      { id:'enf-ecole',     name:'\u00c9cole',       emoji:'\u{1F4DA}', category:'ecole',            desc:'Cahiers, cartables' }
    ]
  },
  surmesure: {
    icon: '\u2728', label: 'Sur Mesure', color: '#7e22ce', rgb: '126,34,206',
    matchCats: ['surmesure','couture','personnalise','custom','sur-mesure','mariage-custom','optique','scolaire','traditionnel','ceremonie-custom','wedding'],
    subcats: [
      { id:'sm-couture',    name:'Couture',             emoji:'\u2702\uFE0F', category:'couture',          desc:'Tissus, abayas, salouva, caftans' },
      { id:'sm-mariage',    name:'Mariage',             emoji:'\u{1F492}',     category:'mariage-custom',   desc:'Tenue mari\u00e9e, d\u00e9co, coffret' },
      { id:'sm-scolaire',   name:'Scolaire',            emoji:'\u{1F393}',     category:'scolaire',         desc:'Uniformes, fournitures' },
      { id:'sm-fetes',      name:'F\u00eates & c\u00e9r\u00e9monies', emoji:'\u{1F389}', category:'fetes', desc:'Manzaraka, Anda, anniversaires' },
      { id:'sm-tradition',  name:'Traditionnel',        emoji:'\u{1F458}',     category:'traditionnel',     desc:'Chiromani, kofia, kangas' },
      { id:'sm-optique',    name:'Optique',             emoji:'\u{1F453}',     category:'optique',          desc:'Lunettes, verres correcteurs' }
    ]
  }
};

var _activeMainCat = null;
var _activeSubCat = null;
var _currentSort = '';
var _bloomTimeout = null;
var _bloomLocked = false;
var _lastList = [];

function bloomHover(catKey) {
  if (_bloomLocked) return;
  clearTimeout(_bloomTimeout);
  if (!catKey) { closeBloom(); return; }
  openBloom(catKey);
}

function bloomNav(catKey) {
  _activeSubCat = null;
  if (!catKey) {
    _activeMainCat = null;
    _bloomLocked = false;
    closeBloom();
    updateOrbs(null);
    updatePath();
    filterProductsByNav();
    return;
  }
  if (_activeMainCat === catKey && _bloomLocked) {
    _activeMainCat = null;
    _bloomLocked = false;
    closeBloom();
    updateOrbs(null);
    updatePath();
    filterProductsByNav();
    return;
  }
  _activeMainCat = catKey;
  _bloomLocked = true;
  openBloom(catKey);
  updateOrbs(catKey);
  updatePath();
  filterProductsByNav();
}

function openBloom(catKey) {
  var sit = _situations[catKey];
  if (!sit) return;
  var panel = document.getElementById('bloom-panel');
  if (!panel) return; /* bloom nav non présente dans cette vue */
  var pointer = document.getElementById('bloom-pointer');
  var header = document.getElementById('bloom-header');
  var grid = document.getElementById('bloom-grid');

  // Position pointer
  var row = document.getElementById('cat-row');
  if (!row) return;
  var target = row.querySelector('[data-cat="' + catKey + '"]');
  if (target && row) {
    var rr = row.getBoundingClientRect();
    var tr = target.getBoundingClientRect();
    pointer.style.left = ((tr.left + tr.width/2) - rr.left) + 'px';
  }

  // Colors
  panel.style.setProperty('--bloom-color', sit.color);
  panel.style.setProperty('--bloom-rgb', sit.rgb);

  // Header
  safeHTML(header, '<span class="bloom-header-icon">' + sanitize(sit.icon) + '</span><span class="bloom-header-text" style="color:' + sanitize(sit.color) + '">' + sanitize(sit.label) + '</span>');
  header.style.borderBottom = '2px solid ' + sit.color + '33';

  // Chips
  var h = '';
  sit.subcats.forEach(function(sc) {
    var sel = (_activeSubCat && _activeSubCat.id === sc.id) ? ' selected' : '';
    h += '<div class="bloom-chip' + sel + '" data-sc-id="' + sc.id + '" data-cat-key="' + catKey + '" style="--bloom-color:' + sit.color + ';--bloom-rgb:' + sit.rgb + '">' +
         '<span class="chip-emoji">' + sc.emoji + '</span>' +
         '<span class="chip-name">' + sc.name + '</span></div>';
  });
  safeHTML(grid, h);
  panel.classList.add('open');
}

function closeBloom() {
  var bp = document.getElementById('bloom-panel');
  if (bp) bp.classList.remove('open');
}

function bloomLeave() {
  if (_bloomLocked) return;
  _bloomTimeout = setTimeout(closeBloom, 250);
}

function selectSubcat(scId, catKey) {
  var sit = _situations[catKey];
  if (!sit) return;
  var sc = null;
  sit.subcats.forEach(function(s) { if (s.id === scId) sc = s; });
  if (!sc) return;
  if (_activeSubCat && _activeSubCat.id === scId) {
    _activeSubCat = null;
  } else {
    _activeSubCat = sc;
    _activeMainCat = catKey;
    _bloomLocked = true;
  }
  updateOrbs(catKey);
  openBloom(catKey);
  updatePath();
  filterProductsByNav();
}

function updateOrbs(catKey) {
  document.querySelectorAll('.cat-item').forEach(function(el) {
    el.classList.toggle('active', (!catKey && el.dataset.cat === '') || el.dataset.cat === catKey);
  });
}

function updatePath() {
  var p = document.getElementById('cat-path');
  if (!p) return;
  if (!_activeMainCat) { p.innerHTML = ''; return; }
  var s = _situations[_activeMainCat];
  var h = '<span style="color:' + s.color + '">' + s.icon + ' ' + s.label + '</span>';
  if (_activeSubCat) h += ' <span style="color:#ccc">\u203a</span> <span style="color:' + s.color + '">' + _activeSubCat.emoji + ' ' + _activeSubCat.name + '</span>';
  safeHTML(p, h);
}

function filterProductsByNav() {
  if (typeof _products === 'undefined' || !_products || !_products.length) return;
  if (!_activeMainCat) { renderProducts(_products); return; }
  var sit = _situations[_activeMainCat];
  if (_activeSubCat) {
    var k = _activeSubCat.category.toLowerCase();
    renderProducts(_products.filter(function(p) {
      var c = (p.category||'').toLowerCase();
      return c === k || c.indexOf(k) !== -1;
    }));
  } else {
    var mc = sit.matchCats.map(function(c){return c.toLowerCase();});
    renderProducts(_products.filter(function(p) {
      var c = (p.category||'').toLowerCase();
      return mc.some(function(m){ return c===m||c.indexOf(m)!==-1||m.indexOf(c)!==-1; });
    }));
  }
}




/* ── State ── */
let _cart;
var CART_VERSION = 2;
try {
  var savedVersion = parseInt(localStorage.getItem('kmrc_cart_v') || '0', 10);
  if (savedVersion < CART_VERSION) {
    console.info('Cart version upgrade ' + savedVersion + ' → ' + CART_VERSION + ', clearing old data');
    _cart = [];
    localStorage.removeItem('kmrc_cart');
    localStorage.setItem('kmrc_cart_v', String(CART_VERSION));
  } else {
    _cart = JSON.parse(localStorage.getItem('kmrc_cart') || '[]');
  }
} catch(e) {
  console.warn('Cart data corrupted, resetting:', e);
  _cart = [];
  localStorage.removeItem('kmrc_cart');
  localStorage.setItem('kmrc_cart_v', String(CART_VERSION));
}
let _products = [];
let _relais = [];
let _rates = { EUR: 495, KMF: 1 };
let _currency = detectCurrency();
let _pdQty = 1;

/* ── Helpers ── */
function $(id) { return document.getElementById(id); }


function detectCurrency() {
  try {
    var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (/Comoro|Mayotte/i.test(tz)) return 'KMF';
  } catch (e) {}
  return 'EUR';
}

function fmt(kmf, currency) {
  if (!currency) currency = _currency;
  var rate = _rates[currency] || 1;
  var val = Math.round(kmf / rate);
  return val.toLocaleString('fr-FR') + (currency === 'EUR' ? ' €' : ' KMF');
}

function fmtBoth(kmf) {
  var s = fmt(kmf, 'KMF');
  if (_currency === 'EUR') s += ' (≈ ' + fmt(kmf, 'EUR') + ')';
  return s;
}

function productEmoji(p) { return p.emoji || '📦'; }

function availabilityInfo(p) {
  if (p.is_available !== false && (p.stock === null || p.stock === undefined || p.stock > 0))
    return { label: 'Disponible', cls: 'disponible', icon: '✅' };
  if (p.is_available === false && p.sourcing_source)
    return { label: 'Bientôt disponible', cls: 'sourcing', icon: '🔄' };
  return { label: 'Sur commande', cls: 'surcommande', icon: '📋' };
}

function categoryLabel(cat) {
  var labels = {
    'electronics': 'Électronique',
    'home': 'Maison & Cuisine',
    'wedding': 'Mariage & Cadeaux',
    'fashion': 'Mode & Vêtements',
    'services': 'Beauté & Soins',
    'beauty': 'Beauté & Soins'
  };
  return labels[cat] || cat || '';
}


/* ── API ── */
var API_BASE = 'https://komerce-backend-production.up.railway.app';
async function apiGet(path) {
  var res = await fetch(API_BASE + path, { credentials: 'include' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function apiPost(path, body) {
  var res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body)
  });
  var data = await res.json();
  if (!res.ok) {
    var err = new Error(data.message || data.error || 'Erreur serveur');
    err.data = data;
    throw err;
  }
  return data;
}

/* ── Toast générique ── */
function toast(msg, type) {
  type = type || 'info';
  var c = $('toast-container');
  var t = document.createElement('div');
  t.className = 'toast ' + type;
  var icons = { success: '✅', error: '❌', info: 'ℹ️' };
  var iconEl = document.createElement('span');
  iconEl.className = 'toast-icon';
  iconEl.textContent = icons[type] || 'ℹ️';
  var textEl = document.createElement('span');
  textEl.textContent = msg;
  t.appendChild(iconEl);
  t.appendChild(textEl);
  c.appendChild(t);
  setTimeout(function() {
    t.style.opacity = '0';
    t.style.transform = 'translateX(40px)';
    t.style.transition = 'opacity 0.3s, transform 0.3s';
    setTimeout(function() { t.remove(); }, 350);
  }, 3000);
}



/* ── Fly-to-cart animation ── */
function flyToCart(sourceEl, product) {
  var cartIcon = document.querySelector('.cart-btn');
  if (!cartIcon || !sourceEl) return;
  var srcRect = sourceEl.getBoundingClientRect();
  var dstRect = cartIcon.getBoundingClientRect();
  var startX = srcRect.left + srcRect.width / 2;
  var startY = srcRect.top + srcRect.height / 2;
  var endX = dstRect.left + dstRect.width / 2;
  var endY = dstRect.top + dstRect.height / 2;

  /* ── Particule principale ── */
  var particle = document.createElement('div');
  particle.style.cssText = [
    'position:fixed', 'z-index:9999', 'pointer-events:none',
    'border-radius:50%', 'background:var(--primary)',
    'width:56px', 'height:56px',
    'display:flex', 'align-items:center', 'justify-content:center',
    'font-size:1.5rem',
    'box-shadow:0 4px 20px rgba(74,85,104,0.6), 0 0 30px rgba(74,85,104,0.3)',
    'overflow:hidden',
    'left:' + startX + 'px',
    'top:' + startY + 'px',
    'transform:translate(-50%,-50%) scale(0)',
    'opacity:0'
  ].join(';');

  if (product.image_url) {
    var img = document.createElement('img');
    img.src = product.image_url;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
    particle.appendChild(img);
  } else {
    particle.textContent = productEmoji(product);
  }
  document.body.appendChild(particle);

  /* ── Traînée de particules scintillantes ── */
  var sparkles = [];
  for (var s = 0; s < 6; s++) {
    var sp = document.createElement('div');
    sp.style.cssText = [
      'position:fixed', 'z-index:9998', 'pointer-events:none',
      'border-radius:50%', 'background:var(--accent)',
      'width:8px', 'height:8px',
      'left:' + startX + 'px', 'top:' + startY + 'px',
      'transform:translate(-50%,-50%)',
      'opacity:0'
    ].join(';');
    document.body.appendChild(sp);
    sparkles.push(sp);
  }

  /* ── Phase 1 : Pop-in avec rebond (0 → 300ms) ── */
  particle.getBoundingClientRect();
  particle.style.transition = 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s ease-out';
  particle.style.transform = 'translate(-50%,-50%) scale(1.15)';
  particle.style.opacity = '1';

  /* ── Phase 2 : Vol en arc parabolique (300ms → 1200ms) ── */
  var duration = 900;
  var startTime = null;
  var midY = Math.min(startY, endY) - 120; /* point haut de l'arc */

  function animateArc(timestamp) {
    if (!startTime) startTime = timestamp;
    var elapsed = timestamp - startTime;
    var t = Math.min(elapsed / duration, 1);

    /* Easing: ease-in-out */
    var ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    /* Position parabolique */
    var x = startX + (endX - startX) * ease;
    var arcT = 1 - Math.pow(2 * t - 1, 2); /* parabole qui monte puis descend */
    var y = startY + (endY - startY) * ease - arcT * 120;

    /* Taille qui diminue progressivement */
    var scale = 1.15 - (0.85 * ease);

    /* Rotation pour l'effet dynamique */
    var rot = ease * 360;

    particle.style.transition = 'none';
    particle.style.left = x + 'px';
    particle.style.top = y + 'px';
    particle.style.transform = 'translate(-50%,-50%) scale(' + scale + ') rotate(' + rot + 'deg)';
    particle.style.opacity = String(1 - ease * 0.3);
    particle.style.boxShadow = '0 4px ' + (20 - 15 * ease) + 'px rgba(74,85,104,' + (0.6 - 0.4 * ease) + ')';

    /* Traînée scintillante */
    for (var i = 0; i < sparkles.length; i++) {
      var delay = i * 0.12;
      var st = Math.max(0, t - delay);
      if (st > 0 && st < 1) {
        var sx = startX + (endX - startX) * st;
        var sArc = 1 - Math.pow(2 * st - 1, 2);
        var sy = startY + (endY - startY) * st - sArc * 120;
        var scatter = (Math.random() - 0.5) * 16;
        sparkles[i].style.transition = 'none';
        sparkles[i].style.left = (sx + scatter) + 'px';
        sparkles[i].style.top = (sy + scatter) + 'px';
        sparkles[i].style.opacity = String(0.8 - st);
        sparkles[i].style.transform = 'translate(-50%,-50%) scale(' + (1 - st * 0.7) + ')';
      }
    }

    if (t < 1) {
      requestAnimationFrame(animateArc);
    } else {
      /* ── Phase 3 : Impact sur le panier ── */
      particle.style.transition = 'transform 0.15s ease-in, opacity 0.15s ease-in';
      particle.style.transform = 'translate(-50%,-50%) scale(0)';
      particle.style.opacity = '0';

      /* Pulse sur l'icône panier */
      cartIcon.style.transition = 'transform 0.15s ease-out';
      cartIcon.style.transform = 'scale(1.3)';
      setTimeout(function() {
        cartIcon.style.transition = 'transform 0.25s cubic-bezier(0.34,1.56,0.64,1)';
        cartIcon.style.transform = 'scale(1)';
      }, 150);

      setTimeout(function() {
        particle.remove();
        sparkles.forEach(function(sp) { sp.remove(); });
      }, 200);

      var badge = document.getElementById('cart-count');
      if (badge) { badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump'); }
    }
  }

  setTimeout(function() {
    requestAnimationFrame(animateArc);
  }, 350);
}

/* ── Feedback bouton ── */
function btnAddedFeedback(btn, originalText) {
  btn.textContent = '✅ Ajouté !';
  btn.classList.add('added');
  btn.disabled = true;
  setTimeout(function() {
    btn.textContent = originalText;
    btn.classList.remove('added');
    btn.disabled = false;
  }, 1600);
}

/* ──────────────────────────────────────
   PROMO BAR
   ────────────────────────────────────── */
function initPromoBar() {
  var msgs = document.querySelectorAll('#promo-bar .promo-msg');
  if (msgs.length < 2) return;
  var idx = 0;
  setInterval(function() {
    msgs[idx].classList.remove('active');
    idx = (idx + 1) % msgs.length;
    msgs[idx].classList.add('active');
  }, 4000);
}

/* ──────────────────────────────────────
   PRODUCTS
   ────────────────────────────────────── */
async function loadProducts() {
  try {
    var data = await apiGet('/api/products');
    _products = data.products || data || [];
    renderProducts(_products);
    updateCartBadges();
  } catch (e) {
    console.error('loadProducts:', e);
    var track = $('product-track');
    track.innerHTML = '';
    var errDiv = document.createElement('p');
    errDiv.style.cssText = 'text-align:center;color:var(--muted);padding:40px;width:100%;';
    errDiv.textContent = 'Impossible de charger le catalogue.';
    track.appendChild(errDiv);
  }
}

function renderProducts(list) {
  _lastList = list || [];
  var track = $('product-track');
  track.className = 'product-grid';
  track.innerHTML = '';
  if (!list || list.length === 0) {
    var empty = document.createElement('p');
    empty.style.cssText = 'text-align:center;color:var(--muted);padding:40px;grid-column:1/-1;';
    empty.textContent = 'Aucun produit trouvé.';
    track.appendChild(empty);
    return;
  }
  list.forEach(function(p) {
    var card = document.createElement('div');
    card.className = 'product-card';
    card.setAttribute('data-id', p.id);
    card.addEventListener('click', function(e) {
      if (e.target.closest('.btn-add-cart') || e.target.closest('.btn-fav')) return;
      openProductModal(p);
    });

    var imgDiv = document.createElement('div');
    imgDiv.className = 'card-img';
    imgDiv.style.position = 'relative';
    if (p.image_url) {
      var img = document.createElement('img');
      img.src = p.image_url;
      img.alt = sanitize(p.name);
      img.loading = 'eager';
      img.decoding = 'async';
      img.onerror = function() { this.style.display='none'; this.parentElement.textContent = productEmoji(p); };
      imgDiv.appendChild(img);
    } else {
      imgDiv.textContent = productEmoji(p);
    }

    /* Badge promo */
    if (p.is_promo && p.promo_pct) {
      var badge = document.createElement('div');
      badge.className = 'card-badge';
      badge.textContent = 'SOLDES -' + p.promo_pct + '%';
      imgDiv.appendChild(badge);
    }

    card.appendChild(imgDiv);

    /* Badge quantité panier */
    var cartBadge = document.createElement('div');
    cartBadge.className = 'card-cart-badge';
    cartBadge.setAttribute('data-badge-pid', p.id);
    var cartBadgeIcon = document.createElement('span');
    cartBadgeIcon.textContent = '🧺';
    cartBadgeIcon.style.fontSize = '0.7rem';
    cartBadge.appendChild(cartBadgeIcon);
    var cartBadgeQty = document.createElement('span');
    cartBadgeQty.className = 'badge-qty';
    cartBadgeQty.textContent = '0';
    cartBadge.appendChild(cartBadgeQty);
    card.appendChild(cartBadge);

    var body = document.createElement('div');
    body.className = 'card-body';

    var cat = document.createElement('div');
    cat.className = 'card-category';
    cat.textContent = categoryLabel(p.category);
    body.appendChild(cat);

    var name = document.createElement('div');
    name.className = 'card-name';
    name.textContent = p.name || 'Produit';
    name.title = p.name || '';
    body.appendChild(name);

    /* Prix barré si promo */
    if (p.is_promo && p.promo_pct && p.cost_kmf) {
      var origPrice = Math.round(p.price_kmf / (1 - p.promo_pct / 100));
      var orig = document.createElement('div');
      orig.className = 'card-price-original';
      orig.textContent = fmt(origPrice, 'KMF');
      body.appendChild(orig);
    }

    var price = document.createElement('div');
    price.className = 'card-price';
    price.textContent = fmt(p.price_kmf || 0, 'KMF');
    body.appendChild(price);

    if (_currency === 'EUR') {
      var conv = document.createElement('div');
      conv.className = 'card-price-conv';
      conv.textContent = '≈ ' + fmt(p.price_kmf || 0, 'EUR');
      body.appendChild(conv);
    }

    var avail = availabilityInfo(p);
    var availBadge = document.createElement('div');
    availBadge.className = 'avail-badge ' + avail.cls;
    availBadge.textContent = avail.icon + ' ' + avail.label;
    body.appendChild(availBadge);

    var actions = document.createElement('div');
    actions.className = 'card-actions';

    var addBtn = document.createElement('button');
    addBtn.className = 'btn-add-cart';
    addBtn.setAttribute('data-product-id', p.id);
    addBtn.textContent = '🧺 Ajouter';
    (function(product, btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        addToCart(product, 1, btn);
      });
    })(p, addBtn);
    actions.appendChild(addBtn);

    var favBtn = document.createElement('button');
    favBtn.className = 'btn-fav' + (isFav(p.id) ? ' is-fav' : '');
    favBtn.textContent = isFav(p.id) ? '♥' : '♡';
    (function(product, btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleFav(product.id);
        btn.textContent = isFav(product.id) ? '♥' : '♡';
        btn.className = 'btn-fav' + (isFav(product.id) ? ' is-fav' : '');
        toast(isFav(product.id) ? 'Ajouté aux favoris ♥' : 'Retiré des favoris', 'info');
        updateFavBadge();
      });
    })(p, favBtn);
    actions.appendChild(favBtn);

    body.appendChild(actions);
    card.appendChild(body);
    track.appendChild(card);
  });
}

function scrollCarousel(dir) {
  var track = $('product-track');
  var w = track.querySelector('.product-card');
  var scrollAmt = w ? (w.offsetWidth + 20) * 2 : 300;
  track.scrollBy({ left: dir * scrollAmt, behavior: 'smooth' });
}

/* ── LIVE SEARCH E-COMMERCE ── */
var _searchIdx = -1;
function heroSearch() {
  var q = $('hero-search-input').value.trim().toLowerCase();
  closeSearchDropdown();
  if (!q) { renderProducts(_products); return; }
  // API search for full results
  fetch('https://komerce-backend-production.up.railway.app/api/products?search=' + encodeURIComponent(q) + '&limit=50')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var results = data.products || data || [];
      renderProducts(results);
      if (!_firstLoad) { document.getElementById('catalogue').scrollIntoView({ behavior: 'smooth' }); }
    })
    .catch(function() {
      // Fallback local
      var filtered = _products.filter(function(p) {
        return (p.name || '').toLowerCase().indexOf(q) !== -1 ||
               (p.category || '').toLowerCase().indexOf(q) !== -1 ||
               (p.description || '').toLowerCase().indexOf(q) !== -1;
      });
      renderProducts(filtered);
      if (!_firstLoad) { document.getElementById('catalogue').scrollIntoView({ behavior: 'smooth' }); }
    });
}

function liveSearch(q) {
  var dd = $('search-dropdown');
  if (!q) { closeSearchDropdown(); return; }
  _searchIdx = -1;
  // Show loading
  safeHTML(dd, '<div class="search-no-result">🔍 Recherche…</div>');
  dd.classList.add('open');
  // API search (connects to DB)
  fetch('https://komerce-backend-production.up.railway.app/api/products?search=' + encodeURIComponent(q) + '&limit=8')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var results = data.products || data || [];
      if (results.length === 0) {
        safeHTML(dd, '<div class="search-no-result">Aucun produit trouvé pour «' + sanitize(q) + '»</div>');
      } else {
        safeHTML(dd, results.map(function(p, i) {
          var imgHtml = p.image_url
            ? '<img class="search-item-img" src="' + p.image_url + '" alt="">'
            : '<div class="search-item-emoji">' + (p.emoji || '📦') + '</div>';
          return '<div class="search-item" data-idx="' + i + '" data-pid="' + p.id + '">'
            + imgHtml
            + '<div class="search-item-info"><div class="search-item-name">' + sanitize(p.name) + '</div>'
            + '<div class="search-item-cat">' + sanitize(categoryLabel(p.category)) + '</div></div>'
            + '<div class="search-item-price">' + fmt(p.price_kmf || 0, 'KMF') + '</div>'
            + '</div>';
        }).join('') + '<div class="search-count">' + results.length + ' résultat' + (results.length > 1 ? 's' : '') + '</div>');
      }
      dd.classList.add('open');
      // Click → open product modal
      dd.querySelectorAll('.search-item').forEach(function(el) {
        el.addEventListener('click', function() {
          var pid = el.getAttribute('data-pid');
          // Find in local array first, fallback to search result
          var prod = _products.find(function(pp) { return String(pp.id) === pid; });
          if (!prod) prod = (data.products || []).find(function(pp) { return String(pp.id) === pid; });
          if (prod) { closeSearchDropdown(); openProductModal(prod); }
        });
      });
    })
    .catch(function() {
      // Fallback to local search
      var results = _products.filter(function(p) {
        return (p.name || '').toLowerCase().indexOf(q) !== -1 ||
               (p.category || '').toLowerCase().indexOf(q) !== -1;
      }).slice(0, 8);
      renderSearchDropdown(dd, results, q);
    });
}

function renderSearchDropdown(dd, results, q) {
  _searchIdx = -1;
  if (results.length === 0) {
    safeHTML(dd, '<div class="search-no-result">Aucun produit trouvé pour «' + sanitize(q) + '»</div>');
  } else {
    safeHTML(dd, results.map(function(p, i) {
      var imgHtml = p.image_url
        ? '<img class="search-item-img" src="' + p.image_url + '" alt="">'
        : '<div class="search-item-emoji">' + (p.emoji || '📦') + '</div>';
      return '<div class="search-item" data-idx="' + i + '" data-pid="' + p.id + '">'
        + imgHtml
        + '<div class="search-item-info"><div class="search-item-name">' + sanitize(p.name) + '</div>'
        + '<div class="search-item-cat">' + sanitize(categoryLabel(p.category)) + '</div></div>'
        + '<div class="search-item-price">' + fmt(p.price_kmf || 0, 'KMF') + '</div>'
        + '</div>';
    }).join('') + '<div class="search-count">' + results.length + ' résultat' + (results.length > 1 ? 's' : '') + '</div>');
  }
  dd.classList.add('open');
  dd.querySelectorAll('.search-item').forEach(function(el) {
    el.addEventListener('click', function() {
      var pid = el.getAttribute('data-pid');
      var prod = _products.find(function(pp) { return String(pp.id) === pid; });
      if (prod) { closeSearchDropdown(); openProductModal(prod); }
    });
  });
}

function closeSearchDropdown() {
  var dd = $('search-dropdown');
  if (dd) dd.classList.remove('open');
  _searchIdx = -1;
}

function initHeroSearch() {
  var input = $('hero-search-input');
  var btn = $('hero-search-btn');
  var debounce;
  // 🔍 button click → full search
  if (btn) {
    btn.addEventListener('click', function() { heroSearch(); });
  }
  input.addEventListener('input', function() {
    clearTimeout(debounce);
    debounce = setTimeout(function() {
      liveSearch(input.value.trim().toLowerCase());
    }, 300);
  });
  input.addEventListener('keydown', function(e) {
    var dd = $('search-dropdown');
    var items = dd.querySelectorAll('.search-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _searchIdx = Math.min(_searchIdx + 1, items.length - 1);
      items.forEach(function(el, i) { el.classList.toggle('active', i === _searchIdx); });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _searchIdx = Math.max(_searchIdx - 1, 0);
      items.forEach(function(el, i) { el.classList.toggle('active', i === _searchIdx); });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (_searchIdx >= 0 && items[_searchIdx]) {
        items[_searchIdx].click();
      } else {
        heroSearch();
      }
    } else if (e.key === 'Escape') {
      closeSearchDropdown();
    }
  });
  input.addEventListener('focus', function() {
    if (input.value.trim().length >= 2) liveSearch(input.value.trim().toLowerCase());
  });
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.nav-search-wrap')) closeSearchDropdown();
  });
}

/* ── PROVERBES & CITATIONS AFRICAINS ── */
var PROVERBS = [
  { text: "La mer ne se traverse pas avec des regrets.", origin: "🇰🇲 Comores" },
  { text: "On ne nourrit pas la mer avec ses larmes, mais avec ses bras.", origin: "🌍 Swahili" },
  { text: "Un seul bracelet ne fait pas de bruit.", origin: "🌍 Afrique de l'Est" },
  { text: "La patience est la clé du bonheur.", origin: "🇸🇳 Sénégal" },
  { text: "Si tu veux aller vite, marche seul. Si tu veux aller loin, marche ensemble.", origin: "🌍 Afrique" },
  { text: "La rivière ne dit pas à la montagne qu'elle est loin.", origin: "🇲🇬 Madagascar" },
  { text: "On ne récolte que ce que l'on a semé.", origin: "🌍 Swahili" },
  { text: "Celui qui n'a jamais voyagé croit que sa mère est la meilleure cuisinière.", origin: "🌍 Yoruba" },
  { text: "Un seul arbre ne fait pas une forêt.", origin: "🌍 Afrique centrale" },
  { text: "La main droite lave la main gauche.", origin: "🇲🇷 Mauritanie" },
  { text: "Ce n'est pas la mer qui décide où ira le bateau.", origin: "🇰🇲 Comores" },
  { text: "Quand la musique change, la danse change.", origin: "🌍 Haoussa" },
  { text: "Un ventre plein ne comprend pas un ventre vide.", origin: "🌍 Wolof" }
];
// Inject random proverb into #promo-bar
(function() {
  var el = document.getElementById('promo-proverb');
  if (!el || !PROVERBS.length) return;
  var p = PROVERBS[Math.floor(Math.random() * PROVERBS.length)];
  safeHTML(el, '\u2728 "' + sanitize(p.text) + '" \u2014 ' + sanitize(p.origin));
})();

/* promo-topbar JS removed — merged into #promo-bar */

/* ──────────────────────────────────────
   PRODUCT DETAIL MODAL
   ────────────────────────────────────── */
/* ── Règles de complémentarité ── */
var _complementRules = {
  'Mode':       ['Beauté', 'Sur-mesure'],
  'Sur-mesure': ['Mode', 'Beauté'],
  'Beauté':     ['Mode', 'Sur-mesure'],
  'Tech':       ['Tech'],
  'Enfant':     ['Enfant', 'Mode']
};

/* ── Favoris (localStorage) ── */
var _favs = {};
try { _favs = JSON.parse(localStorage.getItem('komerce_favs') || '{}'); } catch(e) { _favs = {}; }
function saveFavs() { try { localStorage.setItem('komerce_favs', JSON.stringify(_favs)); } catch(e) {} }
function toggleFav(productId) {
  if (_favs[productId]) { delete _favs[productId]; } else { _favs[productId] = true; }
  saveFavs();
}
function isFav(productId) { return !!_favs[productId]; }

function openProductModal(p, fromSuggestion) {
  // ── Historique navigation produit ──
  if (!window._productHistory) window._productHistory = [];
  if (fromSuggestion && window._currentModalProduct) {
    window._productHistory.push(window._currentModalProduct);
  }
  if (!fromSuggestion && !window._goingBack) {
    window._productHistory = []; // reset si ouverture directe (pas si retour)
  }
  window._goingBack = false;
  window._currentModalProduct = p;
  if ($("product-modal-title")) $("product-modal-title").textContent = p.name || "Produit";

  _pdQty = 1;
  var body = $('product-modal-body');
  body.innerHTML = '';
  body.scrollTop = 0;
  body.style.position = 'relative';
  var footer = $('product-modal-footer');
  footer.innerHTML = '';

  /* back button moved to hero image */

  /* ── Image héro plein format v3 ── */
  var heroDiv = document.createElement('div');
  heroDiv.className = 'pd-hero-img';

  /* Back button dans l'image (si historique) */
  if (window._productHistory && window._productHistory.length > 0) {
    var heroBack = document.createElement('button');
    heroBack.className = 'pd-hero-back';
    heroBack.innerHTML = '❮';
    heroBack.title = 'Retour';
    heroBack.addEventListener('click', function(e) {
      e.stopPropagation();
      var goBack = window._productHistory.pop();
      window._goingBack = true;
      openProductModal(goBack, false);
    });
    heroDiv.appendChild(heroBack);
  }

  if (p.image_url) {
    var img = document.createElement('img');
    img.src = p.image_url;
    img.alt = sanitize(p.name);
    img.loading = 'eager';
    img.onerror = function() {
      heroDiv.innerHTML = (window._productHistory && window._productHistory.length > 0 ? '<button class="pd-hero-back" onclick="var g=window._productHistory.pop();window._goingBack=true;openProductModal(g,false);">❮</button>' : '') + '<div class="pd-hero-fallback">' + productEmoji(p) + '</div><button class="pd-hero-fav"></button>';
    };
    heroDiv.appendChild(img);
  } else {
    var fallback = document.createElement('div');
    fallback.className = 'pd-hero-fallback';
    fallback.textContent = productEmoji(p);
    heroDiv.appendChild(fallback);
  }

  /* Fav button sur l'image */
  var favBtn = document.createElement('button');
  favBtn.className = 'pd-hero-fav';
  favBtn.textContent = isFav(p.id) ? '♥' : '♡';
  favBtn.style.color = isFav(p.id) ? '#ef4444' : '#bbb';
  favBtn.addEventListener('click', function() {
    toggleFav(p.id);
    favBtn.textContent = isFav(p.id) ? '♥' : '♡';
    favBtn.style.color = isFav(p.id) ? '#ef4444' : '#bbb';
    toast(isFav(p.id) ? 'Ajouté aux favoris ♥' : 'Retiré des favoris', 'info');
    updateFavBadge();
  });
  heroDiv.appendChild(favBtn);
  body.appendChild(heroDiv);

  /* ── Section info ── */
  var infoSec = document.createElement('div');
  infoSec.className = 'pd-info-section';

  var catChip = document.createElement('div');
  catChip.className = 'pd-category-chip';
  catChip.textContent = categoryLabel(p.category);
  infoSec.appendChild(catChip);

  var nameEl = document.createElement('div');
  nameEl.className = 'pd-name-big';
  nameEl.textContent = p.name || 'Produit';
  infoSec.appendChild(nameEl);

  /* Prix avec promo */
  if (p.is_promo && p.promo_pct) {
    var origPrice = Math.round(p.price_kmf / (1 - p.promo_pct / 100));
    var origEl = document.createElement('div');
    origEl.style.cssText = 'font-size:0.82rem;color:var(--muted);text-decoration:line-through;margin-bottom:2px;';
    origEl.textContent = fmt(origPrice, 'KMF');
    infoSec.appendChild(origEl);
  }

  var priceEl = document.createElement('div');
  priceEl.className = 'pd-price-big';
  if (_currency === 'EUR') {
    priceEl.innerHTML = fmt(p.price_kmf || 0, 'KMF') + ' <span style="font-size:0.72em;color:var(--muted);font-weight:500;">≈ ' + fmt(p.price_kmf || 0, 'EUR') + '</span>';
  } else {
    priceEl.textContent = fmt(p.price_kmf || 0, 'KMF');
  }
  infoSec.appendChild(priceEl);

  var avail = availabilityInfo(p);
  var availTag = document.createElement('div');
  availTag.className = 'avail-badge ' + avail.cls;
  availTag.style.cssText = 'margin-top:6px;display:inline-flex;';
  availTag.textContent = avail.icon + ' ' + avail.label;
  infoSec.appendChild(availTag);

  if (p.description) {
    var descEl = document.createElement('p');
    descEl.className = 'pd-desc-v3';
    descEl.textContent = p.description;
    infoSec.appendChild(descEl);
  }

  /* CTA "Voir toute la collection" */
  var collBtn = document.createElement('button');
  collBtn.className = 'pd-collection-btn';
  collBtn.innerHTML = categoryLabel(p.category) + ' &nbsp;→ voir la collection';
  collBtn.addEventListener('click', function() {
    var _pCatLow = (p.category || '').toLowerCase();
    closeProductModal();
    renderProducts(_products.filter(function(x) {
      var c = (x.category || '').toLowerCase();
      return c === _pCatLow || c.indexOf(_pCatLow) !== -1 || (_pCatLow.length > 3 && _pCatLow.indexOf(c) !== -1);
    }));
    var catEl2 = document.getElementById('catalogue');
    if (catEl2) setTimeout(function() { catEl2.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 120);
  });
  infoSec.appendChild(collBtn);

  body.appendChild(infoSec);

  /* ── Footer sticky : trust copy + qty + add btn ── */
  var trustEl = document.createElement('div');
  trustEl.className = 'modal-footer-trust';
  trustEl.innerHTML = '🇰🇲 <span>Livré aux Comores</span> · Paiement sécurisé 🔒';
  footer.appendChild(trustEl);

  var controls = document.createElement('div');
  controls.className = 'pd-controls-sticky';

  var qtyPill = document.createElement('div');
  qtyPill.className = 'qty-pill';
  var minusBtn = document.createElement('button');
  minusBtn.className = 'qty-btn';
  minusBtn.textContent = '−';
  var qtyVal = document.createElement('span');
  qtyVal.className = 'qty-val';
  qtyVal.textContent = '1';
  var plusBtn = document.createElement('button');
  plusBtn.className = 'qty-btn';
  plusBtn.textContent = '+';
  minusBtn.addEventListener('click', function() { if (_pdQty > 1) { _pdQty--; qtyVal.textContent = _pdQty; } });
  plusBtn.addEventListener('click', function() { _pdQty++; qtyVal.textContent = _pdQty; });
  qtyPill.appendChild(minusBtn);
  qtyPill.appendChild(qtyVal);
  qtyPill.appendChild(plusBtn);
  controls.appendChild(qtyPill);

  var addBtn = document.createElement('button');
  addBtn.className = 'pd-add-btn-full';
  addBtn.innerHTML = '🛒 Ajouter au panier';

  /* ── Déjà dans le panier? ── */
  var _inCart = _cart.find(function(ci) { return String(ci.product.id) === String(p.id); });
  if (_inCart) {
    addBtn.innerHTML = '✓ En ajouter · ×' + _inCart.qty + ' déjà';
    addBtn.style.background = 'var(--primary-dark)';
  }

  addBtn.addEventListener('click', function() {
    addToCart(p, _pdQty, addBtn);
    addBtn.innerHTML = '✓ Ajouté !';
    addBtn.classList.add('added');
    setTimeout(function() { closeProductModal(); }, 600);
  });
  controls.appendChild(addBtn);
  footer.appendChild(controls);

  /* ── Look Board / Suggestions — piloté par SUGGESTION_MAP ── */
  var _pCat = (p.category || '').toLowerCase();
  var _mapEntry = SUGGESTION_MAP[_pCat] || { similaires: true, complementaires: false, mannequin: false, compCategories: [] };
  // Overlay dismantled — mannequin désactivé

  /* ── Fonction swipe carousel natif pour la modale ── */
  function makeSwipeSection(items, label, borderColor) {
    var section = document.createElement('div');
    section.style.cssText = 'margin:20px 20px 8px;';

    var title = document.createElement('div');
    title.style.cssText = 'font-size:0.85rem;font-weight:700;color:var(--dark);margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid ' + borderColor + ';display:inline-block;';
    title.textContent = label;
    section.appendChild(title);

    var track = document.createElement('div');
    track.className = 'modal-swipe-track';

    items.forEach(function(sp) {
      var card = document.createElement('div');
      card.style.cssText = 'flex:0 0 155px;min-width:155px;background:white;border:1px solid var(--border);border-radius:10px;overflow:hidden;cursor:pointer;scroll-snap-align:start;transition:transform 0.15s;';
      card.addEventListener('click', function() { openProductModal(sp, true); });
      card.addEventListener('touchstart', function() { card.style.transform='scale(0.97)'; }, {passive:true});
      card.addEventListener('touchend', function() { card.style.transform=''; }, {passive:true});

      var mImg = document.createElement('div');
      mImg.style.cssText = 'height:100px;overflow:hidden;background:var(--primary-light);';
      if (sp.image_url) {
        var mi = document.createElement('img');
        mi.src = sp.image_url;
        mi.alt = sanitize(sp.name);
        mi.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        mImg.appendChild(mi);
      } else {
        mImg.style.cssText += 'display:flex;align-items:center;justify-content:center;font-size:2.5rem;';
        mImg.textContent = productEmoji(sp);
      }
      card.appendChild(mImg);

      var mBody = document.createElement('div');
      mBody.style.cssText = 'padding:7px 8px;';
      var mName = document.createElement('div');
      mName.style.cssText = 'font-size:0.73rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px;';
      mName.textContent = sp.name;
      mBody.appendChild(mName);
      var mPrice = document.createElement('div');
      mPrice.style.cssText = 'font-size:0.78rem;color:var(--primary);font-weight:700;margin-bottom:4px;';
      mPrice.textContent = fmt(sp.price_kmf || 0, 'KMF');
      mBody.appendChild(mPrice);
      var mAdd = document.createElement('button');
      mAdd.style.cssText = 'width:100%;padding:5px;background:' + (sp.is_promo ? 'var(--accent);color:#1e2a38' : 'var(--primary);color:white') + ';border:none;border-radius:6px;font-size:0.7rem;font-weight:700;cursor:pointer;';
      mAdd.textContent = '+ Panier';
      mAdd.addEventListener('click', function(e) {
        e.stopPropagation();
        addToCart(sp, 1, mAdd);
        toast(sp.name + ' ajouté', 'success');
      });
      mBody.appendChild(mAdd);
      card.appendChild(mBody);
      track.appendChild(card);
    });

    // Wrapper relatif pour positionner les flèches
    var wrap = document.createElement('div');
    wrap.className = 'swipe-wrap';

    // Flèches
    var arrowL = document.createElement('button');
    arrowL.className = 'swipe-arrow swipe-arrow-left hidden';
    arrowL.innerHTML = '&#8249;';
    arrowL.title = 'Précédent';

    var arrowR = document.createElement('button');
    arrowR.className = 'swipe-arrow swipe-arrow-right';
    arrowR.innerHTML = '&#8250;';
    arrowR.title = 'Suivant';

    function updateArrows() {
      arrowL.classList.toggle('hidden', track.scrollLeft <= 4);
      arrowR.classList.toggle('hidden', track.scrollLeft >= track.scrollWidth - track.clientWidth - 4);
    }

    arrowL.addEventListener('click', function(e) {
      e.stopPropagation();
      track.dataset.arrowPause = '1';
      track.scrollBy({ left: -280, behavior: 'smooth' });
      setTimeout(function() { delete track.dataset.arrowPause; }, 1500);
    });
    arrowR.addEventListener('click', function(e) {
      e.stopPropagation();
      track.dataset.arrowPause = '1';
      track.scrollBy({ left: 280, behavior: 'smooth' });
      setTimeout(function() { delete track.dataset.arrowPause; }, 1500);
    });
    track.addEventListener('scroll', updateArrows, { passive: true });

    // Masquer flèche droite si contenu ne déborde pas
    setTimeout(function() {
      if (track.scrollWidth <= track.clientWidth) {
        arrowR.classList.add('hidden');
      }
    }, 80);

    // Hint doigt swipe (mobile)
    var hint = document.createElement('div');
    hint.className = 'swipe-hint';
    hint.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg> Glisser pour voir plus';

    wrap.appendChild(arrowL);
    wrap.appendChild(track);
    wrap.appendChild(arrowR);
    section.appendChild(wrap);
    section.appendChild(hint);
    return section;
  }

  // ── Suggestions produits — piloté par SUGGESTION_MAP ────────
  // _pCat et _mapEntry déjà définis plus haut

  // Similaires : même catégorie, prix proche
  if (_mapEntry.similaires) {
    var _similar = _products
      .filter(function(x) { return x.id !== p.id && (x.category||'').toLowerCase() === _pCat; })
      .sort(function(a,b) { return Math.abs(a.price_kmf - p.price_kmf) - Math.abs(b.price_kmf - p.price_kmf); })
      .slice(0, 8);
    if (_similar.length) body.appendChild(makeSwipeSection(_similar, 'Dans la même collection', '#fef3c7'));
  }

  // Bundle "Complétez votre look"
  if (_mapEntry.complementaires && _mapEntry.compCategories.length) {
    var _bundlePool = _products
      .filter(function(x) {
        if (x.id === p.id) return false;
        var xCat = (x.category||'').toLowerCase();
        if (xCat === _pCat) return false;
        return _mapEntry.compCategories.some(function(c) { return xCat === c || xCat.indexOf(c) >= 0; });
      })
      .sort(function() { return 0.5 - Math.random(); })
      .slice(0, 3);

    if (_bundlePool.length >= 2) {
      var bundleSec = document.createElement('div');
      bundleSec.className = 'bundle-section';

      var bundleTitle = document.createElement('div');
      bundleTitle.className = 'bundle-title';
      bundleTitle.innerHTML = '✨ Complétez votre look';
      bundleSec.appendChild(bundleTitle);

      var bundleItems = document.createElement('div');
      bundleItems.className = 'bundle-items';

      var _bundleSelected = {};
      _bundlePool.forEach(function(bp) { _bundleSelected[bp.id] = true; });

      _bundlePool.forEach(function(bp) {
        var item = document.createElement('div');
        item.className = 'bundle-item selected';
        item.dataset.pid = bp.id;

        var check = document.createElement('div');
        check.className = 'bundle-item-check';
        check.innerHTML = '✓';

        var imgEl;
        if (bp.image_url) {
          imgEl = document.createElement('img');
          imgEl.className = 'bundle-item-img';
          imgEl.src = bp.image_url;
          imgEl.alt = bp.name;
          imgEl.onerror = function() { imgEl.style.display='none'; };
        } else {
          imgEl = document.createElement('div');
          imgEl.className = 'bundle-item-img';
          imgEl.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:1.5rem;';
          imgEl.textContent = productEmoji(bp);
        }

        var info = document.createElement('div');
        info.className = 'bundle-item-info';
        var bName = document.createElement('div');
        bName.className = 'bundle-item-name';
        bName.textContent = bp.name;
        var bPrice = document.createElement('div');
        bPrice.className = 'bundle-item-price';
        bPrice.textContent = fmt(bp.price_kmf || 0, 'KMF');
        info.appendChild(bName);
        info.appendChild(bPrice);

        item.appendChild(check);
        item.appendChild(imgEl);
        item.appendChild(info);
        bundleItems.appendChild(item);

        item.addEventListener('click', function() {
          var sel = item.classList.toggle('selected');
          _bundleSelected[bp.id] = sel;
          updateBundleCta();
        });
      });

      bundleSec.appendChild(bundleItems);

      var bundleCta = document.createElement('button');
      bundleCta.className = 'bundle-cta';
      var bundleTotalEl = document.createElement('div');
      bundleTotalEl.className = 'bundle-total';

      function updateBundleCta() {
        var sel = _bundlePool.filter(function(bp) { return _bundleSelected[bp.id]; });
        var total = sel.reduce(function(s, bp) { return s + (bp.price_kmf || 0); }, 0);
        bundleCta.innerHTML = '🛍️ Ajouter le look (' + sel.length + ' article' + (sel.length > 1 ? 's' : '') + ')';
        bundleTotalEl.textContent = sel.length ? 'Total : ' + fmt(total, 'KMF') : '';
        bundleCta.disabled = sel.length === 0;
      }
      updateBundleCta();

      bundleCta.addEventListener('click', function() {
        var added = 0;
        _bundlePool.forEach(function(bp) {
          if (_bundleSelected[bp.id]) { addToCart(bp, 1, null); added++; }
        });
        if (added) toast(added + ' article' + (added > 1 ? 's' : '') + ' ajouté' + (added > 1 ? 's' : '') + ' au panier 🛒', 'success');
        bundleCta.innerHTML = '✓ Look ajouté !';
        bundleCta.style.background = '#22c55e';
        bundleCta.style.color = 'white';
        setTimeout(function() { updateBundleCta(); bundleCta.style.background = ''; bundleCta.style.color = ''; }, 2500);
      });

      bundleSec.appendChild(bundleCta);
      bundleSec.appendChild(bundleTotalEl);
      body.appendChild(bundleSec);
    }
  }

  
  // (bouton retour intégré dans la barre ← en haut)

  // Auto-scroll désactivé — swipe manuel uniquement

  $('product-modal').classList.add('open');
  document.body.classList.add('modal-open');
  document.body.style.overflow = 'hidden';
}

// [removed _lookLabels — replaced by V2 picker]

  /* ══ Table de mappage suggestions par catégorie ══
   *  similaires       → "Dans le même esprit" (même catégorie, prix proche)
   *  complementaires  → "Ceci pourrait aller avec" (catégories compCategories)
   *  mannequin        → Look board interactif (Sur-mesure uniquement)
   *  compCategories   → catégories dans lesquelles piocher les complémentaires
   *  Pour ajouter une catégorie : une ligne suffit.
   */
  // SUGGESTION_MAP — complementaires uniquement entre catégories logiquement liées
  // Mode/Vetements désactivés (trop larges → absurdités type bonnet+fond de teint)
  var SUGGESTION_MAP = {
    'mode':           { similaires: true, complementaires: false, compCategories: [] },
    'vetements':      { similaires: true, complementaires: false, compCategories: [] },
    'fashion':        { similaires: true, complementaires: false, compCategories: [] },
    'chaussures':     { similaires: true, complementaires: true,  compCategories: ['chaussettes','sacs'] },
    'accessoires':    { similaires: true, complementaires: true,  compCategories: ['bijoux'] },
    'bijoux':         { similaires: true, complementaires: true,  compCategories: ['accessoires','sacs','parfum'] },
    'sacs':           { similaires: true, complementaires: true,  compCategories: ['bijoux','accessoires'] },
    'sur-mesure':     { similaires: true, complementaires: false, compCategories: [] },
    'beaute':         { similaires: true, complementaires: true,  compCategories: ['parfum','soins'] },
    'beauté':         { similaires: true, complementaires: true,  compCategories: ['parfum','soins'] },
    'parfum':         { similaires: true, complementaires: true,  compCategories: ['beaute','beauté','soins'] },
    'soins':          { similaires: true, complementaires: true,  compCategories: ['beaute','beauté','parfum'] },
    'tech':           { similaires: true, complementaires: true,  compCategories: ['accessoires-tel','coques','chargeurs','audio'] },
    'telephones':     { similaires: true, complementaires: true,  compCategories: ['accessoires-tel','coques','chargeurs','audio'] },
    'electronique':   { similaires: true, complementaires: true,  compCategories: ['accessoires-tel','audio'] },
    'accessoires-tel':{ similaires: true, complementaires: true,  compCategories: ['telephones','electronique','audio'] },
    'audio':          { similaires: true, complementaires: true,  compCategories: ['telephones','electronique','accessoires-tel'] },
    'enfant':         { similaires: true, complementaires: false, compCategories: [] },
    'jouets':         { similaires: true, complementaires: false, compCategories: [] },
    'maison':         { similaires: true, complementaires: true,  compCategories: ['deco'] },
    'deco':           { similaires: true, complementaires: true,  compCategories: ['maison'] },
    'alimentaire':    { similaires: true, complementaires: false, compCategories: [] },
    'epicerie':       { similaires: true, complementaires: false, compCategories: [] }
  };


// ════════════════════════════════════════════════════════════════
/* [OVERLAY CODE REMOVED — 559 lines] */

function closeProductModal() {
  $('product-modal').classList.remove('open');
  document.body.classList.remove('modal-open');
  document.body.style.overflow = '';
}

/* ──────────────────────────────────────
   CART
   ────────────────────────────────────── */
function cartQty() { return _cart.reduce(function(s, i) { return s + i.qty; }, 0); }
function cartTotal() { return _cart.reduce(function(s, i) { return s + (i.product.price_kmf || 0) * i.qty; }, 0); }

function refreshCartBadge() {
  var badge = $('cart-count');
  if (!badge) return;
  var count = cartQty();
  badge.textContent = count;
  if (count > 0) {
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

/* ── Update cart badges on product cards ── */
function updateCartBadges() {
  var badges = document.querySelectorAll('.card-cart-badge');
  badges.forEach(function(badge) {
    var pid = badge.getAttribute('data-badge-pid');
    /* Match loosely: number or string */
    var item = _cart.find(function(i) {
      return String(i.product.id) === String(pid);
    });
    var qtyEl = badge.querySelector('.badge-qty');
    if (item && item.qty > 0) {
      qtyEl.textContent = item.qty;
      if (!badge.classList.contains('visible')) {
        badge.classList.add('visible');
        badge.classList.remove('pop');
        void badge.offsetWidth;
        badge.classList.add('pop');
      } else {
        /* Qty changed → pulse again */
        badge.classList.remove('pop');
        void badge.offsetWidth;
        badge.classList.add('pop');
      }
    } else {
      badge.classList.remove('visible', 'pop');
    }
  });
}

function saveCart() {
  try {
    localStorage.setItem('kmrc_cart', JSON.stringify(_cart));
    localStorage.setItem('kmrc_cart_v', String(CART_VERSION));
  } catch (e) {
    console.warn('saveCart: localStorage indisponible', e);
  }
  refreshCartBadge();
  updateCartBadges();
}

function addToCart(product, qty, btn) {
  qty = qty || 1;
  var existing = _cart.find(function(i) { return String(i.product.id) === String(product.id); });
  if (existing) {
    existing.qty += qty;
  } else {
    _cart.push({ product: product, qty: qty });
  }

  /* Animation fly-to-cart */
  if (typeof flyToCart === 'function') {
    var addBtns = document.querySelectorAll('[data-product-id="' + product.id + '"]');
    if (addBtns.length) flyToCart(addBtns[0], product);
  }

  saveCart();

  /* Feedback bouton */
  if (btn) {
    var orig = btn.textContent;
    btnAddedFeedback(btn, orig);
  }

  /* Drawer Amazon-Komores */
  openCartWithHighlight(product.id);
}

function removeFromCart(productId) {
  var pid = String(productId);
  _cart = _cart.filter(function(i) { return String(i.product.id) !== pid; });
  saveCart();
  renderCartBody();
}

function setQty(productId, newQty) {
  var pid = String(productId);
  if (newQty < 1) {
    removeFromCart(pid);
    return;
  }
  var item = _cart.find(function(i) { return String(i.product.id) === pid; });
  if (item) {
    item.qty = newQty;
    saveCart();
    renderCartBody();
  } else {
    console.warn('setQty: product not found, id=', pid);
  }
}

function openCartWithHighlight(productId) {
  renderCartBody(productId);
  var header = document.querySelector('.cart-header');
  var titleEl = $('cart-header-title');
  if (header && titleEl) {
    header.classList.add('celebrating');
    titleEl.textContent = '🎊 C\'est dans le panier !';
    setTimeout(function() {
      header.classList.remove('celebrating');
      titleEl.textContent = 'Mon Panier (' + cartQty() + ')';
    }, 2400);
  }
  $('cart-overlay').classList.add('open');
  $('cart-drawer').classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(function() {
    var newItem = document.querySelector('.cart-item.new-item');
    if (newItem) newItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 120);
}

function closeCart() {
  $('cart-overlay').classList.remove('open');
  $('cart-drawer').classList.remove('open');
  document.body.style.overflow = '';
}

function openCart() {
  renderCartBody();
  $('cart-header-title').textContent = 'Mon Panier (' + cartQty() + ')';
  $('cart-overlay').classList.add('open');
  $('cart-drawer').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function renderCartBody(highlightId) {
  var body = $('cart-body');
  var footer = $('cart-footer');
  body.innerHTML = '';

  if (_cart.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'cart-empty';
    var icon = document.createElement('div');
    icon.className = 'empty-icon';
    icon.textContent = '🧺';
    empty.appendChild(icon);
    var msg = document.createElement('p');
    msg.textContent = 'Votre panier est vide';
    empty.appendChild(msg);
    body.appendChild(empty);
    footer.style.display = 'none';
    return;
  }

  /* Bouton "Continuer mes achats" façon Amazon */
  var continueBtn = document.createElement('button');
  continueBtn.className = 'cart-continue-shop';
  continueBtn.innerHTML = '← Continuer mes achats';
  continueBtn.addEventListener('click', closeCart);
  body.appendChild(continueBtn);

  _cart.forEach(function(item) {
    var row = document.createElement('div');
    row.className = 'cart-item';
    row.dataset.pid = String(item.product.id);
    if (highlightId && item.product.id === highlightId) row.classList.add('new-item');

    var emojiBox = document.createElement('div');
    emojiBox.className = 'cart-item-emoji';
    if (item.product.image_url) {
      var img = document.createElement('img');
      img.src = item.product.image_url;
      img.alt = item.product.name || '';
      emojiBox.appendChild(img);
    } else {
      emojiBox.textContent = productEmoji(item.product);
    }
    row.appendChild(emojiBox);

    var info = document.createElement('div');
    info.className = 'cart-item-info';

    var name = document.createElement('div');
    name.className = 'cart-item-name';
    name.textContent = item.product.name || 'Produit';
    name.title = item.product.name || '';
    info.appendChild(name);

    var unitPrice = document.createElement('div');
    unitPrice.className = 'cart-item-unit-price';
    var unitKmf = item.product.price_kmf || 0;
    unitPrice.textContent = item.qty > 1 ? fmt(unitKmf, 'KMF') + ' × ' + item.qty : '';
    info.appendChild(unitPrice);

    var price = document.createElement('div');
    price.className = 'cart-item-price';
    price.textContent = fmt(unitKmf * item.qty, 'KMF');
    info.appendChild(price);

    var qtyRow = document.createElement('div');
    qtyRow.className = 'cart-item-qty';
    var pid = item.product.id;

    var minusBtn = document.createElement('button');
    minusBtn.className = 'qty-btn';
    minusBtn.textContent = '−';
    (function(id, q) {
      minusBtn.addEventListener('click', function() { setQty(id, q - 1); });
    })(pid, item.qty);
    qtyRow.appendChild(minusBtn);

    var qtyVal = document.createElement('span');
    qtyVal.className = 'qty-val';
    qtyVal.textContent = item.qty;
    qtyRow.appendChild(qtyVal);

    var plusBtn = document.createElement('button');
    plusBtn.className = 'qty-btn';
    plusBtn.textContent = '+';
    (function(id, q) {
      plusBtn.addEventListener('click', function() { setQty(id, q + 1); });
    })(pid, item.qty);
    qtyRow.appendChild(plusBtn);

    info.appendChild(qtyRow);
    row.appendChild(info);

    var removeBtn = document.createElement('button');
    removeBtn.className = 'cart-item-remove';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Retirer';
    (function(id) {
      removeBtn.addEventListener('click', function() { removeFromCart(id); });
    })(pid);
    row.appendChild(removeBtn);

    body.appendChild(row);
  });

  footer.style.display = 'block';
  $('cart-total-val').textContent = fmt(cartTotal(), 'KMF');
  var convEl = $('cart-total-conv');
  if (_currency === 'EUR') {
    convEl.textContent = '≈ ' + fmt(cartTotal(), 'EUR');
  } else {
    convEl.textContent = '';
  }
}

/* ──────────────────────────────────────
   RELAIS
   ────────────────────────────────────── */
async function loadRelais() {
  try {
    var data = await apiGet('/api/relais/public');
    _relais = data.relais || data || [];
  } catch (e) {
    console.error('loadRelais:', e);
    _relais = [];
  }
}

/* ──────────────────────────────────────
   SHARE CART VIA WHATSAPP
   ────────────────────────────────────── */
function shareCartWhatsApp() {
  if (_cart.length === 0) { toast('Votre panier est vide.', 'error'); return; }

  var lines = [];
  lines.push('🧺 *Mon panier Komerce*');
  lines.push('━━━━━━━━━━━━━━━━');
  lines.push('');

  _cart.forEach(function(item, idx) {
    var name = item.product.name || 'Produit';
    var priceKMF = (item.product.price_kmf || 0) * item.qty;
    var line = (idx + 1) + '. ' + name;
    if (item.qty > 1) line += ' x' + item.qty;
    line += ' — ' + fmt(priceKMF, 'KMF');
    lines.push(line);
  });

  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━');
  lines.push('💰 *Total : ' + fmt(cartTotal(), 'KMF') + '* (≈ ' + fmt(cartTotal(), 'EUR') + ')');
  lines.push('📦 Livraison incluse · 3-5 semaines');
  lines.push('');
  lines.push('👉 Commande sur : ' + window.location.origin + window.location.pathname);

  var msg = lines.join('\n');
  var url = 'https://wa.me/?text=' + encodeURIComponent(msg);
  window.open(url, '_blank');
}

/* ──────────────────────────────────────
   ORDER FORM — SINGLE PAGE CHECKOUT v5
   ────────────────────────────────────── */
var _orderData = { is_self_pickup: true };

function checkoutCart() {
  if (_cart.length === 0) { toast('Votre panier est vide.', 'error'); return; }
  closeCart();
  _orderData = { is_self_pickup: true, payment_mode: 'cash_relais' };
  renderCheckout();
  $('order-modal').classList.add('open');
  document.body.classList.add('modal-open');
  document.body.style.overflow = 'hidden';
}

function closeOrderModal() {
  $('order-modal').classList.remove('open');
  document.body.classList.remove('modal-open');
  document.body.style.overflow = '';
}

function renderCheckout() {
  var body = $('order-modal-body');
  body.innerHTML = '';
  $('order-modal-title').textContent = '\u{1F6D2} Finaliser ma commande';

  /* ── Cart Summary ── */
  var summary = document.createElement('div');
  summary.style.cssText = 'background:#f8fafc;border-radius:10px;padding:10px 14px;margin-bottom:14px;border:1px solid var(--border);';

  var countLine = document.createElement('div');
  countLine.style.cssText = 'font-size:0.82rem;color:var(--muted);';
  countLine.textContent = cartQty() + ' article' + (cartQty() > 1 ? 's' : '');
  summary.appendChild(countLine);

  var priceLine = document.createElement('div');
  priceLine.style.cssText = 'display:flex;align-items:baseline;gap:8px;margin-top:2px;';
  var bigPrice = document.createElement('span');
  bigPrice.style.cssText = 'font-family:Poppins,sans-serif;font-weight:800;font-size:1.25rem;color:var(--text);';
  bigPrice.textContent = fmt(cartTotal(), 'KMF');
  priceLine.appendChild(bigPrice);
  var eurEquiv = document.createElement('span');
  eurEquiv.style.cssText = 'font-size:0.88rem;color:var(--muted);';
  eurEquiv.textContent = '\u2248 ' + fmt(cartTotal(), 'EUR');
  priceLine.appendChild(eurEquiv);
  summary.appendChild(priceLine);
  body.appendChild(summary);

  /* ── Toggle: C'est moi qui récupère ── */
  var toggleWrap = document.createElement('div');
  toggleWrap.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;background:' + (_orderData.is_self_pickup ? 'var(--primary-light)' : '#f8fafc') + ';border-radius:var(--radius);margin-bottom:14px;cursor:pointer;border:2px solid ' + (_orderData.is_self_pickup ? 'var(--primary)' : 'var(--border)') + ';transition:all 0.2s;user-select:none;';

  var toggleTrack = document.createElement('div');
  toggleTrack.style.cssText = 'width:40px;height:22px;border-radius:11px;background:' + (_orderData.is_self_pickup ? 'var(--primary)' : 'var(--border)') + ';position:relative;transition:background 0.3s;flex-shrink:0;';
  var toggleThumb = document.createElement('div');
  toggleThumb.style.cssText = 'width:18px;height:18px;border-radius:50%;background:white;position:absolute;top:2px;left:' + (_orderData.is_self_pickup ? '20px' : '2px') + ';transition:left 0.3s;box-shadow:0 1px 3px rgba(0,0,0,0.2);';
  toggleTrack.appendChild(toggleThumb);
  toggleWrap.appendChild(toggleTrack);

  var toggleLabel = document.createElement('span');
  toggleLabel.style.cssText = 'font-size:0.88rem;color:var(--text);font-weight:600;';
  toggleLabel.textContent = '\u{1F3EA} C\u2019est moi qui r\u00e9cup\u00e8re au relais';
  toggleWrap.appendChild(toggleLabel);

  toggleWrap.addEventListener('click', function() {
    _orderData.is_self_pickup = !_orderData.is_self_pickup;
    renderCheckout();
  });
  body.appendChild(toggleWrap);

  if (_orderData.is_self_pickup) {
    /* ── MODE: Je récupère moi-même → 1 seul formulaire ── */
    var secTitle = document.createElement('div');
    secTitle.style.cssText = 'font-weight:700;font-size:0.92rem;margin-bottom:10px;color:var(--text);';
    secTitle.textContent = '\u{1F464} Vos coordonn\u00e9es';
    body.appendChild(secTitle);

    /* Nom */
    var nameGroup = document.createElement('div');
    nameGroup.className = 'of-group';
    var nameLabel = document.createElement('label');
    nameLabel.textContent = 'Nom complet *';
    nameGroup.appendChild(nameLabel);
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.id = 'of-my-name';
    nameInput.placeholder = 'Votre nom';
    nameInput.value = _orderData.my_name || '';
    nameInput.addEventListener('input', function() { _orderData.my_name = this.value; });
    nameGroup.appendChild(nameInput);
    body.appendChild(nameGroup);

    /* Tél +269 */
    var phoneGroup = document.createElement('div');
    phoneGroup.className = 'of-group';
    var phoneLabel = document.createElement('label');
    phoneLabel.textContent = 'T\u00e9l\u00e9phone (+269) *';
    phoneGroup.appendChild(phoneLabel);
    var phoneWrap = document.createElement('div');
    phoneWrap.style.cssText = 'display:flex;gap:0;';
    var phonePrefix = document.createElement('div');
    phonePrefix.style.cssText = 'background:var(--bg);border:2px solid var(--border);border-right:none;border-radius:var(--radius) 0 0 var(--radius);padding:9px 10px;font-weight:700;color:var(--muted);white-space:nowrap;display:flex;align-items:center;font-size:0.88rem;';
    phonePrefix.textContent = '+269';
    phoneWrap.appendChild(phonePrefix);
    var phoneInput = document.createElement('input');
    phoneInput.type = 'tel';
    phoneInput.id = 'of-my-phone';
    phoneInput.placeholder = '321 12 34';
    phoneInput.value = _orderData.my_phone || '';
    phoneInput.style.cssText = 'flex:1;border-radius:0 var(--radius) var(--radius) 0;padding:9px 12px;border:2px solid var(--border);outline:none;font-size:inherit;transition:border-color 0.2s;';
    phoneInput.maxLength = 10;
    phoneInput.pattern = '[0-9 ]{7,10}';
    phoneInput.addEventListener('focus', function() { this.style.borderColor = 'var(--primary)'; });
    phoneInput.addEventListener('blur', function() { this.style.borderColor = 'var(--border)'; });
    phoneInput.addEventListener('input', function() {
      var raw = this.value.replace(/[^0-9]/g, '');
      if (raw.length > 7) raw = raw.substring(0, 7);
      if (raw.length >= 4) raw = raw.substring(0,3) + ' ' + raw.substring(3);
      if (raw.length >= 7) raw = raw.substring(0,6) + ' ' + raw.substring(6);
      this.value = raw;
      _orderData.my_phone = raw;
    });
    phoneWrap.appendChild(phoneInput);
    phoneGroup.appendChild(phoneWrap);
    body.appendChild(phoneGroup);

    /* Email optionnel */
    var emailGroup = document.createElement('div');
    emailGroup.className = 'of-group';
    var emailLabel = document.createElement('label');
    emailLabel.textContent = 'Email (pour le suivi)';
    emailGroup.appendChild(emailLabel);
    var emailInput = document.createElement('input');
    emailInput.type = 'email';
    emailInput.id = 'of-my-email';
    emailInput.placeholder = 'votre@email.com';
    emailInput.value = _orderData.my_email || '';
    emailInput.addEventListener('input', function() { _orderData.my_email = this.value; });
    emailGroup.appendChild(emailInput);
    body.appendChild(emailGroup);

  } else {
    /* ── MODE: Quelqu'un d'autre récupère → 2 sections ── */

    /* Section 1: Récupérateur */
    var pickTitle = document.createElement('div');
    pickTitle.style.cssText = 'font-weight:700;font-size:0.92rem;margin-bottom:10px;color:var(--text);';
    pickTitle.textContent = '\u{1F4CD} Personne qui r\u00e9cup\u00e8re au relais';
    body.appendChild(pickTitle);

    var pnGroup = document.createElement('div');
    pnGroup.className = 'of-group';
    var pnLabel = document.createElement('label');
    pnLabel.textContent = 'Nom complet *';
    pnGroup.appendChild(pnLabel);
    var pnInput = document.createElement('input');
    pnInput.type = 'text';
    pnInput.id = 'of-pickup-name';
    pnInput.placeholder = 'Nom de la personne locale';
    pnInput.value = _orderData.pickup_name || '';
    pnInput.addEventListener('input', function() { _orderData.pickup_name = this.value; });
    pnGroup.appendChild(pnInput);
    body.appendChild(pnGroup);

    var ppGroup = document.createElement('div');
    ppGroup.className = 'of-group';
    var ppLabel = document.createElement('label');
    ppLabel.textContent = 'T\u00e9l\u00e9phone (+269) *';
    ppGroup.appendChild(ppLabel);
    var ppWrap = document.createElement('div');
    ppWrap.style.cssText = 'display:flex;gap:0;';
    var ppPrefix = document.createElement('div');
    ppPrefix.style.cssText = 'background:var(--bg);border:2px solid var(--border);border-right:none;border-radius:var(--radius) 0 0 var(--radius);padding:9px 10px;font-weight:700;color:var(--muted);white-space:nowrap;display:flex;align-items:center;font-size:0.88rem;';
    ppPrefix.textContent = '+269';
    ppWrap.appendChild(ppPrefix);
    var ppInput = document.createElement('input');
    ppInput.type = 'tel';
    ppInput.id = 'of-pickup-phone';
    ppInput.placeholder = '321 12 34';
    ppInput.value = _orderData.pickup_phone || '';
    ppInput.style.cssText = 'flex:1;border-radius:0 var(--radius) var(--radius) 0;padding:9px 12px;border:2px solid var(--border);outline:none;font-size:inherit;transition:border-color 0.2s;';
    ppInput.addEventListener('focus', function() { this.style.borderColor = 'var(--primary)'; });
    ppInput.addEventListener('blur', function() { this.style.borderColor = 'var(--border)'; });
    ppInput.maxLength = 10;
    ppInput.pattern = '[0-9 ]{7,10}';
    ppInput.addEventListener('input', function() {
      var raw = this.value.replace(/[^0-9]/g, '');
      if (raw.length > 7) raw = raw.substring(0, 7);
      if (raw.length >= 4) raw = raw.substring(0,3) + ' ' + raw.substring(3);
      if (raw.length >= 7) raw = raw.substring(0,6) + ' ' + raw.substring(6);
      this.value = raw;
      _orderData.pickup_phone = raw;
    });
    ppWrap.appendChild(ppInput);
    ppGroup.appendChild(ppWrap);
    body.appendChild(ppGroup);

    /* Section 2: Vos coordonnées (payeur) */
    var payerTitle = document.createElement('div');
    payerTitle.style.cssText = 'font-weight:700;font-size:0.92rem;margin:14px 0 10px;color:var(--text);';
    payerTitle.textContent = '\u{1F464} Vos coordonn\u00e9es';
    body.appendChild(payerTitle);

    var payerHint = document.createElement('div');
    payerHint.style.cssText = 'font-size:0.78rem;color:var(--muted);margin:-6px 0 10px;';
    payerHint.textContent = 'Pour recevoir le suivi de votre commande';
    body.appendChild(payerHint);

    var cnGroup = document.createElement('div');
    cnGroup.className = 'of-group';
    var cnLabel = document.createElement('label');
    cnLabel.textContent = 'Votre nom';
    cnGroup.appendChild(cnLabel);
    var cnInput = document.createElement('input');
    cnInput.type = 'text';
    cnInput.id = 'of-client-name';
    cnInput.placeholder = 'Votre nom';
    cnInput.value = _orderData.client_name || '';
    cnInput.addEventListener('input', function() { _orderData.client_name = this.value; });
    cnGroup.appendChild(cnInput);
    body.appendChild(cnGroup);

    var rowClient = document.createElement('div');
    rowClient.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;';

    var cpGroup = document.createElement('div');
    cpGroup.className = 'of-group';
    var cpLabel = document.createElement('label');
    cpLabel.textContent = 'T\u00e9l\u00e9phone';
    cpGroup.appendChild(cpLabel);
    var cpInput = document.createElement('input');
    cpInput.type = 'tel';
    cpInput.id = 'of-client-phone';
    cpInput.placeholder = '+33 6 ...';
    cpInput.value = _orderData.client_phone || '';
    cpInput.addEventListener('input', function() { _orderData.client_phone = this.value; });
    cpGroup.appendChild(cpInput);
    rowClient.appendChild(cpGroup);

    var ceGroup = document.createElement('div');
    ceGroup.className = 'of-group';
    var ceLabel = document.createElement('label');
    ceLabel.textContent = 'Email';
    ceGroup.appendChild(ceLabel);
    var ceInput = document.createElement('input');
    ceInput.type = 'email';
    ceInput.id = 'of-client-email';
    ceInput.placeholder = 'votre@email.com';
    ceInput.value = _orderData.client_email || '';
    ceInput.addEventListener('input', function() { _orderData.client_email = this.value; });
    ceGroup.appendChild(ceInput);
    rowClient.appendChild(ceGroup);

    body.appendChild(rowClient);
  }

  /* ── Mode de paiement ── */
  var payTitle = document.createElement('div');
  payTitle.style.cssText = 'font-weight:700;font-size:0.92rem;margin:6px 0 8px;color:var(--text);';
  payTitle.textContent = '\u{1F4B3} Paiement';
  body.appendChild(payTitle);

  var cashOpt = document.createElement('label');
  cashOpt.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;border:2px solid var(--primary);border-radius:var(--radius);margin-bottom:6px;cursor:pointer;background:var(--primary-light);';
  var cashRadio = document.createElement('input');
  cashRadio.type = 'radio';
  cashRadio.name = 'payment_mode';
  cashRadio.value = 'cash_relais';
  cashRadio.checked = true;
  cashRadio.style.cssText = 'width:16px;height:16px;accent-color:var(--primary);flex-shrink:0;';
  cashOpt.appendChild(cashRadio);
  var cashInfo = document.createElement('div');
  var cashL = document.createElement('div');
  cashL.style.cssText = 'font-weight:700;font-size:0.88rem;';
  cashL.textContent = '\u{1F3EA} Cash au point relais';
  cashInfo.appendChild(cashL);
  var cashS = document.createElement('div');
  cashS.style.cssText = 'font-size:0.75rem;color:var(--muted);margin-top:1px;';
  cashS.textContent = 'Payez en KMF au retrait';
  cashInfo.appendChild(cashS);
  cashOpt.appendChild(cashInfo);
  body.appendChild(cashOpt);

  /* MVola option — Bientôt */
  var mvolaOpt = document.createElement('label');
  mvolaOpt.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;border:2px solid var(--border);border-radius:var(--radius);margin-bottom:6px;cursor:not-allowed;background:white;opacity:0.6;';
  var mvolaRadio = document.createElement('input');
  mvolaRadio.type = 'radio';
  mvolaRadio.name = 'payment_mode';
  mvolaRadio.value = 'mvola';
  mvolaRadio.disabled = true;
  mvolaRadio.style.cssText = 'width:16px;height:16px;flex-shrink:0;';
  mvolaOpt.appendChild(mvolaRadio);
  var mvolaInfo = document.createElement('div');
  var mvolaL = document.createElement('div');
  mvolaL.style.cssText = 'font-weight:700;font-size:0.88rem;display:flex;align-items:center;gap:6px;';
  mvolaL.innerHTML = '<img src="https://www.mvola.km/wp-content/uploads/2023/12/logo.svg" alt="MVola Comores" style="height:22px;"> MVola <span style="font-size:0.65rem;background:#00a651;color:white;padding:1px 6px;border-radius:8px;font-weight:700;">Bient\u00f4t</span>';
  mvolaInfo.appendChild(mvolaL);
  var mvolaSub = document.createElement('div');
  mvolaSub.style.cssText = 'font-size:0.75rem;color:var(--text-light);margin-top:1px;';
  mvolaSub.textContent = 'Paiement mobile money';
  mvolaInfo.appendChild(mvolaSub);
  mvolaOpt.appendChild(mvolaInfo);
  body.appendChild(mvolaOpt);

  var stripeOpt = document.createElement('label');
  stripeOpt.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;border:2px solid var(--border);border-radius:var(--radius);margin-bottom:14px;cursor:not-allowed;background:white;opacity:0.6;';
  var stripeRadio = document.createElement('input');
  stripeRadio.type = 'radio';
  stripeRadio.name = 'payment_mode';
  stripeRadio.value = 'stripe_eur';
  stripeRadio.disabled = true;
  stripeRadio.style.cssText = 'width:16px;height:16px;flex-shrink:0;';
  stripeOpt.appendChild(stripeRadio);
  var stripeInfo = document.createElement('div');
  var stripeL = document.createElement('div');
  stripeL.style.cssText = 'font-weight:700;font-size:0.88rem;display:flex;align-items:center;gap:6px;';
  stripeL.innerHTML = '\u{1F4B3} Carte bancaire <span style="font-size:0.65rem;background:var(--accent);color:white;padding:1px 6px;border-radius:8px;font-weight:700;">Bient\u00f4t</span>';
  stripeInfo.appendChild(stripeL);
  stripeOpt.appendChild(stripeInfo);
  body.appendChild(stripeOpt);
  /* Check wallet balance on modal open */
  checkWalletBalance();


  /* ── Wallet / Crédit boutique ── */
  var walletSection = document.createElement('div');
  walletSection.id = 'wallet-section';
  walletSection.style.cssText = 'margin-top:12px;padding:12px 14px;border:2px dashed var(--primary);border-radius:var(--radius);background:linear-gradient(135deg,#fffbf0,#fef3e2);display:none;';
  var walletToggle = document.createElement('label');
  walletToggle.style.cssText = 'display:flex;align-items:center;gap:10px;cursor:pointer;';
  var walletCb = document.createElement('input');
  walletCb.type = 'checkbox';
  walletCb.id = 'cb-use-wallet';
  walletCb.style.cssText = 'width:18px;height:18px;accent-color:var(--primary);flex-shrink:0;';
  walletCb.addEventListener('change', function() {
    _orderData.use_wallet = this.checked;
    updateWalletDisplay();
  });
  walletToggle.appendChild(walletCb);
  var walletInfo = document.createElement('div');
  walletInfo.style.cssText = 'flex:1;';
  var walletTitle = document.createElement('div');
  walletTitle.style.cssText = 'font-weight:700;font-size:0.88rem;color:var(--primary-dark);';
  walletTitle.textContent = '\u{1F4B0} Utiliser mon cr\u00e9dit boutique';
  walletInfo.appendChild(walletTitle);
  var walletBal = document.createElement('div');
  walletBal.id = 'wallet-balance-text';
  walletBal.style.cssText = 'font-size:0.75rem;color:var(--muted);margin-top:2px;';
  walletBal.textContent = 'Chargement du solde\u2026';
  walletInfo.appendChild(walletBal);
  walletToggle.appendChild(walletInfo);
  walletSection.appendChild(walletToggle);

  var walletDeduction = document.createElement('div');
  walletDeduction.id = 'wallet-deduction';
  walletDeduction.style.cssText = 'margin-top:8px;padding:8px 10px;background:white;border-radius:8px;font-size:0.82rem;display:none;';
  walletSection.appendChild(walletDeduction);
  body.appendChild(walletSection);


  /* ── Confirm Button ── */
  var confirmBtn = document.createElement('button');
  confirmBtn.id = 'btn-confirm-order';
  confirmBtn.style.cssText = 'width:100%;padding:13px;border-radius:var(--radius);background:linear-gradient(135deg,#d97706,#f59e0b);color:white;font-weight:800;font-size:1rem;border:none;cursor:pointer;transition:filter 0.2s,transform 0.15s;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 4px 14px rgba(217,119,6,0.3);';
  confirmBtn.textContent = '\u2705 Confirmer \u2014 ' + fmt(cartTotal(), 'KMF');
  confirmBtn.addEventListener('click', function() { submitOrder(confirmBtn); });
  confirmBtn.addEventListener('mouseenter', function() { this.style.filter = 'brightness(1.08)'; this.style.transform = 'translateY(-1px)'; });
  confirmBtn.addEventListener('mouseleave', function() { this.style.filter = ''; this.style.transform = ''; });
  body.appendChild(confirmBtn);

  var hint = document.createElement('div');
  hint.style.cssText = 'text-align:center;font-size:0.75rem;color:var(--muted);margin-top:8px;';
  hint.textContent = 'Code + QR envoy\u00e9s par SMS pour le retrait';
  body.appendChild(hint);
}


/* ── Wallet helpers ── */
var _walletBalance = 0;

async function checkWalletBalance() {
  try {
    var res = await fetch('https://komerce-backend-production.up.railway.app/api/wallet', { credentials: 'same-origin' });
    if (res.ok) {
      var data = await res.json();
      _walletBalance = data.balance_kmf || 0;
      var section = document.getElementById('wallet-section');
      if (section && _walletBalance > 0) {
        section.style.display = 'block';
        var balText = document.getElementById('wallet-balance-text');
        if (balText) balText.textContent = 'Solde disponible : ' + fmt(_walletBalance, 'KMF');
      }
    }
  } catch(e) { console.log('wallet check:', e); }
}

function updateWalletDisplay() {
  var ded = document.getElementById('wallet-deduction');
  if (!ded) return;
  var cb = document.getElementById('cb-use-wallet');
  if (cb && cb.checked && _walletBalance > 0) {
    var total = cartTotal();
    var applied = Math.min(_walletBalance, total);
    var remaining = total - applied;
    ded.style.display = 'block';
    ded.innerHTML = '<div style="display:flex;justify-content:space-between;"><span>\u{1F4B0} Cr\u00e9dit appliqu\u00e9</span><span style=\"font-weight:700;color:var(--primary)\">-' + fmt(applied, 'KMF') + '</span></div>'
      + (remaining > 0 ? '<div style="display:flex;justify-content:space-between;margin-top:4px;"><span>Reste \u00e0 payer</span><span style=\"font-weight:700\">' + fmt(remaining, 'KMF') + '</span></div>' : '<div style="margin-top:4px;text-align:center;font-weight:700;color:#16a34a;">\u2705 Enti\u00e8rement couvert par votre cr\u00e9dit !</div>');
  } else {
    ded.style.display = 'none';
  }
}

async function submitOrder(btn) {
  var recipName, recipPhone, clientName, clientPhone, clientEmail;

  if (_orderData.is_self_pickup) {
    recipName = (document.getElementById('of-my-name').value || '').trim();
    recipPhone = (document.getElementById('of-my-phone').value || '').trim();
    clientName = recipName;
    clientPhone = '+269' + recipPhone.replace(/\s/g, '');
    var emailEl = document.getElementById('of-my-email');
    clientEmail = emailEl ? emailEl.value.trim() : '';
  } else {
    recipName = (document.getElementById('of-pickup-name').value || '').trim();
    recipPhone = (document.getElementById('of-pickup-phone').value || '').trim();
    clientName = (document.getElementById('of-client-name').value || '').trim() || recipName;
    clientPhone = (document.getElementById('of-client-phone').value || '').trim() || ('+269' + recipPhone.replace(/\s/g, ''));
    clientEmail = (document.getElementById('of-client-email').value || '').trim();
  }

  if (!recipName) { toast('Indiquez le nom de la personne qui r\u00e9cup\u00e8re.', 'error'); return; }
  if (!recipPhone) { toast('Indiquez le t\u00e9l\u00e9phone du r\u00e9cup\u00e9rateur.', 'error'); return; }

  var fullRecipPhone = '+269' + recipPhone.replace(/\s/g, '');

  btn.disabled = true;
  btn.textContent = '\u23f3 Envoi en cours\u2026';
  btn.style.opacity = '0.7';

  try {
    /* Step 1 : guest-checkout — cr\u00e9e ou retrouve le client par t\u00e9l\u00e9phone */
    await apiPost('/api/auth/guest-checkout', {
      full_name: clientName,
      phone: clientPhone,
      email: clientEmail || undefined
    });

    /* Step 2 : cr\u00e9er la commande */
    var items = _cart.map(function(i) {
      return { product_id: String(i.product.id), quantity: i.qty, confection_type: 'aucun' };
    });

    var relaisId = _relais.length > 0 ? _relais[0].id : undefined;

    var apiResult = await apiPost('/api/orders', {
      items: items,
      relais_id: relaisId,
      recipient_name: recipName,
      recipient_phone: fullRecipPhone,
      payment_mode: _orderData.payment_mode,
      use_wallet: _orderData.use_wallet || false
    });

    /* API retourne { order: {...}, discount_pct, discount_kmf, loyalty_label } */
    var orderData = apiResult.order || apiResult;

    /* Step 3 : vider le panier */
    _cart = [];
    saveCart();
    renderCartBody();

    /* Step 4 : \u00e9cran de succ\u00e8s */
    renderOrderSuccess(orderData, recipName, clientEmail, apiResult);
    toast('Commande confirm\u00e9e !', 'success');

  } catch (e) {
    console.error('submitOrder:', e);
    toast(e.message || 'Erreur lors de la commande.', 'error');
    btn.disabled = false;
    btn.textContent = '\u2705 Confirmer \u2014 ' + fmt(cartTotal(), 'KMF');
    btn.style.opacity = '1';
  }
}


function renderOrderSuccess(order, recipientName, clientEmail, fullResult) {
  var body = $('order-modal-body');
  body.innerHTML = '';
  $('order-modal-title').textContent = '\u2705 Commande confirm\u00e9e';

  var wrap = document.createElement('div');
  wrap.style.cssText = 'text-align:center;padding:14px 0;';

  /* Icon */
  var icon = document.createElement('div');
  icon.style.cssText = 'font-size:3.2rem;margin-bottom:8px;';
  icon.textContent = '\u{1F389}';
  wrap.appendChild(icon);

  /* Title */
  var h3 = document.createElement('h3');
  h3.style.cssText = 'font-family:Poppins,sans-serif;color:var(--primary);margin-bottom:6px;font-size:1.1rem;';
  h3.textContent = 'Commande enregistr\u00e9e !';
  wrap.appendChild(h3);

  /* Reference */
  var refLabel = document.createElement('p');
  refLabel.style.cssText = 'color:var(--muted);font-size:0.85rem;margin-bottom:2px;';
  refLabel.textContent = 'Votre r\u00e9f\u00e9rence :';
  wrap.appendChild(refLabel);

  var refBox = document.createElement('div');
  refBox.style.cssText = 'display:inline-block;background:var(--primary-light);color:var(--primary-dark);font-weight:800;font-size:1.15rem;padding:8px 20px;border-radius:10px;margin:6px 0;letter-spacing:2px;font-family:monospace;';
  refBox.textContent = order.reference || '\u2014';
  wrap.appendChild(refBox);

  /* Cash ref code — affich\u00e9 uniquement pour paiement cash */
  if (order.cash_ref_code && order.payment_mode === 'cash_relais') {
    var cashLabel = document.createElement('p');
    cashLabel.style.cssText = 'margin-top:10px;font-weight:700;color:var(--text);font-size:0.88rem;';
    cashLabel.textContent = '\u{1F3EA} Code de paiement au relais :';
    wrap.appendChild(cashLabel);

    var cashCode = document.createElement('div');
    cashCode.style.cssText = 'display:inline-block;background:#fffbeb;color:#92400e;font-weight:800;font-size:1.15rem;padding:8px 22px;border-radius:10px;margin:6px 0;letter-spacing:2px;border:2px solid #fde68a;font-family:monospace;';
    cashCode.textContent = order.cash_ref_code;
    wrap.appendChild(cashCode);
  }

  /* Discount fid\u00e9lit\u00e9 */
  if (fullResult && fullResult.discount_pct > 0) {
    var discDiv = document.createElement('div');
    discDiv.style.cssText = 'margin-top:10px;padding:8px 12px;background:#ecfdf5;border-radius:8px;border:1px solid #a7f3d0;font-size:0.82rem;color:#065f46;font-weight:600;';
    discDiv.textContent = '\u{1F381} Fid\u00e9lit\u00e9 ' + (fullResult.loyalty_label || '') + ' : -' + fullResult.discount_pct + '% (-' + fmt(fullResult.discount_kmf, 'KMF') + ')';
    wrap.appendChild(discDiv);
  }

  /* Wallet deduction display */
  if (fullResult && fullResult.credit_applied_kmf > 0) {
    var walDiv = document.createElement('div');
    walDiv.style.cssText = 'margin-top:6px;padding:8px 14px;background:linear-gradient(135deg,#fffbf0,#fef3e2);border-radius:8px;font-size:0.85rem;text-align:center;';
    walDiv.innerHTML = '\u{1F4B0} Cr\u00e9dit boutique appliqu\u00e9 : <strong style="color:var(--primary)">-' + fmt(fullResult.credit_applied_kmf, 'KMF') + '</strong>';
    wrap.appendChild(walDiv);
  }


  /* Info block */
  var info = document.createElement('div');
  info.style.cssText = 'margin-top:12px;padding:10px 12px;background:var(--bg);border-radius:10px;font-size:0.82rem;color:var(--muted);line-height:1.6;text-align:left;';

  var l1 = document.createElement('div');
  l1.textContent = '\u{1F3EA} Paiement en cash (KMF) au point relais lors du retrait.';
  info.appendChild(l1);

  var l2 = document.createElement('div');
  l2.style.marginTop = '4px';
  l2.textContent = '\u{1F4F1} ' + sanitize(recipientName || '') + ' recevra un SMS de confirmation.';
  info.appendChild(l2);

  if (clientEmail) {
    var l3 = document.createElement('div');
    l3.style.marginTop = '4px';
    l3.textContent = '\u{1F4E7} Suivi envoy\u00e9 \u00e0 ' + sanitize(clientEmail);
    info.appendChild(l3);
  }

  var l4 = document.createElement('div');
  l4.style.marginTop = '4px';
  l4.textContent = '\u{1F4CD} Pr\u00e9sentez la r\u00e9f\u00e9rence ou le code au point relais.';
  info.appendChild(l4);

  wrap.appendChild(info);

  /* Bouton Suivre */
  var trackBtn = document.createElement('button');
  trackBtn.style.cssText = 'margin-top:12px;width:100%;padding:11px;border-radius:var(--radius);font-weight:700;font-size:0.9rem;background:var(--primary);color:white;border:none;cursor:pointer;transition:background 0.2s;';
  trackBtn.textContent = '\u{1F4CD} Suivre ma commande';
  trackBtn.addEventListener('mouseenter', function() { this.style.background = 'var(--primary-dark)'; });
  trackBtn.addEventListener('mouseleave', function() { this.style.background = 'var(--primary)'; });
  trackBtn.addEventListener('click', function() {
    closeOrderModal();
    var refVal = order.reference || '';
    if (refVal) {
      var trackInput = document.getElementById('tracking-input');
      if (trackInput) {
        trackInput.value = refVal;
        var trackSection = document.getElementById('tracking');
        if (trackSection) trackSection.scrollIntoView({ behavior: 'smooth' });
        setTimeout(function() { if (typeof searchTracking === 'function') searchTracking(); }, 500);
      }
    }
  });
  wrap.appendChild(trackBtn);

  /* Bouton Fermer */
  var closeBtn = document.createElement('button');
  closeBtn.style.cssText = 'margin-top:6px;width:100%;padding:10px;border-radius:var(--radius);font-weight:600;font-size:0.85rem;background:var(--bg);color:var(--text);border:1px solid var(--border);cursor:pointer;transition:background 0.2s;';
  closeBtn.textContent = 'Fermer';
  closeBtn.addEventListener('mouseenter', function() { this.style.background = 'var(--border)'; });
  closeBtn.addEventListener('mouseleave', function() { this.style.background = 'var(--bg)'; });
  closeBtn.addEventListener('click', closeOrderModal);
  wrap.appendChild(closeBtn);

  body.appendChild(wrap);
}

/* ──────────────────────────────────────
   TRACKING
   ────────────────────────────────────── */
var TRACKING_STEPS = [
  { key: 'confirmed', label: 'Commande confirmée', icon: '📋' },
  { key: 'ordered', label: 'Paiement validé', icon: '💳' },
  { key: 'preparation', label: 'Préparation', icon: '📦' },
  { key: 'shipped', label: 'Expédié', icon: '✈️' },
  { key: 'in_transit', label: 'En transit', icon: '🚢' },
  { key: 'available', label: 'Disponible au relais', icon: '🏪' },
  { key: 'collected', label: 'Remis au client', icon: '✅' }
];

async function searchTracking() {
  var ref = $('tracking-input').value.trim();
  if (!ref) { toast('Veuillez entrer une référence.', 'error'); return; }
  var result = $('tracking-result');
  result.style.display = 'block';
  result.innerHTML = '';
  var loading = document.createElement('p');
  loading.style.cssText = 'text-align:center;color:var(--muted);padding:16px;';
  loading.textContent = 'Recherche en cours…';
  result.appendChild(loading);
  try {
    var data = await apiGet('/api/orders/' + encodeURIComponent(ref));
    result.innerHTML = '';
    var order = data.order || data;

    /* Determine effective status — prefer parcel-based if available */
    var parcels = order.parcels || [];
    var effectiveStatus = (order.status || 'confirmed').toLowerCase();
    if (parcels.length > 0) {
      var statusOrder = TRACKING_STEPS.map(function(s) { return s.key; });
      var minIdx = statusOrder.length;
      parcels.forEach(function(p) {
        var idx = statusOrder.indexOf((p.status || '').toLowerCase());
        if (idx >= 0 && idx < minIdx) minIdx = idx;
      });
      if (minIdx < statusOrder.length) effectiveStatus = statusOrder[minIdx];
    }

    var refDiv = document.createElement('div');
    refDiv.style.cssText = 'font-weight:700;margin-bottom:16px;font-size:1rem;';
    refDiv.textContent = 'Commande : ' + sanitize(order.reference || ref);
    result.appendChild(refDiv);

    /* Parcel count hint */
    if (parcels.length > 1) {
      var hint = document.createElement('div');
      hint.style.cssText = 'font-size:0.8rem;color:var(--muted);margin-bottom:12px;';
      hint.textContent = '📦 ' + parcels.length + ' colis pour cette commande';
      result.appendChild(hint);
    }

    var timeline = document.createElement('div');
    timeline.className = 'timeline';
    var reachedCurrent = false;
    TRACKING_STEPS.forEach(function(step) {
      var stepDiv = document.createElement('div');
      stepDiv.className = 'timeline-step';
      if (!reachedCurrent) {
        if (step.key === effectiveStatus) { stepDiv.classList.add('current'); reachedCurrent = true; }
        else { stepDiv.classList.add('done'); }
      }
      var dot = document.createElement('div');
      dot.className = 'timeline-dot';
      dot.textContent = step.icon;
      stepDiv.appendChild(dot);
      var label = document.createElement('div');
      label.className = 'timeline-label';
      label.textContent = step.label;
      stepDiv.appendChild(label);
      timeline.appendChild(stepDiv);
    });
    result.appendChild(timeline);
  } catch (e) {
    result.innerHTML = '';
    var err = document.createElement('div');
    err.className = 'tracking-error';
    err.textContent = 'Commande non trouvée. Vérifiez votre référence.';
    result.appendChild(err);
  }
}

/* ──────────────────────────────────────
   INIT
   ────────────────────────────────────── */
/* ── Clear entire cart ── */
function clearCart() {
  if (!confirm('Vider tout le panier ?')) return;
  _cart = [];
  saveCart();
  renderCartBody();
  toast('Panier vidé', 'info');
}


/* ── Mise à jour badge favoris ── */
function updateFavBadge() {
  var count = Object.keys(_favs).length;
  var badge = document.getElementById('fav-count-badge');
  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline' : 'none';
  }
}


/* ── Rendu grille favoris ── */
function renderFavs() {
  var grid = document.getElementById('favs-grid');
  if (!grid) return;
  var favIds = Object.keys(_favs);
  if (!favIds.length) {
    grid.innerHTML = '<p style="color:var(--muted);grid-column:1/-1;text-align:center;padding:40px 0;">Aucun favori — cliquez sur ♡ sur un produit pour l\'ajouter.</p>';
    return;
  }
  var favProducts = _products.filter(function(p) { return _favs[p.id]; });
  grid.innerHTML = '';
  favProducts.forEach(function(p) {
    var card = document.createElement('div');
    card.className = 'product-card';
    card.setAttribute('data-id', p.id);
    card.addEventListener('click', function(e) {
      if (e.target.closest('.btn-add-cart') || e.target.closest('.btn-fav')) return;
      openProductModal(p);
    });

    var imgDiv = document.createElement('div');
    imgDiv.className = 'card-img';
    imgDiv.style.position = 'relative';
    if (p.image_url) {
      var img = document.createElement('img');
      img.src = p.image_url;
      img.alt = sanitize(p.name);
      img.loading = 'eager';
      img.decoding = 'async';
      img.onerror = function() { this.style.display='none'; this.parentElement.textContent = productEmoji(p); };
      imgDiv.appendChild(img);
    } else {
      imgDiv.textContent = productEmoji(p);
    }
    card.appendChild(imgDiv);

    var body = document.createElement('div');
    body.className = 'card-body';

    var cat = document.createElement('div');
    cat.className = 'card-category';
    cat.textContent = categoryLabel(p.category);
    body.appendChild(cat);

    var name = document.createElement('div');
    name.className = 'card-name';
    name.textContent = p.name;
    body.appendChild(name);

    var price = document.createElement('div');
    price.className = 'card-price';
    price.textContent = fmt(p.price_kmf || 0, 'KMF');
    body.appendChild(price);

    var actions = document.createElement('div');
    actions.className = 'card-actions';

    var addBtn = document.createElement('button');
    addBtn.className = 'btn-add-cart';
    addBtn.textContent = 'Ajouter';
    addBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      addToCart(p, 1, addBtn);
    });
    actions.appendChild(addBtn);

    var favBtn = document.createElement('button');
    favBtn.className = 'btn-fav';
    favBtn.textContent = '♥';
    favBtn.style.color = '#ef4444';
    favBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      toggleFav(p.id);
      updateFavBadge();
      renderFavs();
    });
    actions.appendChild(favBtn);

    body.appendChild(actions);
    card.appendChild(body);
    grid.appendChild(card);
  });
}

/* ── Vue rangées swipeables par catégorie ── */
var _viewMode = 'grid'; /* 'grid' ou 'rows' */
var _CAT_ORDER = ['Mode', 'Sur-mesure', 'Beauté', 'Tech', 'Enfant'];


function renderRows(list) {
  var track = $('product-track');
  track.className = 'cat-rows-view';
  track.innerHTML = '';

  var byCategory = {};
  _CAT_ORDER.forEach(function(cat) { byCategory[cat] = []; });
  list.forEach(function(p) {
    if (byCategory[p.category]) byCategory[p.category].push(p);
    else {
      if (!byCategory[p.category]) byCategory[p.category] = [];
      byCategory[p.category].push(p);
    }
  });

  _CAT_ORDER.forEach(function(cat) {
    var items = byCategory[cat];
    if (!items || !items.length) return;

    var section = document.createElement('div');
    section.className = 'cat-row-section';

    var header = document.createElement('div');
    header.className = 'cat-row-header';
    var title = document.createElement('div');
    title.className = 'cat-row-title';
    title.textContent = cat;
    var more = document.createElement('button');
    more.className = 'cat-row-more';
    more.textContent = 'Voir tout →';
    more.addEventListener('click', function() {
      /* Activer le filtre catégorie */
      document.querySelectorAll('.cat-circle').forEach(function(c) { c.classList.remove('active'); });
      var targetPill = document.querySelector('.cat-circle[data-cat="' + cat + '"]');
      if (targetPill) targetPill.classList.add('active');
      _viewMode = 'grid';
      updateViewToggle();
      renderProducts(list.filter(function(p) { return p.category === cat; }));
    });
    header.appendChild(title);
    header.appendChild(more);
    section.appendChild(header);

    var swipeTrack = document.createElement('div');
    swipeTrack.className = 'swipe-track';

    items.forEach(function(p) {
      var card = document.createElement('div');
      card.className = 'swipe-card';
      card.addEventListener('click', function(e) {
        if (e.target.closest('.swipe-card-add')) return;
        openProductModal(p);
      });

      var imgDiv = document.createElement('div');
      imgDiv.className = 'swipe-card-img';
      if (p.is_promo && p.promo_pct) {
        var badge = document.createElement('div');
        badge.style.cssText = 'position:absolute;top:8px;left:8px;background:var(--accent);color:#1e2a38;font-size:9px;font-weight:800;padding:2px 6px;border-radius:4px;z-index:2;';
        badge.textContent = 'SOLDES -' + p.promo_pct + '%';
        imgDiv.appendChild(badge);
      }
      if (p.image_url) {
        var img = document.createElement('img');
        img.src = p.image_url;
        img.alt = sanitize(p.name);
        imgDiv.appendChild(img);
      } else {
        imgDiv.style.cssText += 'display:flex;align-items:center;justify-content:center;font-size:3rem;';
        imgDiv.textContent = productEmoji(p);
      }
      card.appendChild(imgDiv);

      var body = document.createElement('div');
      body.className = 'swipe-card-body';
      var name = document.createElement('div');
      name.className = 'swipe-card-name';
      name.textContent = p.name;
      body.appendChild(name);
      var price = document.createElement('div');
      price.className = 'swipe-card-price';
      price.textContent = fmt(p.price_kmf || 0, 'KMF');
      body.appendChild(price);
      var addBtn = document.createElement('button');
      addBtn.className = 'swipe-card-add' + (p.is_promo ? ' solde' : '');
      addBtn.textContent = '+ Panier';
      addBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        addToCart(p, 1, addBtn);
      });
      body.appendChild(addBtn);
      card.appendChild(body);
      swipeTrack.appendChild(card);
    });

    section.appendChild(swipeTrack);
    track.appendChild(section);
  });
}


function updateViewToggle() {
  var gridBtn = document.getElementById('view-grid-btn');
  var rowsBtn = document.getElementById('view-rows-btn');
  if (!gridBtn || !rowsBtn) return;
  if (_viewMode === 'grid') {
    gridBtn.style.background = 'var(--primary)'; gridBtn.style.borderColor = 'var(--primary)'; gridBtn.style.color = 'white';
    rowsBtn.style.background = 'white'; rowsBtn.style.borderColor = 'var(--border)'; rowsBtn.style.color = 'var(--muted)';
    document.getElementById('product-track').className = 'product-grid';
  } else {
    rowsBtn.style.background = 'var(--primary)'; rowsBtn.style.borderColor = 'var(--primary)'; rowsBtn.style.color = 'white';
    gridBtn.style.background = 'white'; gridBtn.style.borderColor = 'var(--border)'; gridBtn.style.color = 'var(--muted)';
  }
}


document.addEventListener('DOMContentLoaded', function() {

  // Force scroll to top on load — prevent # anchor jump hiding hero/categories
  if (!location.hash || location.hash === '#') {
    window.scrollTo(0, 0);
    if (history.replaceState) history.replaceState(null, '', location.pathname);
  }

  loadProducts();
  setTimeout(function(){ _firstLoad = false; }, 2000);
  loadRelais();
  refreshCartBadge();
  initPromoBar();
  initHeroSearch();
  /* ── Category pills auto-scroll + arrows ── */
  (function initCatScroll() {
    var wrap = document.querySelector('.cat-circles-wrap');
    var track = document.getElementById('cat-pills');
    if (!wrap || !track) return;

    var arrowL = document.createElement('button');
    arrowL.className = 'cat-scroll-btn cat-scroll-left hidden';
    arrowL.innerHTML = '&#8249;';
    arrowL.setAttribute('aria-label', 'Défiler gauche');

    var arrowR = document.createElement('button');
    arrowR.className = 'cat-scroll-btn cat-scroll-right';
    arrowR.innerHTML = '&#8250;';
    arrowR.setAttribute('aria-label', 'Défiler droite');

    wrap.appendChild(arrowL);
    wrap.appendChild(arrowR);

    function updateCatArrows() {
      arrowL.classList.toggle('hidden', wrap.scrollLeft <= 8);
      arrowR.classList.toggle('hidden', wrap.scrollLeft >= wrap.scrollWidth - wrap.clientWidth - 8);
    }

    /* ── Auto-scroll doux : défile tout seul, pause au hover/touch ── */
    var _autoDir = 1;
    var _autoSpeed = 0.5;
    var _autoPaused = false;
    var _autoTimer = null;

    function autoScrollTick() {
      if (_autoPaused) return;
      var maxScroll = wrap.scrollWidth - wrap.clientWidth;
      if (maxScroll <= 0) return;
      wrap.scrollLeft += _autoDir * _autoSpeed;
      if (wrap.scrollLeft >= maxScroll - 2) { _autoDir = -1; }
      if (wrap.scrollLeft <= 2) { _autoDir = 1; }
      updateCatArrows();
    }

    // Auto-scroll disabled — categories spread evenly
    // setTimeout(function() {
    //   _autoTimer = setInterval(autoScrollTick, 20);
    // }, 2000);

    // Pause on hover/touch
    wrap.addEventListener('mouseenter', function() { _autoPaused = true; });
    wrap.addEventListener('mouseleave', function() { _autoPaused = false; });
    wrap.addEventListener('touchstart', function() { _autoPaused = true; }, {passive:true});
    wrap.addEventListener('touchend', function() { setTimeout(function(){ _autoPaused = false; }, 3000); });

    /* ── Manual arrows: click to scroll by chunk ── */
    var _manualTimer = null;
    var _manualSpeed = 2;

    function startManualScroll(dir) {
      stopManualScroll();
      _autoPaused = true;
      _manualSpeed = 2;
      _manualTimer = setInterval(function() {
        wrap.scrollLeft += dir * _manualSpeed;
        if (_manualSpeed < 6) _manualSpeed += 0.15;
        updateCatArrows();
      }, 16);
    }
    function stopManualScroll() {
      if (_manualTimer) { clearInterval(_manualTimer); _manualTimer = null; }
      _manualSpeed = 2;
      setTimeout(function(){ _autoPaused = false; }, 2000);
    }

    arrowL.addEventListener('mousedown', function(e) { e.preventDefault(); startManualScroll(-1); });
    arrowR.addEventListener('mousedown', function(e) { e.preventDefault(); startManualScroll(1); });
    arrowL.addEventListener('touchstart', function(e) { e.preventDefault(); startManualScroll(-1); }, {passive:false});
    arrowR.addEventListener('touchstart', function(e) { e.preventDefault(); startManualScroll(1); }, {passive:false});
    document.addEventListener('mouseup', stopManualScroll);
    document.addEventListener('touchend', stopManualScroll);
    arrowL.addEventListener('mouseleave', stopManualScroll);
    arrowR.addEventListener('mouseleave', stopManualScroll);

    wrap.addEventListener('scroll', updateCatArrows, {passive: true});
    setTimeout(updateCatArrows, 500);
  })();


  /* ── Toggle vue grille / rangées ── */
  var viewGridBtn = document.getElementById('view-grid-btn');
  var viewRowsBtn = document.getElementById('view-rows-btn');
  if (viewGridBtn) {
    viewGridBtn.addEventListener('click', function() {
      _viewMode = 'grid';
      updateViewToggle();
      document.getElementById('product-track').className = 'product-grid';
      renderProducts(_lastList || _products);
    });
  }
  if (viewRowsBtn) {
    viewRowsBtn.addEventListener('click', function() {
      _viewMode = 'rows';
      updateViewToggle();
      renderRows(_lastList || _products);
    });
  }

  /* ── Onglets navigation ── */
  var tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      tabBtns.forEach(function(b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'favoris') renderFavs();
    });
  });
  updateFavBadge();

  /* ── Cercles catégories ── */
  var pills = document.querySelectorAll('.cat-circle');
  pills.forEach(function(pill) {
    pill.addEventListener('click', function() {
      pills.forEach(function(p) { p.classList.remove('active'); });
      pill.classList.add('active');
      var cat = pill.dataset.cat;
      var filtered = cat ? _products.filter(function(p) {
        return (p.category || '').toLowerCase() === cat.toLowerCase();
      }) : _products;
      _currentSort = '';
      document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
      document.querySelector('.filter-btn[data-sort=""]').classList.add('active');
      renderProducts(filtered);
      // No scroll — filter in place, categories stay visible
    });
  });

  /* ── Filtre tri rapide ── */
  var filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      filterBtns.forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var sort = btn.dataset.sort;
      var activeCat = document.querySelector('.cat-circle.active');
      var cat = activeCat ? activeCat.dataset.cat : '';
      var base = cat ? _products.filter(function(p) {
        return (p.category || '').toLowerCase() === cat.toLowerCase();
      }) : _products.slice();
      var sorted = base.slice();
      if (sort === 'promo') sorted = sorted.filter(function(p) { return p.is_promo; });
      else if (sort === 'price-asc') sorted.sort(function(a,b) { return a.price_kmf - b.price_kmf; });
      else if (sort === 'price-desc') sorted.sort(function(a,b) { return b.price_kmf - a.price_kmf; });
      else if (sort === 'stock') sorted = sorted.filter(function(p) { return p.stock > 0; });
      renderProducts(sorted);
    });
  });

  /* Wire footer buttons via addEventListener (CSP-safe, no inline onclick) */
  var omClose = document.getElementById('order-modal-close');
  if (omClose) omClose.addEventListener('click', function() { closeOrderModal(); });
  var pmClose = document.getElementById('product-modal-close');
  if (pmClose) pmClose.addEventListener('click', function() { closeProductModal(); });
  // Look modal listeners removed
  var cartCloseBtn = document.getElementById('cart-close-btn');
  if (cartCloseBtn) cartCloseBtn.addEventListener('click', function() { closeCart(); });
  var cartOverlay = document.getElementById('cart-overlay');
  if (cartOverlay) cartOverlay.addEventListener('click', function() { closeCart(); });
  var trackBtn = document.getElementById('tracking-search-btn');
  if (trackBtn) trackBtn.addEventListener('click', function() { searchTracking(); });
  var heroBtn = document.getElementById('hero-search-btn');
  if (heroBtn) heroBtn.addEventListener('click', function() { heroSearch(); });
  var prevBtn = document.getElementById('carousel-prev-btn');
  if (prevBtn) prevBtn.addEventListener('click', function() { scrollCarousel(-1); });
  var nextBtn = document.getElementById('carousel-next-btn');
  if (nextBtn) nextBtn.addEventListener('click', function() { scrollCarousel(1); });
  var navCartBtn = document.getElementById('nav-cart-btn');
  if (navCartBtn) navCartBtn.addEventListener('click', function() { openCart(); });
  var fcBtn = document.getElementById('footer-continue-btn');
  if (fcBtn) fcBtn.addEventListener('click', function() { closeCart(); });
  var fclBtn = document.getElementById('footer-clear-btn');
  if (fclBtn) fclBtn.addEventListener('click', function() { clearCart(); });
  var fcoBtn = document.getElementById('footer-checkout-btn');
  if (fcoBtn) fcoBtn.addEventListener('click', function() { checkoutCart(); });
  var fwaBtn = document.getElementById('footer-whatsapp-btn');
  if (fwaBtn) fwaBtn.addEventListener('click', function() { shareCartWhatsApp(); });

  $('product-modal').addEventListener('click', function(e) {
    if (e.target === $('product-modal')) closeProductModal();
  });
  $('order-modal').addEventListener('click', function(e) {
    if (e.target === $('order-modal')) closeOrderModal();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { closeProductModal(); closeOrderModal(); closeCart(); }
  });
  $('tracking-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') searchTracking();
  });

  // ─── Service Worker Registration ──────────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/sw.js').then(function(reg) {
        console.log('[Komerce] SW registered, scope:', reg.scope);
      }).catch(function(err) {
        console.warn('[Komerce] SW registration failed:', err);
      });
    });
  }

});