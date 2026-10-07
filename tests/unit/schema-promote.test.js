'use strict';

const { insertRowUnderSection } = require('../../scripts/schema-promote');

describe('schema-promote empty section bootstrap', () => {
  test('creates a two-column table when the target section has none', () => {
    const md = [
      '# Schema',
      '',
      '### Empty',
      '',
      '<!-- schema-pending -->',
      '',
      '---',
      '',
      '### Next',
      '',
    ].join('\n');

    const row = '| `outbox_events` | Primitive outbox transactionnelle. |';
    const promoted = insertRowUnderSection(md, '### Empty', row);

    expect(promoted).toContain(
      '### Empty\n\n| Objet | Rôle |\n|---|---|\n| `outbox_events` | Primitive outbox transactionnelle. |'
    );
    expect(promoted.indexOf(row)).toBeLessThan(promoted.indexOf('### Next'));
  });

  test('creates a three-column table for rows with consumers', () => {
    const md = ['## Views', '', '## Next'].join('\n');
    const row = '| `v_example` | Example view. | Dashboard |';
    const promoted = insertRowUnderSection(md, '## Views', row);

    expect(promoted).toContain(
      '| Objet | Rôle | Consommé par |\n|---|---|---|\n| `v_example` | Example view. | Dashboard |'
    );
  });

  test('still fails loudly when the target heading does not exist', () => {
    expect(() => insertRowUnderSection('# Schema\n', '### Missing', '| `x` | y |'))
      .toThrow('Heading introuvable');
  });
});
