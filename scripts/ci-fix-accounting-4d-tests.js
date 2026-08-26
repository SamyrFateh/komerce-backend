'use strict';

const fs = require('fs');

function mustReplace(path, oldText, newText, label) {
  const source = fs.readFileSync(path, 'utf8');
  if (!source.includes(oldText)) throw new Error(`Missing test anchor: ${label}`);
  fs.writeFileSync(path, source.replace(oldText, newText));
}

mustReplace(
  'tests/unit/bootstrap-html-routes.test.js',
  `    test('chaque chemin admin sert dashboards/admin/index.html', () => {\n      const res = fakeRes();\n      app._routes['/admin/pilotage']({}, res);\n      expect(res.sendFile).toHaveBeenCalledWith(\n        require('path').join(PUBLIC_DIR, 'dashboards', 'admin', 'index.html'),\n        expect.any(Function)\n      );\n    });`,
  `    test('/admin/pilotage sert désormais le runtime Canonical stable', () => {\n      const res = fakeRes();\n      app._routes['/admin/pilotage']({}, res);\n      expect(res.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'canonical');\n      expect(res.sendFile).toHaveBeenCalledWith(\n        require('path').join(PUBLIC_DIR, 'dashboards', 'canonical', 'index.html'),\n        expect.any(Function)\n      );\n    });`,
  'bootstrap canonical pilotage witness'
);

mustReplace(
  'tests/unit/canonical-finance-accounting-workspace-boundary.test.js',
  `  expect(source).not.toContain('agent_id');\n  expect(source).not.toContain('market_id');`,
  `  const executable = source\n    .replace(/\\/\\*[\\s\\S]*?\\*\\//g, '')\n    .replace(/\\/\\/.*$/gm, '');\n  expect(executable).not.toContain('agent_id');\n  expect(executable).not.toContain('market_id');\n  expect(executable).not.toMatch(/[?&]market_id=/);`,
  'accounting browser authority witness'
);

console.log('LOT 4D test witnesses aligned with current canonical truth');
