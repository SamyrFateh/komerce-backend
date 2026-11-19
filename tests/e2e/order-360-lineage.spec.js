/**
 * @e2e order-360-lineage.spec.js
 * @feature dashboard Order 360 — lignage canonique
 * @brief Prouve dans le navigateur qu'une commande réunit sans recalculer le client, les produits,
 *        la PO fournisseur, le colis et la position opérationnelle, avec drills contextuels.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const ORIGIN = 'http://komerce.test';
const REF = 'KOM-360-001';
const PAGE_PATH = `/admin/orders/${REF}`;

const payload = {
  order: {
    reference: REF,
    status: 'paid',
    payment: { status: 'paid', total_kmf: 125000 },
    market: { code: 'KM', name: 'Comores' },
    customer: { name: 'Amina M.', phone: '+2691234567', email: 'amina@example.test' },
    destination: { relais: { name: 'Relais Mutsamudu' }, island: 'Anjouan', routing_mode: 'relay' },
    created_at: '2026-10-08T08:00:00Z',
  },
  summary: { parcels: 1, open_incidents: 1, documents: 1 },
  control_position: {
    stage: 'CUSTOMS',
    health: 'RED',
    exceptions: [
      { code: 'customs_missing_doc', summary: 'Document douane manquant', owner_role: 'customs' },
      { code: 'customs_waiting', summary: 'Déclaration en attente', owner_role: 'customs' },
    ],
    envelope: { type: 'PARCEL', refs: ['PCL-9001'] },
  },
  items: [
    { product_ref: 'GOLDEN-ELITE-PRO', product_name: 'Golden Elite Pro', category: 'Téléphonie', quantity: 1, unit_price_kmf: 125000 },
  ],
  purchasing: {
    purchase_orders: [
      {
        id: '11111111-2222-4333-8444-555555555555',
        supplier_name: 'CJ Dropshipping',
        supplier_platform: 'CJ',
        status: 'confirmed',
        procurement_hub_ref: 'HUB-DXB-01',
        supplier_order_id: 'CJ-ORDER-42',
      },
    ],
  },
  parcels: [
    {
      reference: 'PCL-9001',
      tracking_number: 'TRK-C2C-001',
      status: 'customs',
      weight_kg: 1.4,
      items_quantity: 1,
      shipped_at: '2026-10-08T09:00:00Z',
    },
  ],
  incidents: [
    {
      type: 'customs_document',
      status: 'open',
      priority: 'high',
      description: 'Document manquant',
      reporter: 'system',
      created_at: '2026-10-08T10:00:00Z',
    },
  ],
  history: [],
  scans: [],
  notifications: [],
  invoices: [{ invoice_number: 'INV-001', payment_status: 'paid', created_at: '2026-10-08T08:05:00Z' }],
  documents: [],
  comments: [],
};

async function mount(page, {data=payload, role='admin', cancel}={}) {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (cancel && url.pathname === '/api/orders/'+REF) return route.fulfill({json:{
      id:'00000000-0000-4000-8000-000000000042', reference:REF,status:data.order.status,payment_mode:data.order.payment.mode,simulation_scope:data.order.simulation_scope
    }});
    if (cancel && url.pathname === '/api/orders/00000000-0000-4000-8000-000000000042/cancel') return cancel(route);
    if (url.pathname === PAGE_PATH) {
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head>
          <body data-admin-generation="canonical">
            <main id="canonical-admin-root"></main>
            <script>window.KOMERCE_CANONICAL_AUTH_USER={"role":"admin"};</script>
            <script src="/dashboards/canonical/js/primitives.js"></script>
            <script src="/dashboards/canonical/js/navigation-policy-v4.js"></script>
            <script src="/dashboards/canonical/js/order-360.js"></script>
          </body></html>`,
      });
    }
    if (url.pathname === `/api/admin/entities/orders/${REF}`) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    }
    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    return route.fulfill({ status: 404, body: '' });
  });

  await page.goto(`${ORIGIN}${PAGE_PATH}`);
  await page.evaluate(async role => {
    await window.KomerceCanonicalOrder360.mount({
      root: document.getElementById('canonical-admin-root'),
      document, user:{role},
      ui: window.KomerceCanonicalUI,
      fetch: window.fetch.bind(window),
      pathname: window.location.pathname,
    });
  }, role);
  await expect(page.locator('.kmc-entity-title')).toHaveText(REF);
}

test.describe('Order 360 — lignage métier', () => {
  test('réunit commande, client, produit, PO, colis et position de contrôle', async ({ page }) => {
    await mount(page);

    await expect(page.locator('.kmc-entity-subtitle')).toContainText('KM');
    // Order 360 keeps the main facts visible; drill evidence opens on demand.
    await expect(page.locator('.kmc-entity-extras')).not.toHaveAttribute('open');
    await page.locator('.kmc-entity-extras summary').click();
    await expect(page.locator('.kmc-entity-subtitle')).toContainText('Amina M.');
    await expect(page.getByRole('cell', { name: 'Golden Elite Pro' })).toBeVisible();
    await expect(page.getByText(/CJ Dropshipping · PO 11111111/)).toBeVisible();
    await expect(page.getByText('CJ-ORDER-42')).toBeVisible();
    await expect(page.getByText('TRK-C2C-001')).toBeVisible();
    await expect(page.getByText('Douane · Bloquée')).toBeVisible();
    await expect(page.getByText(/Document douane manquant — customs/)).toBeVisible();
    await expect(page.getByText(/Déclaration en attente — customs/)).toBeVisible();
    await expect(page.getByText(/PARCEL · PCL-9001/)).toBeVisible();
  });

  test('les drills conservent le retour contextuel vers la commande', async ({ page }) => {
    await mount(page);
    await page.locator('.kmc-entity-extras summary').click();

    const product = page.getByRole('link', { name: 'Product 360' });
    await expect(product).toHaveAttribute('href', /\/admin\/products\/GOLDEN-ELITE-PRO\?/);
    await expect(product).toHaveAttribute('href', /return_to=%2Fadmin%2Forders%2FKOM-360-001/);

    const purchasing = page.getByRole('link', { name: 'Ouvrir dans Achats' });
    await expect(purchasing).toHaveAttribute('href', /\/admin\/workspaces\/purchasing\?po=/);
    await expect(purchasing).toHaveAttribute('href', /return_to=%2Fadmin%2Forders%2FKOM-360-001/);

    const client = page.getByRole('link', { name: 'Client 360' });
    await expect(client).toHaveAttribute('href', /\/admin\/clients\/%2B2691234567\?/);
    await expect(client).toHaveAttribute('href', /return_to=%2Fadmin%2Forders%2FKOM-360-001/);
  });

  test('Order 360 reste une surface de compréhension sans contrôle mutant', async ({ page }) => {
    await mount(page);
    await expect(page.locator('#canonical-admin-root button')).toHaveCount(0);
    await expect(page.locator('#canonical-admin-root [data-workspace-action], #canonical-admin-root [data-admin-action]')).toHaveCount(0);
  });
});

test('admin : annuler une recette cash confirmée et relire le statut en fiche',async({page})=>{
  const data=structuredClone(payload);
  Object.assign(data.order,{status:'confirmed',simulation_scope:'G6-BUYER'});
  data.order.payment.mode='cash_relais';
  const posts=[];
  await mount(page,{data,cancel:route=>{
    posts.push(route.request().postDataJSON());
    data.order.status='cancelled';
    return route.fulfill({json:{success:true,status:'cancelled'}});
  }});
  const action=page.getByRole('button',{name:'Annuler la commande de recette'});
  page.once('dialog',dialog=>dialog.dismiss());
  await action.click();
  expect(posts).toHaveLength(0);
  page.once('dialog',dialog=>dialog.accept());
  await action.click();
  await expect(page.getByText('Commande de recette '+REF+' annulée.')).toBeVisible();
  await expect(action).toHaveCount(0);
  expect(posts).toEqual([{reason:'Annulation de recette G6 depuis Order 360 · '+REF}]);
});

test('G6-D : Order 360 ferme seulement une recette au Hub avec motif, relecture et sans PSP',async({page},info)=>{
 const data=structuredClone(payload);
 data.order.id='00000000-0000-4000-8000-000000000042';
 data.order.status='preparation';
 data.order.simulation_scope='G6-BUYER';
 data.order.payment.mode='cash_relais';
 let posts=[];
 await page.route(`${ORIGIN}/api/orders/00000000-0000-4000-8000-000000000042/close-g6-hub-recipe`,async route=>{
   posts.push(route.request().postDataJSON());
   data.order.status='cancelled';
   await route.fulfill({json:{status:'cancelled',psp_refund:false}});
 });
 await mount(page,{data,cancel:route=>route.fulfill({status:409,json:{error:'Interdit'}})});
 const button=page.locator('[data-order360-g6-hub-close]');
 await expect(button).toBeVisible();
 if(info.repeatEachIndex===0){fs.mkdirSync('test-artifacts/g6-hub',{recursive:true});await page.screenshot({path:'test-artifacts/g6-hub/avant.png',fullPage:true});}
 page.on('dialog',async d=>d.accept(d.type()==='prompt'?'Fin de recette G6':undefined));
 await button.click();
 // La confirmation est une deuxième boîte : Playwright accepte automatiquement
 // les confirmations si aucun handler n'est installé.
  console.log('G6-D diagnostic',JSON.stringify({posts,root:await page.locator('#canonical-admin-root').innerText()}));
 await expect(page.getByText('Commande de recette '+REF+' clôturée au Hub.')).toBeVisible();
 expect(posts).toEqual([{reason:'Fin de recette G6'}]);
 if(info.repeatEachIndex===0)await page.screenshot({path:'test-artifacts/g6-hub/apres.png',fullPage:true});
});
test('G6-D : aucune action sur commande hors simulation G6',async({page})=>{
 const data=structuredClone(payload);
 Object.assign(data.order,{status:'preparation',simulation_scope:null});
 await mount(page,{data});
 await expect(page.locator('[data-order360-g6-hub-close]')).toHaveCount(0);
});
