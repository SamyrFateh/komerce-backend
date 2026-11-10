/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires none
 * @komerce-arch-lite
 * @role g2-hub-po-actual-dom-clicks-with-controlled-ephemeral-data
 * @domain dashboard
 * @layer e2e
 * @purpose Genuine Chromium DOM clicks on canonical Hub cockpit for purchase
 *          authorizations, supplier submission and confirmation.
 *          No server, no remote DB, no credentials, no HTTP mutation.
 * @impact-areas hub, purchasing, security, dashboard, test-only
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const SCRIPT = fs.readFileSync(
  path.join(__dirname, '../../public/dashboards/canonical/js/hub-live-cockpit.js'), 'utf8');
const OUT = path.resolve('test-results/g2-hub-po-chromium-isolated');
const PO_ID = '00000000-0000-4000-8000-000000000042';
const LINE_ID = '00000000-0000-4000-8000-000000000043';

test.use({ screenshot: 'off', trace: 'off', video: 'off' });

async function cockpit(page, { step = 'draft', status = 'draft',
  commitment = false, payment = false, director = false, need = false, readOnly = false,
  sentAt = null } = {}) {
  // Network-deny is deliberate. These are actual Chromium UI clicks, NOT backend
  // transaction clicks; no synthetic response can be mistaken for HTTP/PG proof.
  const attempted = [];
  await page.route('**/*', route => {
    attempted.push(route.request().method() + ' ' + route.request().url());
    return route.abort('blockedbyclient');
  });
  await page.goto('about:blank');
  await page.setContent('<!doctype html><html lang="fr"><body><main id="workplace"></main></body></html>');
  await page.addScriptTag({ content: SCRIPT });
  await page.evaluate(({ poId, lineId, step, status, commitment, payment,
    director, need, readOnly, sentAt }) => {
    const line = { line_id: lineId, order_id: 'ORDER-ISOLATED', order_ref: 'G2-ISOLATED',
      product: 'Produit de recette hors ligne', ordered: 2, confirmed: 2,
      received: 0, missing: 2, fifo_rank: 1, fifo_next: true };
    const po = {
      id: poId, ref: 'PO-G2-ISOLATED', supplier_name: 'Fournisseur fictif CI',
      status, status_view: { label: status, tone: 'wait' },
      step: { key: step, index: ['draft','validation','engaged','sent','received'].indexOf(step) + 1, partial: false },
      lines: [line], order_ids: [], totals: { effective: 2, received: 0, missing: 2 },
      authorizations: { commitment, payment }, amount: { derived: true, amount: 2000, currency: 'KMF' },
      sent_at: sentAt,
    };
    const dossier = {
      market: { code: 'KM' }, orders: [], purchase_orders: need ? [] : [po],
      bags_open: [], bags_ready: [], boxes: [], open_shipments: [],
      cockpit: {
        viewer: { role: 'agent_hub', can_authorize_commitment: director, can_authorize_payment: director },
        todo: [], physical: [], unit_legend: [],
        po_steps: ['draft', 'validation', 'engaged', 'sent', 'received'],
        need_batches: need ? [{
          key:'BATCH-G2', supplier_name:'Fournisseur fictif CI',supplier_id:'SUP-G2',
          procurement_hub_ref:'DUBAI-G2', compatible_draft_po_ids:[],
          groups:[{ key:'NEED-G2',product: 'Produit de recette hors ligne',quantity: 2,
            lines:[{ line_id: lineId, order_id:'ORDER-ISOLATED',order_ref:'G2-ISOLATED',quantity:2 }] }],
        }] : [],
      },
    };
    window.__g2 = { calls: [], outbound: 0, dossier, state: {} };
    window.fetch = () => { window.__g2.outbound++; throw Error('G2_NO_NETWORK_ALLOWED'); };
    window.XMLHttpRequest = class { open() { window.__g2.outbound++; throw Error('G2_NO_NETWORK_ALLOWED'); } };
    const ctx = {
      document, dossier, state: window.__g2.state, marketCode: 'KM', isReadOnly: readOnly,
      endpoint: p => '/api/admin/workspaces/operations/market/KM/' + p,
      act: async (_, action) => {
        // This is a controlled capture of the *real click's* action specification,
        // not an HTTP request and not a successful backend mutation.
        window.__g2.calls.push({ route: action.url, body: action.body, type: 'CAPTURED_ONLY' });
        return null;
      },
      feedback() {}, async reload() {}, openPhysical() {}, openSourcing() {},
      renderReception() { return null; },
    };
    window.__g2.render = () => window.KomerceHubLiveCockpit.render(
      document.getElementById('workplace'), ctx);
    window.__g2.render();
  }, { poId: PO_ID, lineId: LINE_ID, step, status, commitment, payment, director,
    need, readOnly, sentAt });
  return attempted;
}

async function capture(page, key, expectedRoute, expectedBody = null) {
  const result = await page.evaluate(() => ({
    calls: window.__g2.calls, outbound: window.__g2.outbound,
    selected: document.querySelector('[data-hub-cockpit]')?.getAttribute('data-hlc-selection'),
  }));
  expect(result.outbound).toBe(0);
  expect(result.calls).toHaveLength(1);
  expect(result.calls[0]).toMatchObject({ route: expectedRoute, type: 'CAPTURED_ONLY' });
  if (expectedBody) expect(result.calls[0].body).toMatchObject(expectedBody);
  fs.mkdirSync(OUT, { recursive: true });
  const report = { schema:'g2-hub-po-controlled-chromium/1', name:key,
    browser:'chromium', data:'CONTROLLED_ISOLATED_IN_MEMORY',
    network:'DENIED', staging:'NOT_CONTACTED', credentials:'NONE',
    server_write:'NONE', verdict:'UI_CLICK_CAPTURE_ONLY',
    action: result.calls[0] };
  fs.writeFileSync(path.join(OUT, key + '.json'), JSON.stringify(report, null, 2) + '\n');
  await page.screenshot({ path:path.join(OUT,key+'.png'), fullPage:true });
  return result;
}

test('01 - preparation de la PO par clic sur un besoin, bonne ligne et bon fournisseur', async ({page}) => {
  const attempted = await cockpit(page, {need:true});
  await page.locator('[data-hlc-need="NEED-G2"]').click();
  const button=page.locator('[data-hlc-action="prepare-po"]');
  await expect(button).toBeEnabled();
  await button.click();
  await capture(page,'01-prepare',
    '/api/purchasing/po/prepare',
    { supplier_id:'SUP-G2', procurement_hub_ref:'DUBAI-G2',line_ids:[LINE_ID] });
  expect(attempted).toEqual([]);
});

test('02 - engagement: agent Hub refuse, directrice ouvre formulaire et justificatif requis', async ({page}) => {
  await cockpit(page, {step:'draft'});
  await page.locator('[data-hlc-po]').click();
  const forbidden = page.locator('[data-hlc-action="authorize-commitment"]');
  await expect(forbidden).toBeDisabled();
  await expect(forbidden.locator('..')).toContainText('réservé à la responsable Hub');
  expect(await page.evaluate(() => window.__g2.calls)).toEqual([]);

  const attempted=await cockpit(page,{step:'draft',director:true});
  await page.locator('[data-hlc-po]').click();
  await page.locator('[data-hlc-action="authorize-commitment"]').click();
  const form=page.locator('form[data-hlc-form="commitment"]');
  await expect(form).toBeVisible();
  await form.locator('button[type=submit]').click();
  await expect(form).toContainText('La pièce justificative est obligatoire');
  expect(await page.evaluate(() => window.__g2.calls)).toEqual([]);
  await form.locator('input[name=proof_ref]').fill('G2-EPHEMERAL-PROOF');
  await form.locator('button[type=submit]').click();
  await capture(page,'02-commitment',
    '/api/purchasing/po/'+PO_ID+'/authorize-commitment',{proof_ref:'G2-EPHEMERAL-PROOF'});
  expect(attempted).toEqual([]);
});

test('03 - soumission PO apres engagement: vrai bouton et bonne route', async ({page}) => {
  const attempted=await cockpit(page,{step:'validation',status:'draft',commitment:true});
  await page.locator('[data-hlc-po]').click();
  await expect(page.locator('[data-hlc-action="submit-po"]')).toBeEnabled();
  await page.locator('[data-hlc-action="submit-po"]').click();
  await capture(page,'03-submit','/api/purchasing/po/'+PO_ID+'/submit');
  expect(attempted).toEqual([]);
});

test('04 - envoi fournisseur avec canal et reference, sans requete externe', async ({page}) => {
  const attempted=await cockpit(page,{step:'engaged',status:'submitted',commitment:true});
  await page.locator('[data-hlc-po]').click();
  await page.locator('[data-hlc-action="record-sent"]').click();
  const form=page.locator('form[data-hlc-form="sent"]');
  await expect(form).toBeVisible();
  await form.locator('select').selectOption('email');
  await form.locator('input[name=supplier_order_id]').fill('G2-CI-SUPPLIER-001');
  await form.locator('button[type=submit]').click();
  await capture(page,'04-sent','/api/purchasing/po/'+PO_ID+'/sent',
    {channel:'email',supplier_order_id:'G2-CI-SUPPLIER-001'});
  expect(attempted).toEqual([]);
});

test('05 - confirmation fournisseur avec quantites et preuve obligatoire', async ({page}) => {
  const attempted=await cockpit(page,{step:'sent',status:'notified',commitment:true,sentAt:'2026-11-10T00:00:00Z'});
  await page.locator('[data-hlc-po]').click();
  await page.locator('[data-hlc-action="confirm-po"]').click();
  const form=page.locator('form[data-hlc-form="confirm"]');
  await expect(form).toBeVisible();
  await form.locator('button[type=submit]').click();
  await expect(form).toContainText('Justificatif d’achat obligatoire');
  expect(await page.evaluate(() => window.__g2.calls)).toEqual([]);
  await form.locator('input[name=purchase_proof_ref]').fill('CI-FOURNISSEUR-OK');
  await form.locator('button[type=submit]').click();
  await capture(page,'05-confirm','/api/purchasing/po/'+PO_ID+'/confirm',
    {lines:[{purchase_line_id:LINE_ID,confirmed_quantity:2}],purchase_proof_ref:'CI-FOURNISSEUR-OK'});
  expect(attempted).toEqual([]);
});

test('06 - paiement fournisseur: agent ordinaire refuse, directrice autorisee via formulaire distinct', async ({page}) => {
  await cockpit(page,{step:'engaged',status:'submitted',commitment:true,director:false});
  await page.locator('[data-hlc-po]').click();
  const payment=page.locator('[data-hlc-action="authorize-payment"]');
  await expect(payment).toBeDisabled();
  await expect(payment.locator('..')).toContainText('réservé à la responsable Hub');

  const attempted=await cockpit(page,{step:'engaged',status:'submitted',commitment:true,director:true});
  await page.locator('[data-hlc-po]').click();
  await page.locator('[data-hlc-action="authorize-payment"]').click();
  const form=page.locator('form[data-hlc-form="payment"]');
  await expect(form).toBeVisible();
  await form.locator('input[name=proof_ref]').fill('PAIEMENT-AUTORISATION-G2');
  await form.locator('button[type=submit]').click();
  await capture(page,'06-payment',
    '/api/purchasing/po/'+PO_ID+'/authorize-payment',
    {proof_ref:'PAIEMENT-AUTORISATION-G2',amount:2000,currency:'KMF'});
  expect(attempted).toEqual([]);
});

test('07 - mode lecture seule: aucune commande mutable et aucun formulaire possible', async ({page}) => {
  const attempted=await cockpit(page,{step:'draft',director:true,readOnly:true});
  await page.locator('[data-hlc-po]').click();
  await expect(page.locator('[data-hlc-action="authorize-commitment"]')).toBeDisabled();
  await expect(page.locator('[data-hlc-action="authorize-payment"]')).toBeDisabled();
  expect(await page.locator('form[data-hlc-form]').count()).toBe(0);
  expect(await page.evaluate(() => window.__g2.calls)).toEqual([]);
  expect(attempted).toEqual([]);
});
