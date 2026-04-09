/**
 * KOMERCE — Seeds & fix data
 */

'use strict';

const db = require('../db');
const bcrypt = require('bcryptjs');

// ── SEED : Admin par défaut ──────────────────────────────────────────────────
async function seedAdmin() {
  try {
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    console.log('[seedAdmin] Hashing password...');
    const hash = await bcrypt.hash(adminPassword, 10);
    console.log('[seedAdmin] Hash done. Checking existing admin...');

    const { rows } = await db.query(
      "SELECT id, email FROM users WHERE email = 'admin@komerce.km' LIMIT 1"
    );
    console.log('[seedAdmin] Query done. rows:', rows.length);

    if (rows.length === 0) {
      console.log('[seedAdmin] No admin found — inserting...');
      await db.query(
        `INSERT INTO users (full_name, email, phone, role, currency_pref, country, password_hash)
         VALUES ('Admin Komerce', 'admin@komerce.km', '+269000000', 'admin', 'KMF', 'KM', $1)`,
        [hash]
      );
      console.log('🔒 Seed admin: admin@komerce.km créé avec succès');
    } else {
      console.log('[seedAdmin] Admin found — updating password...');
      await db.query(
        "UPDATE users SET password_hash = $1, role = 'admin' WHERE email = 'admin@komerce.km'",
        [hash]
      );
      console.log('🔒 Seed admin: mot de passe forcé sur admin@komerce.km');
    }
  } catch (err) {
    console.error('[seedAdmin] ERREUR:', err.message);
    console.error('[seedAdmin] Stack:', err.stack);
  }
}

// ── Fix encoding ───────────────────────────────────────────────────────────
async function fixProductEncoding() {
  const fixes = [
    { price_kmf: 99000, category: 'telephones', name: 'Samsung Galaxy A35 (128Go)', description: 'Écran AMOLED 6.6", 50MP, double SIM, batterie 5000mAh. Réseau 4G stable aux Comores.', emoji: '📱' },
    { price_kmf: 39600, category: 'audio', name: 'Écouteurs Samsung Galaxy Buds2', description: 'Réduction de bruit active, 5h autonomie + 15h boîtier. Compatible Android & iOS.', emoji: '🎧' },
    { price_kmf: 14850, category: 'accessoires-tel', name: 'Pack coques + accessoires (5 pièces)', description: 'Coque renforcée + verre trempé + chargeur rapide 25W + câble USB-C + support voiture.', emoji: '📱' },
    { price_kmf: 19800, category: 'accessoires-tel', name: 'Chargeur rapide 65W GaN (multi-ports)', description: '3 ports (2 USB-C + 1 USB-A), compact. Charge téléphone + tablette + PC simultanément.', emoji: '🔌' },
    { price_kmf: 24750, category: 'equipement', name: 'Ventilateur sur pied 16"', description: 'Oscillant 3 vitesses, silencieux, télécommande. Indispensable aux Comores toute année.', emoji: '🌀' },
    { price_kmf: 17325, category: 'equipement', name: 'Fer à repasser vapeur 2400W', description: 'Semelle céramique anti-adhésive, réservoir 300ml, départ rapide 30s.', emoji: '🔥' },
    { price_kmf: 9900, category: 'equipement', name: 'Multiprise 6 prises + 2 USB', description: 'Câble 2m, disjoncteur sécurité, 2 ports USB-A. Indispensable pour les foyers connectés.', emoji: '🔌' },
    { price_kmf: 12375, category: 'cuisine', name: 'Bouilloire électrique 1.7L inox', description: 'Arrêt automatique, protection anti-surchauffe, ébullition en 3 min.', emoji: '☕' },
    { price_kmf: 99000, category: 'accessoires', name: 'Montre homme acier brossé', description: 'Boîtier 42mm, bracelet acier, étanchéité 50m, verre saphir.', emoji: '⌚' },
    { price_kmf: 277200, category: 'accessoires', name: 'Collier or 18K (8g)', description: 'Or 18 carats certifié Dubai, chaîne maille forçat 45cm. Certificat authenticité inclus.', emoji: '💎' },
    { price_kmf: 59400, category: 'parfums', name: 'Parfum Oud Al Shuyukh 100ml', description: 'Parfum de luxe Dubai, notes de oud, ambre et rose. Longue tenue 12h+.', emoji: '🌹' },
    { price_kmf: 49500, category: 'mariage-custom', name: 'Coffret cadeau mariage (4 pièces)', description: 'Parfum + crème corps + savon artisanal + bracelet fantaisie.', emoji: '🎁' },
    { price_kmf: 34650, category: 'vetements', name: 'Djellaba homme brodée (L/XL/XXL)', description: 'Tissu Bazin premium, broderie traditionnelle dorée.', emoji: '🧥' },
    { price_kmf: 39600, category: 'vetements', name: 'Abaya femme dentelle Dubai (M/L/XL)', description: 'Tissu crêpe fluide, broderie dentelle sur les manches.', emoji: '👗' },
    { price_kmf: 19800, category: 'vetements', name: 'Boubou enfant 3-12 ans', description: 'Tissu wax africain, coupe ample confortable.', emoji: '👕' },
    { price_kmf: 54450, category: 'vetements', name: 'Caftan femme soirée (S/M/L/XL)', description: 'Tissu satiné Dubai, encolure brodée de perles.', emoji: '🥻' },
    { price_kmf: 24750, category: 'soins', name: 'Crème visage éclat au safran', description: 'Soin hydratant au safran de Perse + vitamine C. 50ml.', emoji: '✨' },
    { price_kmf: 34650, category: 'parfums', name: 'Parfum Oud Rose (50ml)', description: 'Eau de parfum Dubai, concentrée 20%, notes de rose et oud boisé.', emoji: '🌸' },
    { price_kmf: 17325, category: 'cheveux', name: 'Huile argan pure Maroc (100ml)', description: 'Argan bio certifié, pressée à froid. Soin cheveux + peau + ongles.', emoji: '🧴' },
    { price_kmf: 44550, category: 'soins', name: 'Coffret soins corps luxe (5 pièces)', description: 'Gommage + lait corps + huile + beurre de karité + savon noir.', emoji: '🧴' },
  ];
  for (const fix of fixes) {
    try {
      await db.query(`UPDATE products SET name=$1, description=$2, emoji=$3 WHERE price_kmf=$4 AND category=$5`,
        [fix.name, fix.description, fix.emoji, fix.price_kmf, fix.category]);
    } catch(e) { console.warn('Fix encoding skip:', fix.name, e.message); }
  }
}

// ── SEED : Produits ──────────────────────────────────────────────────────────
async function seedProducts() {
  const products = [
    { name: 'Samsung Galaxy A35 (128Go)', price_kmf: 99000, price_eur: 200, category: 'telephones', stock: 15, emoji: '📱', badge: 'Populaire', description: 'Écran AMOLED 6.6", 50MP, double SIM, batterie 5000mAh.' },
    { name: 'Écouteurs Samsung Galaxy Buds2', price_kmf: 39600, price_eur: 80, category: 'audio', stock: 20, emoji: '🎧', badge: null, description: 'Réduction de bruit active, 5h autonomie.' },
    { name: 'Pack coques + accessoires (5 pièces)', price_kmf: 14850, price_eur: 30, category: 'accessoires-tel', stock: 30, emoji: '📱', badge: 'Nouveau', description: 'Coque + verre trempé + chargeur 25W + câble USB-C + support.' },
    { name: 'Chargeur rapide 65W GaN (multi-ports)', price_kmf: 19800, price_eur: 40, category: 'accessoires-tel', stock: 25, emoji: '🔌', badge: null, description: '3 ports, compact, charge simultannée.' },
    { name: 'Ventilateur sur pied 16"', price_kmf: 24750, price_eur: 50, category: 'equipement', stock: 25, emoji: '🌀', badge: 'Best-seller', description: 'Oscillant 3 vitesses, télécommande.' },
    { name: 'Fer à repasser vapeur 2400W', price_kmf: 17325, price_eur: 35, category: 'equipement', stock: 18, emoji: '🔥', badge: null, description: 'Semelle céramique, départ rapide 30s.' },
    { name: 'Multiprise 6 prises + 2 USB', price_kmf: 9900, price_eur: 20, category: 'equipement', stock: 35, emoji: '🔌', badge: null, description: 'Câble 2m, disjoncteur sécurité.' },
    { name: 'Bouilloire électrique 1.7L inox', price_kmf: 12375, price_eur: 25, category: 'cuisine', stock: 22, emoji: '☕', badge: null, description: 'Arrêt automatique, ébullition en 3 min.' },
    { name: 'Montre homme acier brossé', price_kmf: 99000, price_eur: 200, category: 'accessoires', stock: 8, emoji: '⌚', badge: 'Exclusif', description: 'Boîtier 42mm, verre saphir.' },
    { name: 'Collier or 18K (8g)', price_kmf: 277200, price_eur: 560, category: 'accessoires', stock: 5, emoji: '💎', badge: 'Premium', description: 'Or 18 carats certifié Dubai.' },
    { name: 'Parfum Oud Al Shuyukh 100ml', price_kmf: 59400, price_eur: 120, category: 'parfums', stock: 12, emoji: '🌹', badge: null, description: 'Notes de oud, ambre et rose. Tenue 12h+.' },
    { name: 'Coffret cadeau mariage (4 pièces)', price_kmf: 49500, price_eur: 100, category: 'mariage-custom', stock: 15, emoji: '🎁', badge: 'Populaire', description: 'Parfum + crème + savon + bracelet.' },
    { name: 'Djellaba homme brodée (L/XL/XXL)', price_kmf: 34650, price_eur: 70, category: 'vetements', stock: 20, emoji: '🧥', badge: 'Best-seller', description: 'Tissu Bazin premium, broderie dorée.' },
    { name: 'Abaya femme dentelle Dubai (M/L/XL)', price_kmf: 39600, price_eur: 80, category: 'vetements', stock: 15, emoji: '👗', badge: 'Populaire', description: 'Tissu crêpe fluide, broderie dentelle.' },
    { name: 'Boubou enfant 3-12 ans', price_kmf: 19800, price_eur: 40, category: 'vetements', stock: 18, emoji: '👕', badge: null, description: 'Tissu wax africain.' },
    { name: 'Caftan femme soirée (S/M/L/XL)', price_kmf: 54450, price_eur: 110, category: 'vetements', stock: 10, emoji: '🥻', badge: 'Nouveau', description: 'Tissu satiné, encolure brodée de perles.' },
    { name: 'Crème visage éclat au safran', price_kmf: 24750, price_eur: 50, category: 'soins', stock: 20, emoji: '✨', badge: null, description: 'Safran de Perse + vitamine C. 50ml.' },
    { name: 'Parfum Oud Rose (50ml)', price_kmf: 34650, price_eur: 70, category: 'parfums', stock: 18, emoji: '🌸', badge: 'Best-seller', description: 'Concentrée 20%, notes de rose et oud.' },
    { name: 'Huile argan pure Maroc (100ml)', price_kmf: 17325, price_eur: 35, category: 'cheveux', stock: 25, emoji: '🧴', badge: null, description: 'Argan bio certifié, pressée à froid.' },
    { name: 'Coffret soins corps luxe (5 pièces)', price_kmf: 44550, price_eur: 90, category: 'soins', stock: 12, emoji: '🧴', badge: 'Nouveau', description: 'Gommage + lait + huile + beurre karité + savon.' },
  ];
  for (const p of products) {
    try {
      const exists = await db.query('SELECT id FROM products WHERE name = $1', [p.name]);
      if (exists.rows.length === 0) {
        await db.query(
          `INSERT INTO products (name, price_kmf, price_eur, category, stock, emoji, badge, description)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [p.name, p.price_kmf, p.price_eur, p.category, p.stock, p.emoji, p.badge, p.description]
        );
      }
    } catch(e) { console.warn('Seed product skip:', p.name, e.message); }
  }
  console.log('🌱 Seed produits OK');
}

// ── Fix categories ─────────────────────────────────────────────────────────────
async function fixProductCategories() {
  const migrations = [
    { oldCat: 'electronics', namePattern: '%Galaxy A%',       newCat: 'telephones' },
    { oldCat: 'electronics', namePattern: '%Buds%',           newCat: 'audio' },
    { oldCat: 'electronics', namePattern: '%coques%',         newCat: 'accessoires-tel' },
    { oldCat: 'electronics', namePattern: '%Chargeur%',       newCat: 'accessoires-tel' },
    { oldCat: 'home',        namePattern: '%Ventilateur%',    newCat: 'equipement' },
    { oldCat: 'home',        namePattern: '%repasser%',       newCat: 'equipement' },
    { oldCat: 'home',        namePattern: '%Multiprise%',     newCat: 'equipement' },
    { oldCat: 'home',        namePattern: '%Bouilloire%',     newCat: 'cuisine' },
    { oldCat: 'wedding',     namePattern: '%Montre%',         newCat: 'accessoires' },
    { oldCat: 'wedding',     namePattern: '%Collier%',        newCat: 'accessoires' },
    { oldCat: 'wedding',     namePattern: '%Parfum%Oud%',     newCat: 'parfums' },
    { oldCat: 'wedding',     namePattern: '%Coffret%mariage%',newCat: 'mariage-custom' },
    { oldCat: 'fashion',     namePattern: '%Djellaba%',       newCat: 'vetements' },
    { oldCat: 'fashion',     namePattern: '%Abaya%',          newCat: 'vetements' },
    { oldCat: 'fashion',     namePattern: '%Boubou%',         newCat: 'vetements' },
    { oldCat: 'fashion',     namePattern: '%Caftan%',         newCat: 'vetements' },
    { oldCat: 'services',    namePattern: '%Crème%visage%',   newCat: 'soins' },
    { oldCat: 'services',    namePattern: '%Parfum%Rose%',    newCat: 'parfums' },
    { oldCat: 'services',    namePattern: '%argan%',          newCat: 'cheveux' },
    { oldCat: 'services',    namePattern: '%Coffret%soins%',  newCat: 'soins' },
  ];
  for (const m of migrations) {
    try {
      await db.query(`UPDATE products SET category=$1 WHERE category=$2 AND name ILIKE $3`,
        [m.newCat, m.oldCat, m.namePattern]);
    } catch(e) { /* skip */ }
  }
}

// ── SEED : Relais ──────────────────────────────────────────────────────────────
async function seedRelais() {
  const relais = [
    { name: 'Relais Moroni Centre',    address: 'Avenue de la République, Moroni',  zone: 'Moroni centre',    island: 'Grande Comore', phone: '0321001001' },
    { name: 'Relais Mutsamudu Centre', address: 'Rue du Port, Mutsamudu',            zone: 'Mutsamudu centre', island: 'Anjouan',        phone: '0321002002' },
    { name: 'Relais Fomboni',          address: 'Place du Marché, Fomboni',          zone: 'Fomboni centre',   island: 'Mohéli',         phone: '0321003003' },
    { name: 'Relais Domoni',           address: 'Centre-ville, Domoni',              zone: 'Domoni',           island: 'Anjouan',        phone: '0321004004' },
    { name: 'Relais Sima',             address: 'Route principale, Sima',            zone: 'Sima',             island: 'Anjouan',        phone: '0321005005' },
  ];
  for (const r of relais) {
    try {
      const exists = await db.query('SELECT id FROM relais WHERE name = $1', [r.name]);
      if (exists.rows.length === 0) {
        await db.query('INSERT INTO relais (name, address, zone, island, phone, is_active) VALUES ($1,$2,$3,$4,$5,TRUE)',
          [r.name, r.address, r.zone, r.island, r.phone]);
      }
    } catch(e) { console.warn('Seed relais skip:', r.name, e.message); }
  }
  console.log('🌱 Seed relais OK');
}

// ── Fix images ───────────────────────────────────────────────────────────────
// Remplace les chemins locaux /uploads/ (perdus après redéploi Railway)
// ET les lignes vides — images Unsplash persistantes
async function fixProductImages() {
  const imageMap = {
    'Samsung Galaxy A35 (128Go)': 'https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=400&h=400&fit=crop',
    'Écouteurs Samsung Galaxy Buds2': 'https://images.unsplash.com/photo-1590658268037-6bf12f032f55?w=400&h=400&fit=crop',
    'Pack coques + accessoires (5 pièces)': 'https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=400&h=400&fit=crop',
    'Chargeur rapide 65W GaN (multi-ports)': 'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=400&h=400&fit=crop',
    'Ventilateur sur pied 16\"': 'https://images.unsplash.com/photo-1617375407361-9815c98f64c7?w=400&h=400&fit=crop',
    'Fer à repasser vapeur 2400W': 'https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=400&h=400&fit=crop',
    'Multiprise 6 prises + 2 USB': 'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=400&h=400&fit=crop',
    'Bouilloire électrique 1.7L inox': 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=400&fit=crop',
    'Montre homme acier brossé': 'https://images.unsplash.com/photo-1524592094714-0f0654e20314?w=400&h=400&fit=crop',
    'Collier or 18K (8g)': 'https://images.unsplash.com/photo-1515562141589-67f0d569b6e5?w=400&h=400&fit=crop',
    'Parfum Oud Al Shuyukh 100ml': 'https://images.unsplash.com/photo-1541643600914-78b084683601?w=400&h=400&fit=crop',
    'Coffret cadeau mariage (4 pièces)': 'https://images.unsplash.com/photo-1549465220-1a8b9238f760?w=400&h=400&fit=crop',
    'Djellaba homme brodée (L/XL/XXL)': 'https://images.unsplash.com/photo-1589902860314-e910697dea18?w=400&h=400&fit=crop',
    'Abaya femme dentelle Dubai (M/L/XL)': 'https://images.unsplash.com/photo-1583391733956-6c78276477e2?w=400&h=400&fit=crop',
    'Boubou enfant 3-12 ans': 'https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?w=400&h=400&fit=crop',
    'Caftan femme soirée (S/M/L/XL)': 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=400&h=400&fit=crop',
    'Crème visage éclat au safran': 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&h=400&fit=crop',
    'Parfum Oud Rose (50ml)': 'https://images.unsplash.com/photo-1588405748880-12d1d2a59f75?w=400&h=400&fit=crop',
    'Huile argan pure Maroc (100ml)': 'https://images.unsplash.com/photo-1608571423902-eed4a5ad8108?w=400&h=400&fit=crop',
    'Coffret soins corps luxe (5 pièces)': 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=400&h=400&fit=crop',
  };
  for (const [name, url] of Object.entries(imageMap)) {
    try {
      // Remplace si : pas d'image, image vide, OU chemin local /uploads/ (éphémère sur Railway)
      await db.query(
        `UPDATE products SET image_url=$1 WHERE name=$2 AND (image_url IS NULL OR image_url='' OR image_url LIKE '/uploads/%')`,
        [url, name]
      );
    } catch(e) { /* skip */ }
  }
}

async function runAllSeeds() {
  await seedAdmin();           // ← en premier
  await fixProductEncoding();
  await seedProducts();
  await fixProductCategories();
  await seedRelais();
  await fixProductImages();
}

module.exports = { runAllSeeds };
