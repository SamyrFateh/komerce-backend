'use strict';

const fs = require('fs');
const path = require('path');

const doc = fs.readFileSync(path.join(__dirname, '../../docs/CJ_CONNECTOR.md'), 'utf8');

describe('CJ connector documentation contract', () => {
  it('documente les secrets serveur et la traçabilité fournisseur', () => {
    expect(doc).toContain('CJ_API_KEY');
    expect(doc).toContain('CJ_ACCESS_TOKEN');
    expect(doc).toContain('raw_payload.cj');
    expect(doc).toContain('source_locale=en');
    expect(doc).toContain('Do not treat CJ images as a generic stock-photo library');
  });
});
