from pathlib import Path
import re

ROOT = Path('.')


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'{label}: source block not found')
    return text.replace(old, new, 1)


def regex_once(text, pattern, replacement, label):
    out, n = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if n != 1:
        raise SystemExit(f'{label}: expected 1 replacement, got {n}')
    return out

# ---------------------------------------------------------------------------
# 1. KPI equilibrium: the five mock cards are structural and must never vanish
#    merely because the server cannot yet project the flow.
# ---------------------------------------------------------------------------
eq_path = ROOT / 'public/dashboards/canonical/js/pricing-equilibrium-panel.js'
eq = eq_path.read_text()
eq = replace_once(
    eq,
    "    const card = el(doc, 'div', `kmc-flow-equilibrium-metric is-derived${tone ? ` is-${tone}` : ''}`);",
    "    const classes = ['kmc-flow-equilibrium-metric', 'is-derived'];\n    if (tone) classes.push(`is-${tone}`);\n    if (iconKey) classes.push(`is-${iconKey}`);\n    const card = el(doc, 'div', classes.join(' '));",
    'metric tone classes',
)

new_build_panel = r'''  function buildPanel(doc, workspace, decision) {
    const flow = decision && decision.flow_break_even;
    const coverage = decision && decision.coverage ? decision.coverage : {};
    const observed = flow?.observed_mix || {};
    const target = flow?.economic_break_even || {};
    const ready = Boolean(flow && flow.status === 'READY');
    const panel = el(doc, 'section', 'kmc-flow-equilibrium-panel');
    panel.dataset[PANEL_ATTR] = '';

    const head = el(doc, 'div', 'kmc-flow-equilibrium-head');
    const copy = el(doc, 'div', 'kmc-flow-equilibrium-copy');
    copy.appendChild(el(doc, 'span', 'kmc-flow-equilibrium-kicker', 'ÉQUILIBRE DU FLUX · VÉRITÉ SERVEUR'));
    copy.appendChild(el(doc, 'h3', 'kmc-flow-equilibrium-title', 'Le portefeuille couvre la structure.'));
    copy.appendChild(el(doc, 'p', 'kmc-flow-equilibrium-intro', 'Une contribution économique issue des articles vendus. Les valeurs ci-dessous sont calculées par le moteur et ne sont pas éditables.'));
    head.appendChild(copy);
    panel.appendChild(head);

    // Contrat mock : les cinq indicateurs restent toujours à la même place.
    // Quand la vérité serveur n'est pas décisionnelle, la valeur reste « — » ;
    // le navigateur ne fabrique jamais un ratio, un gap ou une moyenne.
    const state = el(doc, 'div', 'kmc-flow-equilibrium-state');
    state.appendChild(metric(doc, 'Charges structurelles à couvrir', formatKmf(coverage.denominator_n3_kmf), 'Fixes directes + quote-part fixes mutualisées', null, 'charges'));
    state.appendChild(metric(doc, 'Contribution générée', formatKmf(coverage.numerator_contribution_kmf ?? observed.reconciled_contribution_kmf), 'Somme des contributions de tous les articles', null, 'contribution'));
    state.appendChild(metric(doc, 'Couverture', formatRatioPercent(workspace, coverage.coverage_ratio), 'Contribution / charges structurelles', null, 'couverture'));
    state.appendChild(metric(
      doc,
      'Reste à couvrir',
      formatKmf(target.gap_kmf),
      ready && target.status === 'TARGET_REACHED' ? 'Objectif atteint' : (ready ? 'Distance restante avant l’équilibre' : 'Projection en attente de vérité suffisante'),
      ready && target.status === 'TARGET_REACHED' ? 'positive' : (ready ? 'warning' : null),
      'reste'
    ));
    state.appendChild(metric(doc, 'Contribution moyenne / article', formatKmf(observed.contribution_per_article_kmf), 'Par article (mix réel)', null, 'moyenne'));
    panel.appendChild(state);

    if (!ready) {
      const unavailable = el(doc, 'div', 'kmc-flow-equilibrium-unavailable');
      unavailable.appendChild(el(doc, 'strong', '', 'Projection d’équilibre non décisionnelle'));
      unavailable.appendChild(el(doc, 'span', '', flow?.reason || 'La vérité de couverture ne permet pas encore de projeter le flux.'));
      panel.appendChild(unavailable);
      return panel;
    }

    panel.appendChild(buildFlowDetails(doc, flow));

    const safety = flow.policy_safety_target || null;
    if (safety && Number(safety.target_coverage_ratio) !== 1) {
      panel.appendChild(el(doc, 'p', 'kmc-flow-equilibrium-safety', `Cible de sécurité politique : ${formatRatioPercent(workspace, safety.target_coverage_ratio)} · gap ${formatKmf(safety.gap_kmf)}.`));
    }

    panel.appendChild(el(doc, 'p', 'kmc-flow-equilibrium-footnote', 'Projection à structure et mix constants. Les futurs paliers de capacité restent exclus tant qu’ils ne sont pas modélisés comme charges de structure.'));
    return panel;
  }

'''
eq = regex_once(eq, r"  function buildPanel\(doc, workspace, decision\) \{.*?\n  \}\n\n(?=  async function readDecision)", new_build_panel, 'buildPanel')
eq_path.write_text(eq)

# ---------------------------------------------------------------------------
# 2. Cockpit content = exact visible rubric contract of the approved mock.
# ---------------------------------------------------------------------------
cockpit_path = ROOT / 'public/dashboards/canonical/js/pricing-economic-cockpit.js'
js = cockpit_path.read_text()

js = replace_once(
    js,
    "  function categoryLabel(category) {\n    return String(category || 'Autres').replaceAll('_', ' ').replace(/^./, char => char.toUpperCase());\n  }",
    "  function categoryLabel(category) {\n    return String(category || 'Autres').replaceAll('_', ' ').replace(/^./, char => char.toUpperCase());\n  }\n\n  function marketFlagEmoji(code) {\n    const normalized = String(code || '').trim().toUpperCase();\n    if (!/^[A-Z]{2}$/.test(normalized)) return '';\n    const base = 0x1f1e6;\n    return String.fromCodePoint(...[...normalized].map(letter => base + letter.charCodeAt(0) - 65));\n  }",
    'market flag helper',
)

new_variable = r'''  function variableMarketShare(component) {
    if (allocationPerimeter(component) !== 'mutualized') return '—';
    const explicit = finite(component.market_share_kmf ?? component.market_quote_kmf ?? component.effective_market_share_kmf);
    return explicit == null ? componentValue(component) : formatKmf(explicit);
  }

  function variableCostCard(doc, components) {
    const card = el(doc, 'section', 'kmc-cockpit-cost-card is-variable');
    card.dataset.costSummary = 'variable';
    card.appendChild(costCardHeader(doc, '🛒', 'Coûts variables', 'Ces coûts affectent directement la contribution.', 'Ajuster les coûts', 'variable'));

    const table = el(doc, 'div', 'kmc-cockpit-cost-table is-variable');
    ['Élément', 'Nature', 'Périmètre', 'Clé d’allocation', 'Quote-part marché'].forEach(label => table.appendChild(tableCell(doc, label, 'is-head')));

    // Le mock rappelle explicitement que l'achat fournisseur est un coût
    // variable direct. Sa valeur reste produit-spécifique : aucune moyenne
    // portefeuille n'est inventée ici.
    table.appendChild(tableCell(doc, 'Achat fournisseur'));
    const purchaseNature = tableCell(doc, '', 'is-badge-cell');
    purchaseNature.appendChild(badge(doc, 'Variable', 'variable'));
    table.appendChild(purchaseNature);
    const purchasePerimeter = tableCell(doc, '', 'is-badge-cell');
    purchasePerimeter.appendChild(badge(doc, 'Direct', 'direct'));
    table.appendChild(purchasePerimeter);
    table.appendChild(tableCell(doc, '—', 'is-derived'));
    table.appendChild(tableCell(doc, '—', 'is-derived'));

    components.slice(0, 5).forEach(component => {
      const perimeter = allocationPerimeter(component);
      table.appendChild(tableCell(doc, component.label || component.key));
      const natureCell = tableCell(doc, '', 'is-badge-cell');
      natureCell.appendChild(badge(doc, 'Variable', 'variable'));
      table.appendChild(natureCell);
      const perimeterCell = tableCell(doc, '', 'is-badge-cell');
      perimeterCell.appendChild(badge(doc, perimeter === 'mutualized' ? 'Mutualisé' : 'Direct', perimeter === 'mutualized' ? 'mutualized' : 'direct'));
      table.appendChild(perimeterCell);
      table.appendChild(tableCell(doc, allocationLabel(component.allocation_method), 'is-derived'));
      table.appendChild(tableCell(doc, variableMarketShare(component), 'is-derived'));
    });

    const totalRow = el(doc, 'div', 'kmc-cockpit-cost-total-row');
    totalRow.appendChild(tableCell(doc, 'Coût variable complet (ex. moyen)', 'is-total-label'));
    // Une somme de composantes hétérogènes (% / commande / poids / valeur)
    // serait économiquement fausse. Le total exact reste calculé par SKU dans
    // le portefeuille, comme dans le mock.
    totalRow.appendChild(tableCell(doc, 'Calculé par produit', 'is-total-value is-textual'));
    table.appendChild(totalRow);
    card.appendChild(table);
    return card;
  }

'''
js = regex_once(js, r"  function variableCostCard\(doc, components, marketCode\) \{.*?\n  \}\n\n(?=  function fixedDirectCard)", new_variable, 'variableCostCard')

new_fixed_direct = r'''  function fixedDirectCard(doc, structure) {
    const card = el(doc, 'section', 'kmc-cockpit-cost-card is-fixed-direct');
    card.dataset.costSummary = 'fixed-direct';
    card.appendChild(costCardHeader(doc, '🏠', 'Charges fixes directes', 'Charges structurelles propres au marché.'));
    const table = el(doc, 'div', 'kmc-cockpit-cost-table is-fixed-direct');
    table.appendChild(tableCell(doc, 'Élément', 'is-head'));
    table.appendChild(tableCell(doc, 'Montant / mois', 'is-head'));
    const rows = Array.isArray(structure?.evidence)
      ? structure.evidence.filter(item => item.scope_kind === 'MARKET_DIRECT')
      : [];
    rows.slice(0, 6).forEach(item => {
      table.appendChild(tableCell(doc, item.charge_name || item.charge_family || 'Charge structurelle'));
      table.appendChild(tableCell(doc, formatKmf(item.recognized_amount_kmf), 'is-derived is-number'));
    });
    if (!rows.length) table.appendChild(el(doc, 'div', 'kmc-cockpit-empty-row', 'Donnée de période indisponible.'));
    else {
      const totalDirect = rows.reduce((sum, item) => sum + (Number(item.recognized_amount_kmf) || 0), 0);
      const totalRow = el(doc, 'div', 'kmc-cockpit-cost-total-row');
      totalRow.appendChild(tableCell(doc, 'Total fixes directes', 'is-total-label'));
      totalRow.appendChild(tableCell(doc, formatKmf(totalDirect), 'is-total-value'));
      table.appendChild(totalRow);
    }
    card.appendChild(table);
    return card;
  }

'''
js = regex_once(js, r"  function fixedDirectCard\(doc, structure\) \{.*?\n  \}\n\n(?=  function fixedMutualizedCard)", new_fixed_direct, 'fixedDirectCard')

new_fixed_mut = r'''  function fixedMutualizedCard(doc, structure, marketLabel, isAdmin) {
    const card = el(doc, 'section', 'kmc-cockpit-cost-card is-fixed-mutualized');
    card.dataset.costSummary = 'fixed-mutualized';
    card.appendChild(costCardHeader(doc, '🔗', 'Charges fixes mutualisées', 'Charges fixes partagées entre marchés.', 'Gérer les mutualisations', 'fixed-mutualized',
      isAdmin ? null : 'Réservé à l’administration — un ajustement mutualisé affecte tous les marchés à la fois.'));
    const table = el(doc, 'div', 'kmc-cockpit-cost-table is-fixed-mutualized');
    ['Élément', 'Coût global', 'Clé d’allocation', '%', `Quote-part ${marketLabel}`].forEach(label => table.appendChild(tableCell(doc, label, 'is-head')));
    const charges = Array.isArray(structure?.allocation?.charges) ? structure.allocation.charges : [];
    charges.slice(0, 6).forEach(charge => {
      table.appendChild(tableCell(doc, charge.charge_name || charge.charge_family || 'Charge mutualisée'));
      table.appendChild(tableCell(doc, formatKmf(charge.group_pool_kmf), 'is-derived'));
      const policy = charge.policy;
      table.appendChild(tableCell(doc, policy ? (policy.basis_kind || '—') : 'Politique manquante', 'is-derived'));
      const ratioText = charge.market_allocation_ratio != null ? `${formatNumber(Number(charge.market_allocation_ratio) * 100)} %` : '—';
      table.appendChild(tableCell(doc, ratioText, 'is-derived'));
      const shareText = charge.market_share_kmf == null ? '—' : formatKmf(charge.market_share_kmf);
      table.appendChild(tableCell(doc, shareText, `is-derived ${charge.market_share_kmf == null ? '' : 'is-market-share'}`.trim()));
    });
    if (!charges.length) table.appendChild(el(doc, 'div', 'kmc-cockpit-empty-row', 'Donnée de période indisponible.'));
    if (charges.length) {
      const totalMut = charges.reduce((sum, c) => sum + (Number(c.market_share_kmf) || 0), 0);
      const totalRow = el(doc, 'div', 'kmc-cockpit-cost-total-row is-mutualized');
      totalRow.appendChild(tableCell(doc, 'Total fixes mutualisées (imputé au marché)', 'is-total-label'));
      totalRow.appendChild(tableCell(doc, formatKmf(totalMut), 'is-total-value'));
      table.appendChild(totalRow);
    }
    card.appendChild(table);
    return card;
  }

'''
js = regex_once(js, r"  function fixedMutualizedCard\(doc, structure, marketCode, isAdmin\) \{.*?\n  \}\n\n(?=  function principleCard)", new_fixed_mut, 'fixedMutualizedCard')

old_cost_pilotage = """  function createCostPilotage(doc, payload, marketCode, decision, user) {\n    const groups = classifyComponents(Array.isArray(payload.cost_components) ? payload.cost_components : []);\n    const structure = decision?.coverage?.structure || null;\n    const isAdmin = (user && user.role) === 'admin';\n    const section = el(doc, 'section', 'kmc-cockpit-costs');\n    section.appendChild(variableCostCard(doc, groups.variable, marketCode));\n    section.appendChild(fixedDirectCard(doc, structure));\n    section.appendChild(fixedMutualizedCard(doc, structure, marketCode, isAdmin));\n    section.appendChild(principleCard(doc, marketCode));\n    return section;\n  }"""
new_cost_pilotage = """  function createCostPilotage(doc, payload, marketCode, decision, user) {\n    const groups = classifyComponents(Array.isArray(payload.cost_components) ? payload.cost_components : []);\n    const structure = decision?.coverage?.structure || null;\n    const isAdmin = (user && user.role) === 'admin';\n    const marketLabel = payload.scope?.market_name || marketCode;\n    const section = el(doc, 'section', 'kmc-cockpit-costs');\n    section.appendChild(variableCostCard(doc, groups.variable));\n    section.appendChild(fixedDirectCard(doc, structure));\n    section.appendChild(fixedMutualizedCard(doc, structure, marketLabel, isAdmin));\n    section.appendChild(principleCard(doc, marketCode));\n    return section;\n  }"""
js = replace_once(js, old_cost_pilotage, new_cost_pilotage, 'createCostPilotage')

# Market data: the approved mock carries the market flag next to the local truth.
js = replace_once(
    js,
    "    const localHead = el(doc, 'div', 'kmc-cockpit-market-head');\n    localHead.appendChild(el(doc, 'strong', '', `${corridor?.market?.name || corridor?.market?.code || 'Marché'} (observé)`));",
    "    const localHead = el(doc, 'div', 'kmc-cockpit-market-head');\n    const marketIdentity = el(doc, 'strong', 'kmc-cockpit-market-identity');\n    const flag = marketFlagEmoji(corridor?.market?.code);\n    marketIdentity.textContent = `${flag ? `${flag} ` : ''}${corridor?.market?.name || corridor?.market?.code || 'Marché'} (observé)`;\n    localHead.appendChild(marketIdentity);",
    'market data flag',
)

# Remove the inline observations rubric: it is not part of the approved page.
js = regex_once(js, r"  function observationsEditor\(doc, corridor, canManage\) \{.*?\n  \}\n\n(?=  function productDecisionCard)", '', 'observationsEditor')

new_product_card = r'''  function productDecisionCard(doc, corridor, canManage) {
    const economics = corridor?.selected?.economics || {};
    const local = corridor?.corridor?.local || {};
    const currency = corridor?.market?.currency || 'KMF';
    const card = el(doc, 'section', 'kmc-cockpit-detail-card is-product-decision');
    card.appendChild(el(doc, 'h4', '', 'Détail d’un produit'));

    const body = el(doc, 'div', 'kmc-cockpit-product-detail-body');
    const identity = el(doc, 'div', 'kmc-cockpit-product-identity');
    const imageUrl = corridor?.product?.image_url || corridor?.product?.thumbnail_url;
    if (imageUrl) {
      const img = doc.createElement('img');
      img.className = 'kmc-cockpit-product-image';
      img.src = imageUrl;
      img.alt = corridor?.product?.name || '';
      img.loading = 'lazy';
      identity.appendChild(img);
    } else {
      identity.appendChild(el(doc, 'div', 'kmc-cockpit-product-image-placeholder', '📦'));
    }
    const identityCopy = el(doc, 'div', 'kmc-cockpit-product-identity-copy');
    identityCopy.appendChild(el(doc, 'strong', '', corridor?.product?.name || corridor?.product?.product_ref || 'Produit'));
    identityCopy.appendChild(el(doc, 'small', '', `SKU : ${corridor?.product?.product_ref || ''}`));
    identityCopy.appendChild(el(doc, 'small', '', `Catégorie : ${categoryLabel(corridor?.product?.category)}`));
    const viewLink = el(doc, 'a', 'kmc-cockpit-product-link', 'Voir la fiche complète ↗');
    viewLink.href = `/admin/products/${encodeURIComponent(corridor?.product?.product_ref || '')}`;
    viewLink.target = '_blank';
    identityCopy.appendChild(viewLink);
    identity.appendChild(identityCopy);
    body.appendChild(identity);

    const metrics = el(doc, 'div', 'kmc-cockpit-detail-metrics');
    metrics.appendChild(detailMetric(doc, 'Coût d’achat', formatKmf(corridor?.product?.purchase_cost_kmf)));
    metrics.appendChild(detailMetric(doc, 'Coûts variables hors achat', formatKmf(economics.variable_cost_outside_purchase_kmf)));
    metrics.appendChild(detailMetric(doc, 'Coût variable complet', formatKmf(economics.variable_cost_complete_kmf)));
    metrics.appendChild(detailMetric(doc, 'Borne marché basse', corridorAmount(local.low, currency)));
    metrics.appendChild(detailMetric(doc, 'Borne marché cible', corridorAmount(local.target, currency)));
    metrics.appendChild(detailMetric(doc, 'Borne marché haute', corridorAmount(local.high, currency)));

    const priceRow = el(doc, 'div', 'kmc-cockpit-detail-metric is-editable is-price-row');
    priceRow.appendChild(el(doc, 'span', '', 'Prix retenu'));
    if (canManage) {
      const form = doc.createElement('form');
      form.dataset.cockpitPriceForm = corridor?.product?.product_ref || '';
      form.className = 'kmc-cockpit-final-price-form is-inline';
      const input = doc.createElement('input');
      input.type = 'number';
      input.name = 'amount';
      input.min = '0.01';
      input.step = '0.01';
      input.required = true;
      input.value = corridor?.selected?.local_amount != null ? corridor.selected.local_amount : '';
      input.placeholder = `Prix ${currency}`;
      input.dataset.finalMarketPrice = '';
      input.dataset.originalValue = input.value;
      form.appendChild(input);
      priceRow.appendChild(form);
    } else {
      priceRow.appendChild(el(doc, 'strong', 'kmc-cockpit-readonly-price', selectedAmount(corridor)));
    }
    metrics.appendChild(priceRow);
    metrics.appendChild(detailMetric(doc, 'Contribution unitaire', formatKmf(economics.contribution_unit_kmf)));
    body.appendChild(metrics);
    card.appendChild(body);
    return card;
  }

'''
js = regex_once(js, r"  function productDecisionCard\(doc, corridor, canManage\) \{.*?\n  \}\n\n(?=  function renderProductDetail)", new_product_card, 'productDecisionCard')

js = replace_once(
    js,
    "    detail.appendChild(grid);\n    detail.appendChild(observationsEditor(doc, corridor, canManage));\n    portfolio.__selectedProductRef = corridor?.product?.product_ref || null;",
    "    detail.appendChild(grid);\n    portfolio.__selectedProductRef = corridor?.product?.product_ref || null;",
    'remove observations from main detail',
)

# Remove now-unreachable observation UI event branches.
js = regex_once(js, r"\n      const remove = event\.target\.closest\('\[data-cockpit-deactivate-observation\]'\);.*?\n      \}\n\n(?=      const addProduct)", '\n', 'remove observation click handler')
js = regex_once(js, r"\n      const observationForm = event\.target\.closest\('\[data-cockpit-observation-form\]'\);.*?\n      \}\n(?=    \}\);)", '\n', 'remove observation submit handler')

cockpit_path.write_text(js)

# ---------------------------------------------------------------------------
# 3. Navigation selector: a market-required workspace must not advertise
#    "Global · Tous les marchés" while the surface is actually scoped to a
#    country. This was visible in the user's screenshot.
# ---------------------------------------------------------------------------
nav_path = ROOT / 'public/dashboards/canonical/js/navigation.js'
nav = nav_path.read_text()
nav = replace_once(
    nav,
    "  function currentRequestedMarket(adminContext) {",
    "  function currentRequestedMarket(adminContext, requireMarket = false) {",
    'currentRequestedMarket signature',
)
nav = replace_once(
    nav,
    "    if (access.mode === 'global') return null;\n    if (access.defaultMarket && access.allowedMarkets.includes(access.defaultMarket)) return access.defaultMarket;\n    return access.allowedMarkets[0] || null;",
    "    if (access.mode === 'global' && !requireMarket) return null;\n    if (access.defaultMarket && access.allowedMarkets.includes(access.defaultMarket)) return access.defaultMarket;\n    return access.allowedMarkets[0] || null;",
    'currentRequestedMarket required mode',
)
nav = replace_once(
    nav,
    "  function marketChoices(adminContext) {\n    const app = global.KomerceCanonicalAdmin;\n    if (app && typeof app.marketChoices === 'function') {\n      try { return app.marketChoices(adminContext); } catch (_) { /* fallback ci-dessous */ }\n    }",
    "  function marketChoices(adminContext, requireMarket = false) {\n    const app = global.KomerceCanonicalAdmin;\n    if (app && typeof app.marketChoices === 'function') {\n      try { return app.marketChoices(adminContext, { requireMarket }); } catch (_) { /* fallback ci-dessous */ }\n    }",
    'marketChoices required mode',
)
nav = replace_once(
    nav,
    "    if (access.mode === 'global') choices.push({ value: '', label: 'Tous les marchés' });",
    "    if (access.mode === 'global' && !requireMarket) choices.push({ value: '', label: 'Tous les marchés' });",
    'fallback global choice',
)
nav = replace_once(
    nav,
    "  function createMarketControl(doc, adminContext) {\n    const choices = marketChoices(adminContext);",
    "  function createMarketControl(doc, adminContext, requireMarket = false) {\n    const choices = marketChoices(adminContext, requireMarket);",
    'createMarketControl signature',
)
nav = replace_once(nav, "    const current = currentRequestedMarket(adminContext);", "    const current = currentRequestedMarket(adminContext, requireMarket);", 'market control current')
nav = replace_once(
    nav,
    "    const marketControl = createMarketControl(doc, adminContext);",
    "    const requireMarket = ['pricing-workspace', 'operations-workspace', 'shipping-customs-workspace', 'accounting-workspace'].includes(surface);\n    const marketControl = createMarketControl(doc, adminContext, requireMarket);",
    'mount market required',
)
nav_path.write_text(nav)

# ---------------------------------------------------------------------------
# 4. Visual parity overrides. Keep this as one named block so future diffs can
#    compare it directly to the approved mock instead of accumulating tweaks.
# ---------------------------------------------------------------------------
css_path = ROOT / 'public/dashboards/canonical/css/pricing-economic-cockpit.css'
css = css_path.read_text()
marker = '/* ── MOCK PARITY FINAL · 2026-09 ─────────────────────────── */'
if marker in css:
    css = css[:css.index(marker)].rstrip() + '\n'
css += r'''

/* ── MOCK PARITY FINAL · 2026-09 ─────────────────────────── */
/* La capture approuvée est le contrat : mêmes rubriques, même hiérarchie,
   mêmes accents. Les états serveur manquants changent la valeur, jamais la
   structure de la page. */
.kmc-economic-cockpit {
  gap: 12px;
  padding: 0 22px 68px;
  background: #fff;
}

.kmc-cockpit-page-title {
  color: #102a72;
  font-size: 24px;
  line-height: 1.05;
}
.kmc-cockpit-page-subtitle {
  color: #5074c8;
  font-size: 13px;
}
.kmc-cockpit-period-label { color: #294a9b; }
.kmc-cockpit-period-select {
  min-width: 126px;
  border-color: #d8e2f0;
  color: #173c8d;
  box-shadow: 0 1px 3px rgb(15 23 42 / .04);
}
.kmc-cockpit-live-badge {
  position: relative;
  padding-left: 28px;
  background: #ecfbf3;
  text-align: left;
}
.kmc-cockpit-live-badge::before {
  content: '';
  position: absolute;
  left: 12px;
  top: 13px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #10a36a;
  box-shadow: 0 0 0 4px rgb(16 163 106 / .08);
}

.kmc-flow-equilibrium-panel--cockpit {
  display: grid;
  gap: 8px;
}
.kmc-flow-equilibrium-panel--cockpit .kmc-flow-equilibrium-state {
  gap: 8px;
}
.kmc-flow-equilibrium-panel--cockpit .kmc-flow-equilibrium-metric {
  min-height: 88px;
  padding: 12px 13px;
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  grid-template-areas:
    'icon label'
    'icon value'
    'icon helper';
  column-gap: 10px;
  row-gap: 2px;
  align-content: center;
  border: 1px solid #e6ebf4;
  border-radius: 8px;
  background: #fff !important;
  box-shadow: 0 1px 4px rgb(17 40 93 / .035);
}
.kmc-flow-equilibrium-panel--cockpit .kmc-flow-equilibrium-icon {
  grid-area: icon;
  align-self: start;
  width: 36px;
  height: 36px;
  margin: 0;
  border-radius: 8px;
}
.kmc-flow-equilibrium-panel--cockpit .kmc-flow-equilibrium-label {
  grid-area: label;
  color: #18376f;
  font-size: 10px;
  font-weight: 850;
}
.kmc-flow-equilibrium-panel--cockpit .kmc-flow-equilibrium-value {
  grid-area: value;
  color: #102a72;
  font-size: clamp(19px, 1.35vw, 25px);
  font-weight: 900;
}
.kmc-flow-equilibrium-panel--cockpit .kmc-flow-equilibrium-helper {
  grid-area: helper;
  color: #5c79bd;
  font-size: 9px;
  line-height: 1.25;
}
.kmc-flow-equilibrium-panel--cockpit .kmc-flow-equilibrium-metric.is-reste .kmc-flow-equilibrium-value {
  color: #e11d48;
}
.kmc-flow-equilibrium-panel--cockpit .kmc-flow-equilibrium-unavailable {
  margin: 0;
  padding: 7px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-left: 3px solid #ef4444;
  border-radius: 5px;
  background: #fff7f7;
  color: #b42318;
  font-size: 10px;
}
.kmc-flow-equilibrium-panel--cockpit .kmc-flow-equilibrium-unavailable strong { white-space: nowrap; }

.kmc-cockpit-costs {
  gap: 8px;
  grid-template-columns: minmax(0, 1.22fr) minmax(0, .82fr) minmax(0, 1.05fr) minmax(210px, .62fr);
}
.kmc-cockpit-cost-card,
.kmc-cockpit-principle,
.kmc-cockpit-portfolio,
.kmc-cockpit-detail-card {
  border-color: #e3e9f3;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgb(17 40 93 / .025);
}
.kmc-cockpit-cost-head { padding: 10px 11px 9px; }
.kmc-cockpit-cost-identity strong { color: #102a72; font-size: 13px; }
.kmc-cockpit-cost-identity small { color: #607dbf; font-size: 9px; }
.kmc-cockpit-cost-icon { width: 34px; height: 34px; flex-basis: 34px; border-radius: 8px; }
.kmc-cockpit-cost-card.is-variable { --cockpit-accent: #0b84f3; --cockpit-soft: #edf7ff; }
.kmc-cockpit-cost-card.is-fixed-direct { --cockpit-accent: #ef3154; --cockpit-soft: #fff0f3; }
.kmc-cockpit-cost-card.is-fixed-mutualized { --cockpit-accent: #2478e8; --cockpit-soft: #eef5ff; }
.kmc-cockpit-principle {
  padding: 12px;
  background: #fbfdff;
  border-color: #dfe9f8;
}
.kmc-cockpit-principle-head strong { color: #102a72; }
.kmc-cockpit-principle li { color: #39568e; }

.kmc-cockpit-cost-table.is-variable {
  grid-template-columns: minmax(118px, 1.25fr) 62px 76px minmax(82px, .85fr) minmax(92px, .9fr);
}
.kmc-cockpit-cell { padding: 6px 7px; color: #27416d; }
.kmc-cockpit-cell.is-head {
  background: #f7faff;
  color: #375481;
  font-size: 8.5px;
}
.kmc-cockpit-cell.is-derived { background: #f8fafc; color: #59709a; }
.kmc-cockpit-cost-total-row { background: #f7faff; border-top-color: #d8e3f2; }
.kmc-cockpit-cost-total-row .kmc-cockpit-cell.is-total-value { color: #102a72; }
.kmc-cockpit-cost-total-row .kmc-cockpit-cell.is-textual { font-size: 9px; font-weight: 750; }

.kmc-cockpit-portfolio { gap: 8px; padding: 12px; }
.kmc-cockpit-portfolio-head h3 { color: #102a72; font-size: 18px; }
.kmc-cockpit-tab { border-radius: 6px; color: #355387; }
.kmc-cockpit-tab.is-active { border-color: #0b84f3; background: #0b84f3; }
.kmc-cockpit-outline-action.is-add { border-color: #0b84f3; color: #0b84f3; }
.kmc-cockpit-portfolio-table { border-radius: 7px; }
.kmc-cockpit-product-row.is-head { background: #f6faff; }
.kmc-cockpit-product-row.is-head .kmc-cockpit-cell { color: #35507d; }
.kmc-cockpit-product-row .kmc-cockpit-cell.is-contribution { color: #1a9362; }

.kmc-cockpit-detail-grid {
  grid-template-columns: minmax(0, 1.45fr) minmax(240px, .82fr) minmax(240px, .82fr);
  gap: 8px;
}
.kmc-cockpit-detail-card { padding: 11px; }
.kmc-cockpit-detail-card h4,
.kmc-cockpit-detail-card-title { color: #102a72; }
.kmc-cockpit-product-detail-body {
  display: grid;
  grid-template-columns: minmax(165px, .68fr) minmax(250px, 1.32fr);
  gap: 12px;
  align-items: start;
}
.kmc-cockpit-product-identity { margin: 0; }
.kmc-cockpit-detail-metrics { gap: 3px; }
.kmc-cockpit-detail-metric strong,
.kmc-cockpit-final-price-form.is-inline input {
  min-height: 25px;
  padding: 4px 7px;
  background: #f4f7fb;
  border-color: #e2e8f1;
  color: #50678f;
  font-size: 10px;
}
.kmc-cockpit-detail-metric.is-price-row { align-items: center; }
.kmc-cockpit-final-price-form.is-inline {
  display: block;
  margin: 0;
}
.kmc-cockpit-final-price-form.is-inline input {
  width: 100%;
  border: 1px solid #cfdced;
  border-radius: 5px;
  background: #fff;
  color: #173c8d;
  font-weight: 850;
  text-align: right;
}
.kmc-cockpit-market-identity { color: #173c8d; }
.kmc-cockpit-sensitivity-table .is-positive { color: #13925c; }

.kmc-cockpit-footer {
  padding: 9px 12px;
  border-radius: 0 0 8px 8px;
  box-shadow: 0 -1px 8px rgb(17 40 93 / .045);
}
.kmc-cockpit-footer-save {
  padding: 9px 18px;
  border-radius: 6px;
  background: #0b84f3;
  font-size: 11px;
}
.kmc-cockpit-footer-save:hover { background: #0872d2; }

@media (max-width: 1250px) {
  .kmc-cockpit-product-detail-body { grid-template-columns: 1fr; }
}
'''
css_path.write_text(css)

# ---------------------------------------------------------------------------
# 5. Cache bust + tests that encode the exact rubric contract.
# ---------------------------------------------------------------------------
index_path = ROOT / 'public/dashboards/canonical/index.html'
index = index_path.read_text()
index = index.replace('pricing-equilibrium-panel.css?v=1301', 'pricing-equilibrium-panel.css?v=1302')
index = index.replace('pricing-economic-cockpit.css?v=1402', 'pricing-economic-cockpit.css?v=1403')
index = index.replace('pricing-equilibrium-panel.js?v=1301', 'pricing-equilibrium-panel.js?v=1302')
index = index.replace('pricing-economic-cockpit.js?v=1403', 'pricing-economic-cockpit.js?v=1404')
index = index.replace('navigation.js?v=1502', 'navigation.js?v=1503')
index_path.write_text(index)

cockpit_test_path = ROOT / 'tests/unit/canonical-pricing-economic-cockpit.test.js'
test = cockpit_test_path.read_text()
test = test.replace("pricing-economic-cockpit.js?v=1403", "pricing-economic-cockpit.js?v=1404")
test = test.replace("pricing-economic-cockpit.css?v=1402", "pricing-economic-cockpit.css?v=1403")
test = test.replace("  expect(source).toContain('Valeur effective ${marketCode}');\n", "  expect(source).toContain('Quote-part marché');\n")
insert_after = "  expect(source).toContain('Données marché');\n"
extra = """  expect(source).toContain('Montant / mois');\n  expect(source).toContain('Coût global');\n  expect(source).toContain('Prix retenu');\n  expect(source).not.toContain('Affiner les observations marché');\n  expect(source).not.toContain('Prix final marché retenu');\n"""
test = replace_once(test, insert_after, insert_after + extra, 'cockpit rubric assertions')
test = replace_once(
    test,
    "  expect(css).toContain('.kmc-cockpit-detail-grid');\n",
    "  expect(css).toContain('.kmc-cockpit-detail-grid');\n  expect(css).toContain('MOCK PARITY FINAL');\n  expect(css).toContain('background: #0b84f3');\n",
    'cockpit visual assertions',
)
cockpit_test_path.write_text(test)

eq_test_path = ROOT / 'tests/unit/canonical-pricing-equilibrium-panel.test.js'
eq_test = eq_test_path.read_text()
eq_test = eq_test.replace('pricing-equilibrium-panel.js?v=1301', 'pricing-equilibrium-panel.js?v=1302')
eq_test = eq_test.replace('pricing-equilibrium-panel.css?v=1301', 'pricing-equilibrium-panel.css?v=1302')
eq_test = eq_test.replace("  expect(source).toContain('Charges à couvrir');", "  expect(source).toContain('Charges structurelles à couvrir');")
eq_test = replace_once(
    eq_test,
    "  expect(source).toContain('Contribution moyenne / article');\n",
    "  expect(source).toContain('Contribution moyenne / article');\n  expect(source.indexOf(\"const state = el(doc, 'div', 'kmc-flow-equilibrium-state')\")).toBeLessThan(source.indexOf(\"if (!ready)\"));\n  expect(source).toContain(\"if (iconKey) classes.push(`is-${iconKey}`)\");\n",
    'equilibrium structural assertions',
)
eq_test_path.write_text(eq_test)

nav_test_path = ROOT / 'tests/unit/canonical-navigation.test.js'
nav_test = nav_test_path.read_text()
# Make the test stub honor requireMarket just like app.marketChoices does.
nav_test = replace_once(
    nav_test,
    "      marketChoices: jest.fn(context => {\n        const access = context && context.access;\n        if (!access) return [];\n        const rows = access.mode === 'global' ? [{ value: '', marketCode: null, label: 'Global · Tous les marchés' }] : [];",
    "      marketChoices: jest.fn((context, opts = {}) => {\n        const access = context && context.access;\n        if (!access) return [];\n        const rows = access.mode === 'global' && !opts.requireMarket ? [{ value: '', marketCode: null, label: 'Global · Tous les marchés' }] : [];",
    'navigation test marketChoices stub',
)
anchor = "  test('Déconnexion appelle le endpoint auth puis revient au login', async () => {"
new_nav_test = r'''  test('Atelier économique n’affiche jamais Global quand la surface exige un Market ID', () => {
    const env = loadNavigation('/admin/workspaces/pricing', 'pricing-workspace');
    const header = env.api.mount({
      document: env.document,
      pathname: '/admin/workspaces/pricing',
      surface: 'pricing-workspace',
      user: { role: 'admin' },
      adminContext: {
        access: {
          mode: 'global',
          defaultMarket: 'CM',
          allowedMarkets: ['CM', 'CG'],
        },
      },
    });
    const select = header.children[0].children[2].children[0].children[0];
    expect(select.value).toBe('CM');
    expect(select.children.map(option => option.value)).toEqual(['CM', 'CG']);
    expect(select.children.map(option => option.textContent)).not.toContain('Global · Tous les marchés');
  });

'''
nav_test = replace_once(nav_test, anchor, new_nav_test + anchor, 'navigation pricing market test')
nav_test_path.write_text(nav_test)

print('pricing mock parity patch applied')
