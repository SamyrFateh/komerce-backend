'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/upload.test.js
 *
 * Tests du middleware middleware/upload.js — upload images produits (multer)
 *
 * Couverture :
 *   ✓ validateMagicBytes : pas de fichier → next() immédiat
 *   ✓ validateMagicBytes : JPEG valide (FF D8 FF) → next()
 *   ✓ validateMagicBytes : PNG valide (89 50 4E 47) → next()
 *   ✓ validateMagicBytes : GIF valide (47 49 46 38) → next()
 *   ✓ validateMagicBytes : WebP valide (RIFF....WEBP) → next()
 *   ✓ validateMagicBytes : contenu non-image (ex: script renommé .jpg) → 415 + suppression fichier
 *   ✓ validateMagicBytes : fichier trop court (< 3 octets) → 415 + suppression fichier, next(err) pas appelé
 *   ✓ validateMagicBytes : erreur I/O (ex: fichier déjà supprimé) → next(err), cleanup tenté
 *   ✓ fileFilter (exposé via upload.js) : accepte extensions autorisées, rejette les autres
 *   ✓ le module exporte bien une instance multer configurée (limite 5 Mo)
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
const upload = require('../../middleware/upload');
const { validateMagicBytes } = upload;

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// Simule fs.readSync en remplissant `buf` avec les octets fournis.
function mockReadBytes(bytes) {
  fs.readSync.mockImplementationOnce((fd, buf) => {
    bytes.forEach((b, i) => { buf[i] = b; });
    return bytes.length;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  fs.openSync.mockReturnValue(3); // fake file descriptor
});

describe('validateMagicBytes — pas de fichier', () => {
  it('appelle next() immédiatement si req.file est absent', async () => {
    const req = {};
    const res = makeRes();
    const next = jest.fn();

    await validateMagicBytes(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(fs.openSync).not.toHaveBeenCalled();
  });
});

describe('validateMagicBytes — signatures valides', () => {
  it('accepte un JPEG (FF D8 FF)', async () => {
    mockReadBytes([0xFF, 0xD8, 0xFF, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const req = { file: { path: '/tmp/img.jpg' } };
    const res = makeRes();
    const next = jest.fn();

    await validateMagicBytes(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('accepte un PNG (89 50 4E 47)', async () => {
    mockReadBytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);
    const req = { file: { path: '/tmp/img.png' } };
    const res = makeRes();
    const next = jest.fn();

    await validateMagicBytes(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('accepte un GIF (47 49 46 38)', async () => {
    mockReadBytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
    const req = { file: { path: '/tmp/img.gif' } };
    const res = makeRes();
    const next = jest.fn();

    await validateMagicBytes(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('accepte un WebP (RIFF....WEBP)', async () => {
    const bytes = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WEBP', 'ascii'),
    ]);
    mockReadBytes(Array.from(bytes));
    const req = { file: { path: '/tmp/img.webp' } };
    const res = makeRes();
    const next = jest.fn();

    await validateMagicBytes(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });
});

describe('validateMagicBytes — contenu invalide', () => {
  it('rejette un fichier dont les magic bytes ne correspondent à aucun format connu (415) et le supprime', async () => {
    // ex: en-tête d'exécutable ELF renommé en .jpg
    mockReadBytes([0x7F, 0x45, 0x4C, 0x46, 0, 0, 0, 0, 0, 0, 0, 0]);
    const req = { file: { path: '/tmp/malicious.jpg' } };
    const res = makeRes();
    const next = jest.fn();

    await validateMagicBytes(req, res, next);

    expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/malicious.jpg');
    expect(res.status).toHaveBeenCalledWith(415);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Format image invalide — vérification en-tête fichier échouée (magic bytes).',
      code: 'INVALID_MAGIC_BYTES',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejette un fichier trop court (< 3 octets lus) via le catch, avec cleanup', async () => {
    mockReadBytes([0xFF]); // 1 seul octet lu
    const req = { file: { path: '/tmp/tiny.jpg' } };
    const res = makeRes();
    const next = jest.fn();

    await validateMagicBytes(req, res, next);

    expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/tiny.jpg');
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('validateMagicBytes — erreurs I/O', () => {
  it("passe l'erreur à next(err) et ferme le descripteur si fs.readSync plante", async () => {
    fs.readSync.mockImplementationOnce(() => { throw new Error('EIO: erreur disque'); });
    const req = { file: { path: '/tmp/broken.jpg' } };
    const res = makeRes();
    const next = jest.fn();

    await validateMagicBytes(req, res, next);

    expect(fs.closeSync).toHaveBeenCalledWith(3);
    expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/broken.jpg');
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('ne plante pas si le cleanup (unlinkSync) échoue lui-même (fichier déjà supprimé)', async () => {
    fs.readSync.mockImplementationOnce(() => { throw new Error('EIO'); });
    fs.unlinkSync.mockImplementationOnce(() => { throw new Error('ENOENT'); });
    const req = { file: { path: '/tmp/gone.jpg' } };
    const res = makeRes();
    const next = jest.fn();

    await expect(validateMagicBytes(req, res, next)).resolves.not.toThrow();
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('ne plante pas si fs.closeSync échoue après une erreur de lecture', async () => {
    fs.readSync.mockImplementationOnce(() => { throw new Error('EIO'); });
    fs.closeSync.mockImplementationOnce(() => { throw new Error('EBADF'); });
    const req = { file: { path: '/tmp/badfd.jpg' } };
    const res = makeRes();
    const next = jest.fn();

    await expect(validateMagicBytes(req, res, next)).resolves.not.toThrow();
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('module upload — configuration multer', () => {
  it('exporte une instance multer utilisable (avec .single/.array)', () => {
    expect(typeof upload.single).toBe('function');
    expect(typeof upload.array).toBe('function');
  });

  it('expose validateMagicBytes comme propriété du module', () => {
    expect(typeof upload.validateMagicBytes).toBe('function');
  });

  it('storage.destination redirige toujours vers UPLOAD_DIR', () => {
    const cb = jest.fn();
    capturedStorageConfig.destination({}, {}, cb);
    expect(cb).toHaveBeenCalledWith(null, expect.stringContaining(path.join('public', 'uploads', 'products')));
  });

  it('storage.filename génère un nom aléatoire en conservant l\'extension (minuscule)', () => {
    const cb = jest.fn();
    capturedStorageConfig.filename({}, { originalname: 'Photo.PNG' }, cb);

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
    it.each(['.jpg', '.jpeg', '.png', '.webp', '.gif'])('accepte l\'extension %s', (ext) => {
      const cb = jest.fn();
      capturedMulterConfig.fileFilter({}, { originalname: `image${ext}` }, cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it('rejette une extension non supportée (.svg) avec une erreur explicite', () => {
      const cb = jest.fn();
      capturedMulterConfig.fileFilter({}, { originalname: 'evil.svg' }, cb);

      expect(cb).toHaveBeenCalledWith(expect.any(Error));
      expect(cb.mock.calls[0][0].message).toMatch(/Format image non supporté/);
    });

    it("est insensible à la casse de l'extension (.JPG accepté)", () => {
      const cb = jest.fn();
      capturedMulterConfig.fileFilter({}, { originalname: 'IMAGE.JPG' }, cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });
  });

  it('limite la taille à 5 Mo (config réelle)', () => {
    expect(capturedMulterConfig.limits).toEqual({ fileSize: 5 * 1024 * 1024 });
  });
});

describe('module upload — création du dossier au chargement', () => {
  it("crée UPLOAD_DIR (mkdirSync récursif) si le dossier n'existe pas encore", () => {
    fs.existsSync.mockReturnValueOnce(false);

    jest.isolateModules(() => {
      require('../../middleware/upload');
    });

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(path.join('public', 'uploads', 'products')),
      { recursive: true }
    );
  });
});
