'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/upload-hub.test.js
 *
 * Tests du middleware middleware/upload-hub.js — upload photos scan hub Dubaï (multer)
 *
 * Ce middleware réutilise validateMagicBytes depuis middleware/upload.js (déjà
 * testé en détail dans upload.test.js). On ne re-teste donc pas ici chaque
 * branche de validateMagicBytes, seulement :
 *   ✓ le module réexporte bien la même fonction validateMagicBytes (référence identique)
 *   ✓ la configuration multer propre à upload-hub : storage, filename, fileFilter, limits
 *   ✓ le dossier cible est bien public/uploads/hub (et non products)
 *   ✓ les extensions autorisées sont JPG/PNG/WebP (PAS de GIF, contrairement à upload.js)
 *   ✓ PUBLIC_PREFIX exposé et correct
 *   ✓ création du dossier au chargement si absent
 */

const path = require('path');

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  openSync: jest.fn(),
  readSync: jest.fn(),
  closeSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

let capturedStorageConfig = null;
let capturedMulterConfig = null;
jest.mock('multer', () => {
  const actualMulter = jest.requireActual('multer');
  const mockMulter = (config) => {
    capturedMulterConfig = config;
    return actualMulter(config);
  };
  mockMulter.diskStorage = (storageConfig) => {
    capturedStorageConfig = storageConfig;
    return actualMulter.diskStorage(storageConfig);
  };
  return mockMulter;
});

const fs = require('fs');
const uploadHub = require('../../middleware/upload-hub');
const upload = require('../../middleware/upload');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('module upload-hub — réutilisation de validateMagicBytes', () => {
  it('réexporte exactement la même fonction validateMagicBytes que middleware/upload.js', () => {
    expect(uploadHub.validateMagicBytes).toBe(upload.validateMagicBytes);
  });

  it('expose validateMagicBytes comme une fonction', () => {
    expect(typeof uploadHub.validateMagicBytes).toBe('function');
  });
});

describe('module upload-hub — configuration multer', () => {
  it('exporte une instance multer utilisable (avec .single/.array)', () => {
    expect(typeof uploadHub.single).toBe('function');
    expect(typeof uploadHub.array).toBe('function');
  });

  it('storage.destination redirige toujours vers public/uploads/hub', () => {
    const cb = jest.fn();
    capturedStorageConfig.destination({}, {}, cb);
    expect(cb).toHaveBeenCalledWith(null, expect.stringContaining(path.join('public', 'uploads', 'hub')));
  });

  it('storage.filename génère un nom aléatoire en conservant l\'extension (minuscule)', () => {
    const cb = jest.fn();
    capturedStorageConfig.filename({}, { originalname: 'Scan.PNG' }, cb);

    expect(cb).toHaveBeenCalledTimes(1);
    const [err, name] = cb.mock.calls[0];
    expect(err).toBeNull();
    expect(name).toMatch(/^[0-9a-f]{32}\.png$/);
  });

  it("storage.filename retombe sur .jpg si le fichier n'a pas d'extension", () => {
    const cb = jest.fn();
    capturedStorageConfig.filename({}, { originalname: 'noextension' }, cb);

    const [, name] = cb.mock.calls[0];
    expect(name).toMatch(/^[0-9a-f]{32}\.jpg$/);
  });

  describe('fileFilter (config réelle capturée depuis multer())', () => {
    it.each(['.jpg', '.jpeg', '.png', '.webp'])("accepte l'extension %s", (ext) => {
      const cb = jest.fn();
      capturedMulterConfig.fileFilter({}, { originalname: `scan${ext}` }, cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it('rejette le GIF, contrairement à middleware/upload.js', () => {
      const cb = jest.fn();
      capturedMulterConfig.fileFilter({}, { originalname: 'scan.gif' }, cb);

      expect(cb).toHaveBeenCalledWith(expect.any(Error));
      expect(cb.mock.calls[0][0].message).toMatch(/JPG, PNG ou WebP/);
    });

    it('rejette une extension non supportée (.svg) avec une erreur explicite', () => {
      const cb = jest.fn();
      capturedMulterConfig.fileFilter({}, { originalname: 'evil.svg' }, cb);

      expect(cb).toHaveBeenCalledWith(expect.any(Error));
      expect(cb.mock.calls[0][0].message).toMatch(/Format image non supporté/);
    });

    it("est insensible à la casse de l'extension (.JPG accepté)", () => {
      const cb = jest.fn();
      capturedMulterConfig.fileFilter({}, { originalname: 'SCAN.JPG' }, cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });
  });

  it('limite la taille à 5 Mo (config réelle)', () => {
    expect(capturedMulterConfig.limits).toEqual({ fileSize: 5 * 1024 * 1024 });
  });
});

describe('module upload-hub — PUBLIC_PREFIX', () => {
  it('expose le préfixe public correct pour construire les URLs de photo', () => {
    expect(uploadHub.PUBLIC_PREFIX).toBe('/uploads/hub/');
  });
});

describe('module upload-hub — création du dossier au chargement', () => {
  it("crée UPLOAD_DIR (mkdirSync récursif) si le dossier n'existe pas encore", () => {
    // false pour tous les appels : upload-hub.js require ./upload en interne,
    // donc jest.isolateModules recharge aussi upload.js (qui fait son propre
    // mkdirSync('products') au chargement) avant d'arriver à upload-hub lui-même.
    fs.existsSync.mockReturnValue(false);

    jest.isolateModules(() => {
      require('../../middleware/upload-hub');
    });

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(path.join('public', 'uploads', 'hub')),
      { recursive: true }
    );
  });
});
