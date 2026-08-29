/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const EXPECTED = [
  ['cat-all-v3.webp', 30424, '7d4196d0d606b3191cd7dfc7eb784f3c1863c5295b57a93935acc62720314225'],
  ['cat-soldes-v3.webp', 19138, '2efcd5d64bbbd858060c971a3cd8ded4cb092cec29284079163ff8152492edf3'],
  ['cat-mode-v3.webp', 20206, '28f61b54c0d0e76adbb9428902c63d63dfb33726b2af544c5efe8e36871d5a83'],
  ['cat-maison-v3.webp', 13958, '5a09f59919265a7e2d4a3e76bf9df6e9622b5dd3761d7232c11e7b94261976f1'],
  ['cat-tech-v3.webp', 7948, 'd713fe859d3162a1a6fb89ceeebf737a65ae64566ab797f7db2e988bed6ca08a'],
  ['cat-bricolage-v3.webp', 13502, '50ca0d830d8f82f6e43ca76352d97af47f223445c08ac0dd1e95c066d63b5bd0'],
  ['cat-perso-v3.webp', 35932, 'e51ea36f3d5c99d97785bce97b552506d0a9883dd2aecf62599fec626ac39a0d'],
  ['cat-auto-v3.webp', 25554, 'd6d8ebadb70bd1df6ec5d26a6407d1e8ebb145bd10e0439799e8b83468d757c1'],
];

function vp8xDimensions(buf) {
  expect(buf.subarray(0, 4).toString('ascii')).toBe('RIFF');
  expect(buf.subarray(8, 12).toString('ascii')).toBe('WEBP');
  expect(buf.subarray(12, 16).toString('ascii')).toBe('VP8X');
  return {
    width: 1 + buf.readUIntLE(24, 3),
    height: 1 + buf.readUIntLE(27, 3),
  };
}

describe('Komerce category cutout binary integrity', () => {
  for (const [file, bytes, sha256] of EXPECTED) {
    it(`keeps ${file} as a transparent 512px cutout`, () => {
      const buf = fs.readFileSync(path.join(ROOT, 'categories', file));
      expect(buf.length).toBe(bytes);
      expect(crypto.createHash('sha256').update(buf).digest('hex')).toBe(sha256);
      expect(buf.readUInt32LE(4) + 8).toBe(buf.length);
      expect(vp8xDimensions(buf)).toEqual({ width: 512, height: 512 });
      expect(buf[20] & 0x10).toBe(0x10);
    });
  }
});
