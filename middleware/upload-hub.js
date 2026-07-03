/**
 * @komerce-arch
 * @role         middleware-upload-hub
 * @domain       logistics
 * @layer        middleware
 * @criticality  high
 * @purpose      Upload des photos de scan hub Dubaï (borne 1 des fenêtres de
 *               responsabilité, doctrine non-conformité §2). Variante de
 *               middleware/upload.js dédiée au répertoire uploads/hub —
 *               mêmes deux lignes de défense (filtre extension + magic bytes).
 * @inputs       multipart/form-data (champ photo)
 * @outputs      req.file (multer), fichier sous public/uploads/hub/
 * @depends      middleware/upload.js (validateMagicBytes)
 * @used-by      routes/hub.js (POST /photo)
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     DOCTRINE_NON_CONFORMITE (Q-1)
 * @impact-areas hub, quality
 * @version      2026-07
 */
'use strict';

const multer = require('multer');
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');

// Réutilise la 2e ligne de défense du middleware produits (signatures binaires).
const { validateMagicBytes } = require('./upload');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'hub');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase() || '.jpg';
    const name = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, name);
  },
});

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_EXTENSIONS.has(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Format image non supporté. Utilisez JPG, PNG ou WebP.'));
  }
};

const uploadHub = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 Mo max
});

module.exports = uploadHub;
module.exports.validateMagicBytes = validateMagicBytes;
module.exports.PUBLIC_PREFIX = '/uploads/hub/';
