/* ============================================================
   KOMERCE — Helpers utilitaires
   ============================================================ */

/* ── DOMPurify config ── */
var _dpConfig = { ADD_ATTR: ['style'], ADD_TAGS: ['img'], ALLOW_DATA_ATTR: true };

/* ── Sanitisation HTML (DOMPurify) ── */
function safeHTML(el, html) {
  el.innerHTML = (typeof DOMPurify !== 'undefined')
    ? DOMPurify.sanitize(html, _dpConfig)
    : html;
}

/* ── Escape texte brut (XSS) ── */
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/* ── getElementById raccourci ── */
function $(id) { return document.getElementById(id); }

/* ── Détection devise ── */
function detectCurrency() {
  try {
    var saved = localStorage.getItem('komerce_currency');
    if (saved) { KState.currency = saved; return; }
  } catch(e) {}
  KState.currency = 'EUR';
}

/* ── Formatage prix ── */
function fmt(kmf, currency) {
  var c = currency || KState.currency;
  if (c === 'KMF') return Math.round(kmf).toLocaleString('fr-FR') + ' KMF';
  var rate = (KState.rates && KState.rates[c]) ? KState.rates[c] : 495;
  var converted = kmf / rate;
  return '≈ ' + converted.toFixed(2).replace('.', ',') + ' €';
}

function fmtBoth(kmf) {
  return fmt(kmf, 'KMF') + ' / ' + fmt(kmf, 'EUR');
}

/* ── Emoji produit par défaut ── */
function productEmoji(p) { return p.emoji || '📦'; }

/* ── Disponibilité produit ── */
function availabilityInfo(p) {
  if (!p.is_available && p.is_available !== undefined) {
    return { cls: 'sourcing', icon: '⏳', label: 'Sur commande' };
  }
  if (p.stock === 0) {
    return { cls: 'sourcing', icon: '⏳', label: 'Sur commande' };
  }
  if (p.stock > 0) {
    return { cls: 'disponible', icon: '✅', label: 'Disponible' };
  }
  return { cls: 'surcommande', icon: '📋', label: 'Sur commande' };
}

/* ── Label catégorie ── */
function categoryLabel(cat) {
  var map = {
    'vetements': 'Vêtements', 'tissus': 'Tissus', 'chaussures': 'Chaussures',
    'accessoires': 'Accessoires', 'cuisine': 'Cuisine', 'decoration': 'Déco',
    'entretien': 'Entretien', 'equipement': 'Équipement', 'telephones': 'Téléphones',
    'accessoires-tel': 'Accessoires', 'audio': 'Audio', 'hightech': 'High-tech',
    'soins': 'Soins', 'cheveux': 'Cheveux', 'parfums': 'Parfums',
    'maquillage': 'Maquillage', 'vetements-enfant': 'Enfant', 'bebe': 'Bébé',
    'jouets': 'Jouets', 'ecole': 'École', 'couture': 'Couture',
    'mariage-custom': 'Mariage', 'scolaire': 'Scolaire', 'fetes': 'Fêtes',
    'traditionnel': 'Traditionnel', 'optique': 'Optique',
    'Mode': 'Mode', 'Sur-mesure': 'Sur-mesure', 'Beauté': 'Beauté',
    'Tech': 'Tech', 'Enfant': 'Enfant'
  };
  return map[cat] || cat || '';
}

/* ── Toast notification ── */
function toast(msg, type) {
  var container = document.getElementById('toast-container');
  if (!container) return;
  var t = document.createElement('div');
  t.className = 'toast toast-' + (type || 'info');
  t.textContent = msg;
  container.appendChild(t);
  requestAnimationFrame(function() { t.classList.add('show'); });
  setTimeout(function() {
    t.classList.remove('show');
    setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 400);
  }, 2800);
}

/* ── Animation bouton ajouté ── */
function btnAddedFeedback(btn, originalText) {
  if (!btn) return;
  var orig = originalText || btn.textContent;
  btn.textContent = 'Ajouté !';
  btn.classList.add('added');
  setTimeout(function() {
    btn.textContent = orig;
    btn.classList.remove('added');
  }, 1200);
}
