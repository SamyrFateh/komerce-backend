'use strict';

/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires none
 *
 * Responsable Marché desktop — une équipe volumineuse reste complète mais ne
 * transforme pas Autonomie marché en page interminable.
 */
const path = require('path');
const { test, expect } = require('@playwright/test');

const SCRIPT = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'market-team.js');

test('30 membres restent accessibles avec 12 cartes initiales, recherche et affichage progressif', async ({ page }) => {
  const calls = [];
  const members = Array.from({ length: 30 }, (_, index) => ({
    membership_id: `membership-${index}`,
    status: 'ACTIVE',
    full_name: `Collaborateur ${String(index + 1).padStart(2, '0')}`,
    email: `collaborateur${index + 1}@example.test`,
    capabilities: ['dashboard.market.read', 'team.read'],
  }));

  await page.route('http://localhost/blank', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.route('**/api/**', route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    calls.push({ method: request.method(), pathname });
    if (pathname === '/api/admin/dashboard/context') {
      return route.fulfill({ json: { actor:{id:'op',role:'market_operator'}, access: { mode:'market', allowedMarkets: ['CM'], defaultMarket: 'CM', capabilities: [], delegatedCapabilities:{CM:['finance.read','operations.read','team.read']} } } });
    }
    if (pathname === '/api/market-delegation/markets/CM/team') {
      return route.fulfill({ json: {
        market: { code: 'CM', name: 'Cameroun' },
        actor_membership_id: 'membership-0',
        actor_capabilities: ['team.read'],
        actor_grantable_capabilities: [],
        members,
        invitations: [],
      } });
    }
    return route.fulfill({ status: 404, json: { error: 'inconnu' } });
  });

  await page.goto('http://localhost/blank');
  await page.setContent('<main id="market-autonomy-root" class="kmc-workspace"></main>');
  await page.addScriptTag({ path: path.join(path.dirname(SCRIPT),'admin-context.js') });
  await page.addScriptTag({ path: SCRIPT });

  const cards = page.locator('[data-member-card]');
  await expect(cards).toHaveCount(30);
  await expect(page.locator('[data-member-card]:visible')).toHaveCount(12);
  await expect(page.getByText('12 sur 30 membres affichés')).toBeVisible();
  await expect(page.getByText('Collaborateur 01')).toBeVisible();
  await expect(page.getByText('Collaborateur 30')).not.toBeVisible();

  await page.getByRole('button', { name: 'Afficher 12 de plus' }).click();
  await expect(page.locator('[data-member-card]:visible')).toHaveCount(24);
  await expect(page.getByText('24 sur 30 membres affichés')).toBeVisible();

  await page.getByRole('searchbox', { name: 'Rechercher un membre' }).fill('collaborateur30@');
  await expect(page.locator('[data-member-card]:visible')).toHaveCount(1);
  await expect(page.getByText('1 sur 1 membres affichés')).toBeVisible();
  await expect(page.getByText('Collaborateur 30')).toBeVisible();

  const visibleCard = page.locator('[data-member-card]:visible');
  await expect(visibleCard.getByText('Voir les 2 droits')).toBeVisible();
  await expect(visibleCard.getByText('Lire le dashboard pays')).not.toBeVisible();
  expect(calls.every(call => call.method === 'GET')).toBe(true);
});
