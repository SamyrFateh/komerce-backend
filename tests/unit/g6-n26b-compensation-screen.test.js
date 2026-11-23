/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @brief N26b discoverability, admin boundary, proposal-before-decision contract and G6 browser/PG proof wiring.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const stage = fs.readFileSync(path.resolve('scripts/recette/g6-negative-n25-sav-chromium.js'), 'utf8');
describe('G6 N26b admin decision surface', () => {
  const html = fs.readFileSync(path.resolve('public/g6-sav-compensation.html'), 'utf8');
  const js = fs.readFileSync(path.resolve('public/js/g6-sav-compensation.js'), 'utf8');
  const financeHtml = fs.readFileSync(path.resolve('public/g8-remboursements.html'), 'utf8');
  const financeJs = fs.readFileSync(path.resolve('public/js/g8-remboursements.js'), 'utf8');
  test('separates read-only proposal from explicit financial decision', () => {
    expect(html).toContain('sav-lookup');
    expect(html).toContain('sav-decision');
    expect(js).toContain('/compensation-proposal');
    expect(js).toContain("'/compensation'");
    expect(js).toContain("actor.role !== 'admin'");
    expect(js).toContain('window.confirm(warning');
    expect(financeHtml).toContain('data-g6-sav-compensation-entry');
    expect(financeJs).toContain("userRole === 'admin'");
    expect(financeJs).toContain('compensationEntry.hidden = false');
  });
  test('does not bypass financial authority or manipulate database/PSP', () => {
    expect(js).not.toMatch(/wallet-service|stripe\.refunds|paypal\.refunds|INSERT INTO|UPDATE wallet/);
    expect(js).toContain("Number.isSafeInteger(amount)");
    expect(js).toContain("out.refund_status");
    expect(js).toContain("button.disabled = true");
    expect(financeJs).toContain("['admin', 'agent_relais']");
    expect(financeJs).toContain("userRole === 'admin'");
  });
  test('G6 N26b follows the visible link, clicks once, and checks persisted wallet/document effects', () => {
    expect(stage).toContain("'/g8-remboursements.html'");
    expect(stage).toContain("data-g6-sav-compensation-entry");
    expect(stage).toContain("'/api/relay/returns/'+requestId+'/compensation-proposal'");
    expect(stage).toContain("'/api/relay/returns/'+encodeURIComponent(requestId)+'/compensation'");
    expect(stage).toContain('G6_N26B_COMPENSATION_WALLET_OR_PAYER_ORACLE_MISMATCH');
    expect(stage).toContain("documents.rows[0].status==='available'");
    expect(stage).toContain('wallet_receipt_observed');
    expect(stage).toContain('G6_N26B_DUPLICATE_OR_EXTERNAL_REFUND_ORACLE');
    expect(stage).not.toContain('G6_N26B_SCREEN_PRESENT_GESTURE_NOT_MOUNTED');
  });
  test('keeps the physical intake request ID available for the later admin decision and PG oracle', () => {
    const declaration = stage.indexOf('let browser, requestId = null;');
    const assignment = stage.indexOf("requestId=await intake.locator('[data-relay-intake-request]').inputValue();");
    const closeIntakeContext = stage.indexOf('}finally{await actor.ctx.close()}');
    const adminDecision = stage.lastIndexOf('executeCompensationDecision(browser,requestId)');
    expect(declaration).toBeGreaterThanOrEqual(0);
    expect(declaration).toBeLessThan(assignment);
    expect(assignment).toBeLessThan(closeIntakeContext);
    expect(closeIntakeContext).toBeLessThan(adminDecision);
  });
});
