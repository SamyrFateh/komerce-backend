/**
 * KOMERCE — Middleware upload images produits (D1/BUG-016)
 *
 * Utilise multer pour l'upload de fichiers images.
 * Stockage : public/uploads/products/
 * Formats : JPG, PNG, WebP, GIF · Max 5 Mo
 *
 * ⚠️ Railway : le filesystem est éphémère. Les images uploadées
 * survivent aux restarts mais PAS aux redéploiements.
 * TODO Phase 2 : Migrer vers S3/Cloudflare R2 pour la persistence en prod.
 */

'use strict';

const multer = require('multer');
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'products');

// Créer le dossier si nécessaire
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const name = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, name);
  },
});

const fileFilter = (_req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Format image non supporté. Utilisez JPG, PNG, WebP ou GIF.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 Mo max
});

module.exports = upload;
