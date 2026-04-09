/* ============================================================
   KOMERCE — État central
   Toutes les variables globales regroupées ici
   ============================================================ */

var KState = {
  /* Données produits */
  products: [],
  relais: [],
  lastList: [],

  /* Panier */
  cart: [],

  /* Favoris */
  favs: {},

  /* Devise */
  currency: 'EUR',
  rates: { EUR: 495, KMF: 1 },

  /* Navigation catégories */
  activeMainCat: null,
  activeSubCat: null,
  bloomTimeout: null,
  bloomLocked: false,

  /* Catalogue */
  currentSort: '',
  viewMode: 'grid',
  catOrder: ['Mode', 'Sur-mesure', 'Beauté', 'Tech', 'Enfant'],

  /* Modale produit */
  pdQty: 1,

  /* Recherche */
  searchIdx: -1,

  /* Commande */
  orderData: { is_self_pickup: true },

  /* Règles complémentarité */
  complementRules: {
    'Mode':       ['Beauté', 'Sur-mesure'],
    'Sur-mesure': ['Mode', 'Beauté'],
    'Beauté':     ['Mode', 'Sur-mesure'],
    'Tech':       ['Tech'],
    'Enfant':     ['Enfant', 'Mode']
  },

  /* Look complet */
  lookLabels: ['La pièce', 'Chaussures', 'Beauté', 'Accessoire'],
};

/* ── Bloom situations (navigation catégories) ── */
KState.situations = {
  mode: {
    label: 'Mode & Vêtements', color: '#7c3aed', rgb: '124,58,237',
    subcats: [
      { id:'mode-vetements',  name:'Vêtements & boubous', emoji:'\u{1F458}', category:'vetements',   desc:'Tenues, boubous, abayas' },
      { id:'mode-tissus',     name:'Tissus & couture',    emoji:'\u{1F9F5}', category:'tissus',      desc:'Wax, bazin, dentelle' },
      { id:'mode-chaussures', name:'Chaussures',          emoji:'\u{1F45F}', category:'chaussures',  desc:'Sneakers, sandales' },
      { id:'mode-access',     name:'Accessoires',         emoji:'\u{1F48D}', category:'accessoires', desc:'Sacs, bijoux, montres' }
    ]
  },
  maison: {
    label: 'Maison & Déco', color: '#0891b2', rgb: '8,145,178',
    subcats: [
      { id:'maison-cuisine', name:'Cuisine',     emoji:'\u{1F373}', category:'cuisine',    desc:'Ustensiles, appareils' },
      { id:'maison-deco',    name:'Décoration',  emoji:'\u{1FAB4}', category:'decoration', desc:'Tableaux, luminaires' },
      { id:'maison-entret',  name:'Entretien',   emoji:'\u{1F9F9}', category:'entretien',  desc:'Nettoyage, ménager' },
      { id:'maison-equip',   name:'Équipement',  emoji:'\u{1F50C}', category:'equipement', desc:'Ventilo, multiprises' }
    ]
  },
  tech: {
    label: 'Tech & Électronique', color: '#0369a1', rgb: '3,105,161',
    subcats: [
      { id:'tech-phones',   name:'Téléphones',     emoji:'\u{1F4F1}', category:'telephones',      desc:'Samsung, Xiaomi' },
      { id:'tech-access',   name:'Accessoires tel', emoji:'\u{1F50B}', category:'accessoires-tel', desc:'Coques, chargeurs' },
      { id:'tech-audio',    name:'Audio & image',   emoji:'\u{1F3A7}', category:'audio',           desc:'Écouteurs, enceintes' },
      { id:'tech-hightech', name:'High-tech',       emoji:'\u{1F4BB}', category:'hightech',        desc:'Tablettes, PC' }
    ]
  },
  beaute: {
    label: 'Beauté & Bien-être', color: '#be185d', rgb: '190,24,93',
    subcats: [
      { id:'beaute-soins',   name:'Soins',      emoji:'\u{1F9F4}', category:'soins',     desc:'Visage, corps' },
      { id:'beaute-cheveux', name:'Cheveux',    emoji:'\u{1F487}', category:'cheveux',   desc:'Huiles, soins' },
      { id:'beaute-parfums', name:'Parfums',    emoji:'\u{1F338}', category:'parfums',   desc:'Oud, musc' },
      { id:'beaute-makeup',  name:'Maquillage', emoji:'\u{1F484}', category:'maquillage',desc:'Palettes, rouges' }
    ]
  },
  enfants: {
    label: 'Enfants & Bébé', color: '#d97706', rgb: '217,119,6',
    subcats: [
      { id:'enf-vetements', name:'Vêtements enfant', emoji:'\u{1F476}', category:'vetements-enfant', desc:'Boubous, robes' },
      { id:'enf-bebe',      name:'Bébé',             emoji:'\u{1F37C}', category:'bebe',             desc:'Couches, biberons' },
      { id:'enf-jouets',    name:'Jouets',           emoji:'\u{1F3AE}', category:'jouets',           desc:'Jeux, peluches' },
      { id:'enf-ecole',     name:'École',            emoji:'\u{1F4DA}', category:'ecole',            desc:'Cahiers, cartables' }
    ]
  },
  surmesure: {
    label: 'Sur Mesure', color: '#059669', rgb: '5,150,105',
    subcats: [
      { id:'sm-couture',   name:'Couture',              emoji:'\u2702\uFE0F', category:'couture',         desc:'Tissus, abayas, salouva' },
      { id:'sm-mariage',   name:'Mariage',              emoji:'\u{1F492}',   category:'mariage-custom',  desc:'Tenue mariée, déco' },
      { id:'sm-scolaire',  name:'Scolaire',             emoji:'\u{1F393}',   category:'scolaire',        desc:'Uniformes, fournitures' },
      { id:'sm-fetes',     name:'Fêtes & cérémonies',  emoji:'\u{1F389}',   category:'fetes',           desc:'Manzaraka, Anda' },
      { id:'sm-tradition', name:'Traditionnel',         emoji:'\u{1F458}',   category:'traditionnel',    desc:'Chiromani, kofia' },
      { id:'sm-optique',   name:'Optique',              emoji:'\u{1F453}',   category:'optique',         desc:'Lunettes, verres' }
    ]
  }
};

/* ── Persistence panier ── */
(function initCart() {
  try {
    var saved = localStorage.getItem('komerce_cart');
    if (saved) KState.cart = JSON.parse(saved);
  } catch(e) { KState.cart = []; }
})();

/* ── Persistence favoris ── */
(function initFavs() {
  try {
    var saved = localStorage.getItem('komerce_favs');
    if (saved) KState.favs = JSON.parse(saved);
  } catch(e) { KState.favs = {}; }
})();

/* ── Alias de compatibilité (backward compat avec l'ancien code global) ── */
var _products = KState.products;
var _cart = KState.cart;
var _favs = KState.favs;
var _activeMainCat = KState.activeMainCat;
var _activeSubCat = KState.activeSubCat;
var _bloomTimeout = KState.bloomTimeout;
var _bloomLocked = KState.bloomLocked;
var _currentSort = KState.currentSort;
var _lastList = KState.lastList;
var _searchIdx = KState.searchIdx;
var _complementRules = KState.complementRules;
var _lookLabels = KState.lookLabels;
var _viewMode = KState.viewMode;
var _CAT_ORDER = KState.catOrder;
var _situations = KState.situations;
var _orderData = KState.orderData;
