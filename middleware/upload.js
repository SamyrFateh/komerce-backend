/**
 * @komerce-arch
 * @role          auth-upload
 * @domain        infrastructure
 * @layer         middleware
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @db-write      @unknown
 * @db-read      @unknown
 * @used-by       @unknown
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  auth
 * @version       2026-06
 */

/**
 * KOMERCE — Middleware upload images produits (Vague 3)
 *
 * Améliorations Vague 3 :
 *   - validateMagicBytes : vérifie les en-têtes réels du fichier (pas juste l'extension)
 *     pour contrer les attaques d'upload avec extension renommée
 *
 * Stockage : public/uploads/products/  (filesystem local — éphémère sur Railway)
 * Formats  : JPG, PNG, WebP, GIF · Max 5 Mo
 *
 * ⚠️ Railway : le filesystem est éphémère. Les images uploadées
 * survivent aux restarts mais PAS aux redéploiements.
 * TODO #387 : Migrer vers un stockage objet persistant avant la prod.
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
    const ext  = path.extname(file.originalname).toLowerCase() || '.jpg';
    const name = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, name);
  },
});

// ── Filtre par extension (première ligne de défense) ────────────────────────────
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_EXTENSIONS.has(ext)) {
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

// ── Validation magic bytes (deuxième ligne de défense) ─────────────────────────
//
// Après que multer a écrit le fichier sur le disque, on lit les premiers octets
// pour vérifier que le contenu correspond bien à une image réelle,
// pas un script PHP ou exécutable renommé en .jpg.
//
// Signatures reconnues :
//   JPEG  : FF D8 FF
//   PNG   : 89 50 4E 47 0D 0A 1A 0A
//   GIF   : 47 49 46 38 (GIF8)
//   WebP  : 52 49 46 46 xx xx xx xx 57 45 42 50 (RIFF....WEBP)

async function validateMagicBytes(req, res, next) {
  // Pas de fichier uploadé → rien à valider
  if (!req.file) return next();

  let fd;
  try {
    const buf = Buffer.alloc(12);
    fd = fs.openSync(req.file.path, 'r');
    const bytesRead = fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    fd = null;

    if (bytesRead < 3) {
      throw new Error('Fichier trop court pour être une image valide (magic bytes).');
    }

    const isJPEG = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
    const isPNG  = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
    const isGIF  = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38;
    const isWebP = buf.slice(0, 4).toString('ascii') === 'RIFF' &&
                   bytesRead >= 12 &&
                   buf.slice(8, 12).toString('ascii') === 'WEBP';

    if (!isJPEG && !isPNG && !isGIF && !isWebP) {
      // Supprimer le fichier invalide
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(415).json({
        error: 'Format image invalide — vérification en-tête fichier échouée (magic bytes).',
        code:  'INVALID_MAGIC_BYTES',
      });
    }

    next();
  } catch (err) {
    if (fd != null) { try { fs.closeSync(fd); } catch (_) {} }
    // Nettoyer le fichier en cas d'erreur I/O
    if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch (_) {} }
    next(err);
  }
}

module.exports = upload;
module.exports.validateMagicBytes = validateMagicBytes;
