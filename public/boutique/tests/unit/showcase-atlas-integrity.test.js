'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const EXPECTED = [
  {
    file: 'categories/komerce-showcase-v1-main.webp',
    bytes: 6262,
    sha256: '8a7797d755f6e7e9e66d97eed661bbc0f5dceac7550daa92bdf2aac8bdba56c7',
    width: 144,
    height: 96,
  },
  {
    file: 'categories/komerce-showcase-v1-mode.webp',
    bytes: 11626,
    sha256: '5342618696fbdc8bf17dda4a4f1d10adec1387ead3111f161eb8d255dee60237',
    width: 192,
    height: 128,
  },
];

function vp8xDimensions(buf) {
  expect(buf.subarray(0, 4).toString('ascii')).toBe('RIFF');
  expect(buf.subarray(8, 12).toString('ascii')).toBe('WEBP');
  expect(buf.subarray(12, 16).toString('ascii')).toBe('VP8X');
  const width = 1 + buf.readUIntLE(24, 3);
  const height = 1 + buf.readUIntLE(27, 3);
  return { width, height };
}

describe('Komerce showcase atlas binary integrity', () => {
  for (const expected of EXPECTED) {
    it(`keeps ${expected.file} as the validated decodable asset`, () => {
      const buf = fs.readFileSync(path.join(ROOT, expected.file));
      expect(buf.length).toBe(expected.bytes);
      expect(crypto.createHash('sha256').update(buf).digest('hex')).toBe(expected.sha256);
      expect(buf.readUInt32LE(4) + 8).toBe(buf.length);
      expect(vp8xDimensions(buf)).toEqual({
        width: expected.width,
        height: expected.height,
      });
    });
  }
});
