/**
 * @komerce-arch
 * @role          auth-upload
 * @domain        infrastructure
 * @layer         middleware
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       multer, fs, path
 * @db-write      none
 * @db-read      none
 * @used-by       middleware/upload-hub.js, routes/products.js
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  auth
 * @version       2026-11
 */

/**
 * KOMERCE — Middleware upload images produits (Vague 3)
 *
 * Améliorations Vague 3 :
 *   - validateMagicBytes : vérifie les en-têtes réels du fichier (pas juste l'extension)
 *     pour contrer les attaques d'upload avec extension renommée
 *
 * Stockage : mémoire temporaire ; les images sont transférées vers le stockage persistant.
 * Formats  : JPG, PNG, WebP, GIF · Max 5 Mo
 *
 * Les images produit restent en mémoire pendant la requête, puis sont stockées
 * dans ImageKit ; aucun chemin local n'est persisté en base.
 */

'use strict';

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const storage = multer.memoryStorage();

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
  // Les uploads produits utilisent un buffer mémoire ; les photos Hub
  // réutilisent cette validation sur leur fichier temporaire sur disque.
  const files = req.file ? [req.file] : (Array.isArray(req.files) ? req.files : []);
  if (files.length === 0) return next();

  try {
    for (const file of files) {
      let buf;
      let bytesRead;
      if (Buffer.isBuffer(file.buffer)) {
        buf = Buffer.alloc(12);
        bytesRead = file.buffer.copy(buf, 0, 0, 12);
      } else {
        buf = Buffer.alloc(12);
        const fd = fs.openSync(file.path, 'r');
        try { bytesRead = fs.readSync(fd, buf, 0, 12, 0); }
        finally { fs.closeSync(fd); }
      }

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
        if (file.path) { try { fs.unlinkSync(file.path); } catch (_) {} }
        return res.status(415).json({
          error: 'Format image invalide — vérification en-tête fichier échouée (magic bytes).',
          code:  'INVALID_MAGIC_BYTES',
        });
      }
      file.detectedMimeType = isJPEG ? 'image/jpeg' : isPNG ? 'image/png' : isGIF ? 'image/gif' : 'image/webp';
    }
    next();
  } catch (err) {
    for (const file of files) {
      if (file.path) { try { fs.unlinkSync(file.path); } catch (_) {} }
    }
    next(err);
  }
}

module.exports = upload;
module.exports.validateMagicBytes = validateMagicBytes;
