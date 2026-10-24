'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const script = path.resolve(__dirname, '../../scripts/pr-governance-check.js');
function validate(title, text) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kmc-pr-body-'));
  const file = path.join(folder, 'body.md');
  try {
    fs.writeFileSync(file, text);
    return cp.spawnSync(process.execPath, [script, '--title', title, '--body-file', file], {
      encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: '' },
    });
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
}
test('PR complète validée sans GitHub ni token', () => {
  expect(validate('feat: scope', '## Pourquoi\nCause\n## Quoi\nCode\n## Tests\nJest').status).toBe(0);
});
test('PR sans Quoi est refusée localement', () => {
  const result = validate('feat: scope', '## Pourquoi\nCause\n## Tests\nJest');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Quoi');
});
test('PR docs garde le contrat allégé existant', () => {
  expect(validate('docs: note', '## Pourquoi\nDocumentation').status).toBe(0);
});
