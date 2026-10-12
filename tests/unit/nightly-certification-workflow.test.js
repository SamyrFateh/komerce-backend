'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
/**
 * Garde du workflow de certification nocturne (lot S1) : il doit rester éphémère, isolé et honnête
 * sur son niveau de preuve. Une régression ici ferait toucher un staging partagé, un secret ou un
 * fournisseur depuis un cron.
 */
const fs = require('fs');
const path = require('path');

const yml = fs.readFileSync(path.join(__dirname, '../../.github/workflows/nightly-e2e-certification.yml'), 'utf8');
const code = yml.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

describe('nightly-e2e-certification.yml', () => {
  test('déclenché par cron et manuellement, sans écriture sur le dépôt', () => {
    expect(code).toMatch(/schedule:\s*\n\s*- cron:/);
    expect(code).toMatch(/workflow_dispatch:/);
    expect(code).toMatch(/permissions:\s*\n\s*contents: read/);
    expect(code).not.toMatch(/contents: write/);
  });

  test('aucun secret ni cible partagée : environnement éphémère local uniquement', () => {
    expect(code).not.toMatch(/secrets\./);
    expect(code).not.toMatch(/railway\.app/i);
    expect(code).not.toMatch(/https?:\/\/(?!localhost)(?!github\.com)/i);
    expect(code).toMatch(/DATABASE_URL: postgresql:\/\/komerce:komerce@localhost:5432\/komerce_test/);
    expect(code).toMatch(/E2E_BASE_URL=http:\/\/localhost:3911/);
    expect(code).not.toMatch(/E2E_CASH_TARGET_CONFIRMED|E2E_CASH_DB_HOST_CONFIRMED/);
  });

  test('effets externes neutralisés : crons coupés, clés fournisseurs placeholders', () => {
    expect(code).toMatch(/KOMERCE_DISABLE_CRONS: 'true'/);
    for (const key of ['STRIPE_SECRET_KEY', 'PAYPAL_CLIENT_SECRET', 'AUTHKEY_API_KEY', 'META_WA_APP_SECRET']) {
      expect(code).toMatch(new RegExp(`${key}: \\S*(ci|placeholder)`));
    }
  });

  test('le limiteur de connexion n’est désactivé que sur le serveur éphémère local, et les rapports sont archivés', () => {
    expect(code).toMatch(/DISABLE_RATE_LIMIT=1 ADMIN_PASSWORD="\$pw" node server\.js/);
    expect(code.match(/DISABLE_RATE_LIMIT/g)).toHaveLength(1);
    expect(code).toMatch(/test-results\/cash-e2e/);
    expect(code).toMatch(/test-results\/dashboard-truth/);
  });

  test('admin éphémère : mot de passe aléatoire masqué, injecté au boot du serveur et à la recette', () => {
    expect(code).toMatch(/openssl rand -hex/);
    expect(code).toMatch(/::add-mask::\$pw/);
    expect(code).toMatch(/ADMIN_PASSWORD="\$pw" node server\.js/);
    expect(code).toMatch(/E2E_ADMIN_PASSWORD="\$pw"/);
  });

  test('exécute les trois preuves complètes et archive même en cas d’échec partiel', () => {
    expect(code).toContain('npm run test:integration');
    expect(code).toContain('npm run test:e2e:features');
    expect(code).toContain('npm run test:e2e:cash');
    expect(code).toMatch(/upload-artifact@v4/);
    expect(code.match(/if: \$\{\{ !cancelled\(\) \}\}/g).length).toBeGreaterThanOrEqual(4);
  });

  test('annonce explicitement son niveau de preuve et ses limites', () => {
    expect(yml).toMatch(/L5 local intégré/);
    expect(yml).toMatch(/Non prouvé ici : staging déployé, sandbox fournisseur/);
  });
});
