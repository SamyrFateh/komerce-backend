'use strict';

const fs = require('fs');
const path = require('path');

describe('schema pending section references', () => {
  test('every schema-pending section heading exists in SCHEMA.md', () => {
    const file = path.join(__dirname, '../../docs/SCHEMA.md');
    const md = fs.readFileSync(file, 'utf8');
    const headings = new Set(md.split('\n').filter(line => /^#{1,6}\s/.test(line)));
    const refs = [...md.matchAll(/<!--\s*schema-pending\n([\s\S]*?)-->/g)]
      .map(match => match[1].match(/^section:\s*(.+)$/m))
      .filter(Boolean)
      .map(match => match[1].trim());

    const missing = refs.filter(section => !headings.has(section));
    expect(missing).toEqual([]);
  });
});
