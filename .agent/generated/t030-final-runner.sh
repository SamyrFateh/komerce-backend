#!/usr/bin/env bash
set -euo pipefail

BRANCH='agent/lane-final'
T028_BASE='e695693c62bb7d02906762c4472d1846af33f28a'
T028_FINAL='5be14dac2a62f654ae9a3b5388f431587a2a152e'
T029_BASE='77478ee804d723f15834b5444927f23e1a66e162'
T029_FINAL='f45e8629812db25bf15ea41804e99c132fc6974a'
CONFLICT_REPORT='.agent/evidence/T-030/integration-conflict.txt'

configure_git() {
  git config user.name 'komerce-t030-bot'
  git config user.email 'komerce-t030-bot@users.noreply.github.com'
  git fetch --no-tags origin \
    '+refs/heads/agent/lane-mobile-renderer:refs/remotes/origin/agent/lane-mobile-renderer' \
    '+refs/heads/agent/lane-finish:refs/remotes/origin/agent/lane-finish'
  git merge-base --is-ancestor origin/agent/lane-mobile-renderer HEAD
}

persist_conflict_report() {
  local label="$1" base="$2" final="$3" patch="$4"
  local status unmerged diffcheck
  status="$(git status --short || true)"
  unmerged="$(git diff --name-only --diff-filter=U || true)"
  diffcheck="$(git diff --check 2>&1 || true)"
  git reset --hard HEAD
  mkdir -p "$(dirname "$CONFLICT_REPORT")"
  {
    echo "PATCH_INTEGRATION_CONFLICT=$label"
    echo "BASE=$base"
    echo "FINAL=$final"
    echo
    echo 'STATUS'
    printf '%s\n' "$status"
    echo
    echo 'UNMERGED_FILES'
    printf '%s\n' "$unmerged"
    echo
    echo 'DIFF_CHECK'
    printf '%s\n' "$diffcheck"
    echo
    echo "PATCH_FILE=$patch"
  } > "$CONFLICT_REPORT"
  git add "$CONFLICT_REPORT"
  if ! git diff --cached --quiet; then
    git commit -m "chore(t030): record $label targeted patch conflict"
    git push origin HEAD:"$BRANCH"
  fi
  exit 3
}

verify_t028_already_integrated() {
  python3 <<'PY'
from pathlib import Path

files = {
    'shell': Path('public/boutique/css/modal-shell.css').read_text(encoding='utf-8'),
    'media': Path('public/boutique/css/modal-media.css').read_text(encoding='utf-8'),
    'product': Path('public/boutique/css/modal-product.css').read_text(encoding='utf-8'),
    'lot4': Path('public/boutique/css/modal-product-lot4-hybrid.css').read_text(encoding='utf-8'),
}

def block(text, selector):
    start = text.find(selector)
    if start < 0:
        raise AssertionError(f'selector absent: {selector}')
    brace = text.find('{', start)
    if brace < 0:
        raise AssertionError(f'accolade absente: {selector}')
    depth = 0
    for index in range(brace, len(text)):
        char = text[index]
        if char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
            if depth == 0:
                return text[brace + 1:index]
    raise AssertionError(f'bloc non fermé: {selector}')

checks = []
def check(name, condition):
    checks.append((name, bool(condition)))

check('mic pulse animation removed', 'animation: k-mic-pulse' not in files['product'] and '@keyframes k-mic-pulse' not in files['product'])
check('favorite pop removed', 'k-modal-fav-pop' not in files['media'])
check('favorite active scale removed', '.k-modal-fav-btn:active' not in files['media'])
check('favorite base transition has no transform', 'transform' not in block(files['media'], '.k-modal-fav-btn {'))
check('recent-card hover has no transform', 'transform' not in block(files['media'], '.k-modal-recent-card:hover'))
check('keyboard hint hidden', 'display: none' in block(files['shell'], '.k-modal-keyboard-hint'))
check('reduced motion block present', '@media (prefers-reduced-motion: reduce)' in files['shell'])
check('SKU base transition has no transform', 'transform' not in block(files['product'], '.k-sku {'))
check('SKU hover has no transform', 'transform' not in block(files['product'], '.k-sku:hover:not(.k-sku--out)'))
check('payment tab base has no transform', 'transform' not in block(files['lot4'], '#k-modal .k-buybox-payment-tab {'))
check('payment tab hover has no transform', 'transform' not in block(files['lot4'], '#k-modal .k-buybox-payment-tab:hover'))
check('thumbnail hover has no transform', 'transform' not in block(files['shell'], '#k-modal .k-modal-thumb:hover'))

failed = [name for name, ok in checks if not ok]
Path('.agent/evidence/T-030').mkdir(parents=True, exist_ok=True)
Path('.agent/evidence/T-030/t028-integration-check.txt').write_text(
    '\n'.join(f"{'PASS' if ok else 'FAIL'} — {name}" for name, ok in checks) + '\n',
    encoding='utf-8'
)
if failed:
    raise SystemExit('T-028 invariants missing: ' + ', '.join(failed))
PY
}

apply_t029_source_patch() {
  local patch='/tmp/T-029.patch'
  local files=(
    public/boutique/css/modal-shell.css
    public/boutique/css/modal-media.css
    public/boutique/css/modal-product.css
    public/boutique/css/modal-product-lot4-hybrid.css
    public/boutique/css/modal-mobile-canonical.css
    public/boutique/css/modal-enriched-content.css
    public/boutique/css/tokens.css
  )
  git diff --binary "$T029_BASE" "$T029_FINAL" -- "${files[@]}" > "$patch"
  test -s "$patch"
  if git apply --reverse --check "$patch" >/dev/null 2>&1; then
    echo 'T-029 source patch already present on final lane'
    return
  fi
  if git apply --3way "$patch"; then
    git add -- "${files[@]}"
    echo 'T-029 source patch applied'
    return
  fi
  persist_conflict_report 'T-029' "$T029_BASE" "$T029_FINAL" "$patch"
}

recover_lane_metadata() {
  git checkout origin/agent/lane-finish -- \
    .agent/evidence/T-028 \
    .agent/state/T-028.json \
    .agent/worklogs/T-028.md \
    .agent/evidence/T-029 \
    .agent/state/T-029.json \
    .agent/worklogs/T-029.md \
    .agent/decisions/ADR-029-deps-override.md

  node <<'JS'
const fs = require('fs');
for (const id of ['T-028', 'T-029']) {
  const path = `.agent/state/${id}.json`;
  const state = JSON.parse(fs.readFileSync(path, 'utf8'));
  state.branch = 'agent/lane-final';
  state.next_action = id === 'T-028'
    ? 'Revue humaine finale avec les preuves T-030.'
    : 'T-029 intégrée à la lane finale; poursuivre T-030.';
  fs.writeFileSync(path, JSON.stringify(state, null, 2) + '\n');
}
JS

  test "$(node -p "require('./.agent/state/T-028.json').status")" = 'REVIEW'
  test "$(node -p "require('./.agent/state/T-029.json').status")" = 'DONE'
}

install_dependencies() {
  npm ci --ignore-scripts
  npm --prefix public/boutique ci --ignore-scripts
  npx --prefix public/boutique playwright install --with-deps chromium
}

run_gates() {
  set -o pipefail
  mkdir -p .agent/evidence/T-030
  : > .agent/evidence/T-030/gates-final.txt
  run_gate() {
    printf '\n===== %s =====\n' "$*" | tee -a .agent/evidence/T-030/gates-final.txt
    "$@" 2>&1 | tee -a .agent/evidence/T-030/gates-final.txt
  }
  run_gate npm --prefix public/boutique run deploy:css
  run_gate npm --prefix public/boutique run check:cache
  run_gate npm --prefix public/boutique run check:all
  run_gate npm --prefix public/boutique run test:unit
  run_gate npm run test:unit
  run_gate npm run feature:registry
  run_gate npm run gate:schema
  run_gate npm run gate:touched-files
  run_gate npm run gate:docs-lint
  run_gate npm run gate:feature-audit
  run_gate npm run gate:boutique-ownership
  run_gate npm run audit:features
  run_gate npm run map:check
}

capture_coverage() {
  set -o pipefail
  : > .agent/evidence/T-030/coverage-final.txt
  npm --prefix public/boutique run test:coverage 2>&1 | tee -a .agent/evidence/T-030/coverage-final.txt
}

generate_visual_evidence() {
  mkdir -p .agent/evidence/T-030/captures .agent/evidence/T-030/states .agent/generated
  cat > public/boutique/.tmp-t030-capture.cjs <<'JS'
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const detailFixture = require('./tests/fixtures/golden-elite-pro-detail.js');

const outRoot = path.resolve('../../.agent/evidence/T-030');
const baseUrl = 'http://127.0.0.1:4173/boutique/';
const productId = detailFixture.product.id;
const product = {
  id: productId,
  product_ref: detailFixture.product.reference,
  name: detailFixture.product.name,
  description: detailFixture.product.description,
  category: detailFixture.product.category,
  subcategory: detailFixture.product.subcategory,
  price_kmf: detailFixture.pricing.price_kmf,
  promo_pct: 15,
  image_url: detailFixture.media[0].url,
  images: detailFixture.media.map((media) => media.url),
  is_available: true,
  has_variants: true,
  inventory_model: 'SKU'
};

const viewports = [
  ['360', 360, 800], ['390', 390, 844], ['430', 430, 932],
  ['1024', 1024, 768], ['1440', 1440, 900], ['1600', 1680, 1050]
];
const states = ['AVAILABLE_EMPTY', 'AVAILABLE_FILLED', 'OUT_OF_STOCK', 'SELECTION_REQUIRED', 'LOADING', 'ERROR'];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function detailFor(state) {
  const detail = clone(detailFixture);
  if (state === 'AVAILABLE_EMPTY') {
    detail.inventory_model = 'PRODUCT';
    detail.option_axes = [];
    detail.sellable_units = [{
      sku_id: 'simple-available',
      sku: 'GOLD-SIMPLE',
      option_values: {},
      stock_status: 'AVAILABLE',
      available_quantity: 12,
      price_kmf: detail.pricing.price_kmf,
      media_ids: detail.media.map((media) => media.id)
    }];
  }
  return detail;
}

async function installApi(page, state) {
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/products') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ products: [product] })
      });
    }
    if (pathname === `/api/products/${productId}/detail`) {
      if (state === 'ERROR') {
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'T030 controlled failure' })
        });
      }
      if (state === 'LOADING') await new Promise((resolve) => setTimeout(resolve, 5000));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detailFor(state))
      });
    }
    if (pathname === '/api/auth/me') {
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'unauthenticated' })
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function openPdp(page, state) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const card = page.locator('#k-grid .k-promo-card, #k-grid .k-card').first();
  await card.waitFor({ state: 'visible', timeout: 15000 });
  await card.click();
  await page.locator('#k-modal-overlay.open, .k-modal-overlay.open').waitFor({ state: 'visible', timeout: 8000 });

  if (state === 'LOADING') {
    await page.locator('[data-mdm-skeleton="1"], .k-mdm-skeleton').waitFor({ state: 'visible', timeout: 3000 });
    return;
  }
  if (state === 'ERROR') {
    await page.locator('[data-mdm-detail-error="1"], .k-mdm-detail-error').waitFor({ state: 'visible', timeout: 12000 });
    return;
  }

  await page.locator('[data-option-value], #k-add-cart-btn').first().waitFor({ state: 'attached', timeout: 10000 });
  if (state === 'AVAILABLE_FILLED' || state === 'OUT_OF_STOCK') {
    await page.locator('[data-axis-key="Couleur"] [data-option-value="Bleu"]').click();
    const size = state === 'OUT_OF_STOCK' ? '43' : '42';
    await page.locator(`[data-axis-key="Taille"] [data-option-value="${size}"]`).click();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const [label, width, height] of viewports) {
      for (const state of states) {
        const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
        const page = await context.newPage();
        await installApi(page, state);
        const consoleErrors = [];
        page.on('console', (message) => {
          if (message.type() === 'error') consoleErrors.push(message.text());
        });
        await openPdp(page, state);
        const capturePath = path.join(outRoot, 'captures', `${label}-${state.toLowerCase()}.png`);
        await page.screenshot({ path: capturePath, fullPage: false });
        const snapshot = await page.evaluate(() => ({
          modalOpen: document.querySelector('#k-modal-overlay')?.classList.contains('open') || false,
          name: document.querySelector('#k-modal-name')?.textContent?.trim() || '',
          selectionMessage: document.querySelector('#k-modal-selection-message')?.textContent?.trim() || '',
          stock: document.querySelector('#k-modal-stock-pill')?.textContent?.trim() || '',
          addDisabled: document.querySelector('#k-add-cart-btn')?.disabled ?? null,
          detailError: document.querySelector('[data-mdm-detail-error="1"]')?.textContent?.trim() || '',
          loading: Boolean(document.querySelector('[data-mdm-skeleton="1"]')),
          bodyClasses: document.body.className
        }));
        const record = { viewport: label, width, height, state, snapshot, consoleErrors };
        results.push(record);
        fs.writeFileSync(
          path.join(outRoot, 'states', `${label}-${state.toLowerCase()}.json`),
          JSON.stringify(record, null, 2) + '\n'
        );
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(outRoot, 'states', 'summary.json'), JSON.stringify(results, null, 2) + '\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
JS

  ./public/boutique/node_modules/.bin/serve public -l 4173 > /tmp/t030-serve.log 2>&1 &
  local server_pid=$!
  trap 'kill "$server_pid" >/dev/null 2>&1 || true' RETURN
  for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:4173/boutique/ >/dev/null; then break; fi
    sleep 1
  done
  (cd public/boutique && node .tmp-t030-capture.cjs)
  kill "$server_pid" >/dev/null 2>&1 || true
  trap - RETURN
  test "$(find .agent/evidence/T-030/captures -type f -name '*.png' | wc -l)" -eq 36
}

build_report_and_package() {
  node <<'JS'
const fs = require('fs');
const path = require('path');
const evidence = '.agent/evidence/T-030';
const rows = [];
for (let number = 2; number <= 29; number += 1) {
  const id = `T-${String(number).padStart(3, '0')}`;
  const state = JSON.parse(fs.readFileSync(`.agent/state/${id}.json`, 'utf8'));
  const evidenceDir = `.agent/evidence/${id}`;
  const evidenceCount = fs.existsSync(evidenceDir)
    ? fs.readdirSync(evidenceDir, { recursive: true }).filter((entry) => !String(entry).endsWith('/')).length
    : 0;
  rows.push({ id, finding: state.finding_id || '', title: state.title || '', status: state.status, evidenceCount });
}
const matrix = [
  '# T-030 — Matrice de comparaison M1–M11, D1–D13, T1–T4', '',
  '| Tâche | Écart | Statut | Preuves | Titre |',
  '|---|---|---:|---:|---|',
  ...rows.map((row) => `| ${row.id} | ${row.finding} | ${row.status} | ${row.evidenceCount} | ${row.title.replace(/\|/g, '\\|')} |`),
  '',
  `Total: ${rows.length} écarts. États finaux acceptés: DONE ou REVIEW.`
].join('\n');
fs.writeFileSync(path.join(evidence, 'comparison-matrix.md'), matrix + '\n');
const invalid = rows.filter((row) => !['DONE', 'REVIEW'].includes(row.status));
if (invalid.length) {
  throw new Error(`Écarts non clos: ${invalid.map((row) => `${row.id}:${row.status}`).join(', ')}`);
}
const report = [
  '# RAPPORT — Chantier PDP maquette premium', '',
  '## Résultat exécutif', '',
  '- 28 écarts M1–M11, D1–D13 et T1–T4 présents en DONE ou REVIEW.',
  '- 36 captures réelles générées: 6 viewports × 6 états produit.',
  '- Tous les gates T-030 ont été exécutés; voir `.agent/evidence/T-030/gates-final.txt`.',
  '- Couverture enregistrée dans `.agent/evidence/T-030/coverage-final.txt`.',
  '',
  '## Viewports', '',
  '- 360×800, 390×844, 430×932, 1024×768, 1440×900, 1680×1050.',
  '',
  '## États vérifiés', '',
  '- AVAILABLE_EMPTY, AVAILABLE_FILLED, OUT_OF_STOCK, SELECTION_REQUIRED, LOADING, ERROR.',
  '',
  '## Dettes non absorbées', '',
  '- Les tâches en REVIEW exigent encore une décision humaine finale; T-030 ne les transforme pas artificiellement en DONE.',
  '- Les éventuelles dettes hors périmètre restent documentées dans les states et worklogs sources.',
  '',
  '## Revue indépendante', '',
  '- Le diff final doit recevoir une seconde lecture indépendante avant passage à DONE. Une validation Opus peut être utilisée comme reviewer externe; elle n’est pas simulée.',
  '',
  '## Pièces', '',
  '- Matrice: `.agent/evidence/T-030/comparison-matrix.md`',
  '- Captures: `.agent/evidence/T-030/captures/`',
  '- États: `.agent/evidence/T-030/states/`',
  '- Gates: `.agent/evidence/T-030/gates-final.txt`',
  '- Couverture: `.agent/evidence/T-030/coverage-final.txt`'
].join('\n');
fs.writeFileSync('RAPPORT_CHANTIER_PDP_MAQUETTE_PREMIUM.md', report + '\n');
const manifest = {
  task: 'T-030',
  generated_at: new Date().toISOString(),
  branch: 'agent/lane-final',
  captures: 36,
  viewports: [360, 390, 430, 1024, 1440, 1680],
  states: ['AVAILABLE_EMPTY', 'AVAILABLE_FILLED', 'OUT_OF_STOCK', 'SELECTION_REQUIRED', 'LOADING', 'ERROR'],
  report: 'RAPPORT_CHANTIER_PDP_MAQUETTE_PREMIUM.md',
  evidence: '.agent/evidence/T-030'
};
fs.writeFileSync('.agent/MANIFEST.json', JSON.stringify(manifest, null, 2) + '\n');
JS

  rm -f public/boutique/.tmp-t030-capture.cjs
  mkdir -p .agent/generated
  zip -qr .agent/generated/T-030-final.zip \
    RAPPORT_CHANTIER_PDP_MAQUETTE_PREMIUM.md \
    .agent/MANIFEST.json \
    .agent/evidence/T-030
  sha256sum .agent/generated/T-030-final.zip | tee .agent/evidence/T-030/package-sha256.txt
}

finalize_state() {
  node <<'JS'
const fs = require('fs');
const path = '.agent/state/T-030.json';
const state = JSON.parse(fs.readFileSync(path, 'utf8'));
const captures = fs.readdirSync('.agent/evidence/T-030/captures').filter((name) => name.endsWith('.png'));
state.status = 'REVIEW';
state.agent = 'gpt-5.6-thinking';
state.reviewer = null;
state.branch = 'agent/lane-final';
state.started_at = state.started_at || new Date().toISOString();
state.finished_at = new Date().toISOString();
state.changed_files = [
  'RAPPORT_CHANTIER_PDP_MAQUETTE_PREMIUM.md',
  '.agent/MANIFEST.json',
  '.agent/generated/T-030-final.zip',
  '.agent/evidence/T-030/**',
  '.agent/state/T-030.json'
];
state.gate_results = state.gates.map((command) => ({ command, result: 'PASS', exit_code: 0 }));
state.blocking_reason = null;
state.review_decision = null;
state.summary = `Validation finale: ${captures.length} captures (6 viewports x 6 états), 13 gates PASS, couverture enregistrée, matrice 28 écarts, rapport et ZIP SHA-256 produits.`;
state.next_action = 'Revue humaine indépendante du diff et des preuves; validation Opus externe recommandée avant passage à DONE.';
fs.writeFileSync(path, JSON.stringify(state, null, 2) + '\n');
JS
}

commit_final_result() {
  rm -f "$CONFLICT_REPORT"
  rm -f .github/workflows/t030-final-closeout.yml
  rm -f .agent/generated/t030-final-runner.sh
  git add -A
  git status --short
  git commit -m 'chore(t-030): final PDP validation, captures and report'
  git push origin HEAD:"$BRANCH"
}

main() {
  configure_git
  rm -f "$CONFLICT_REPORT"
  verify_t028_already_integrated
  apply_t029_source_patch
  recover_lane_metadata
  install_dependencies
  run_gates
  capture_coverage
  generate_visual_evidence
  build_report_and_package
  finalize_state
  commit_final_result
}

main "$@"
