from pathlib import Path
import re

js_path = Path('public/dashboards/canonical/js/pricing-economic-cockpit.js')
css_path = Path('public/dashboards/canonical/css/pricing-economic-cockpit.css')
test_path = Path('tests/unit/canonical-pricing-economic-cockpit.test.js')
index_path = Path('public/dashboards/canonical/index.html')

js = js_path.read_text()

# Remove the legacy "advanced details" composition entirely.
js, n = re.subn(
    r"\n  function createAdvancedDetails\(doc, nodes\) \{.*?\n  \}\n\n  function moveEquilibriumIntoCockpit",
    "\n\n  function moveEquilibriumIntoCockpit",
    js,
    count=1,
    flags=re.S,
)
assert n == 1, 'createAdvancedDetails block not found'

marker = "\n  function bindCockpit(rootObject, workspace, options, payload, cockpit, advanced) {"
assert marker in js, 'bindCockpit marker not found'
variable_panel = r'''
  async function openVariableCostPanel(rootObject, doc, workspace, options, payload) {
    const components = classifyComponents(Array.isArray(payload.cost_components) ? payload.cost_components : []).variable
      .filter(component => component && component.key);
    const overlay = el(doc, 'div', 'kmc-structure-panel-overlay');
    overlay.dataset.variableCostPanel = '';
    const panel = el(doc, 'div', 'kmc-structure-panel kmc-variable-cost-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    overlay.appendChild(panel);

    const header = el(doc, 'div', 'kmc-structure-panel-header');
    const titles = el(doc, 'div', '');
    titles.appendChild(el(doc, 'h2', 'kmc-structure-panel-title', 'Ajuster les coûts variables'));
    titles.appendChild(el(doc, 'p', 'kmc-structure-panel-subtitle', `Valeurs effectives du marché ${options.requestedMarket || ''}. Le moteur recalcule ensuite automatiquement la contribution.`.trim()));
    header.appendChild(titles);
    const close = el(doc, 'button', 'kmc-structure-panel-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fermer');
    header.appendChild(close);
    panel.appendChild(header);

    const body = el(doc, 'div', 'kmc-structure-panel-body');
    const form = doc.createElement('form');
    form.className = 'kmc-variable-cost-panel-form';
    const error = el(doc, 'div', 'kmc-structure-panel-error');
    error.hidden = true;
    form.appendChild(error);

    if (!components.length) form.appendChild(el(doc, 'div', 'kmc-cockpit-empty-row', 'Aucun coût variable actif à ajuster.'));

    components.forEach(component => {
      const row = el(doc, 'label', 'kmc-variable-cost-panel-row');
      const identity = el(doc, 'div', 'kmc-variable-cost-panel-identity');
      identity.appendChild(el(doc, 'strong', '', component.label || component.key));
      identity.appendChild(el(doc, 'small', '', `${allocationPerimeter(component) === 'mutualized' ? 'Mutualisé' : 'Direct'} · ${allocationLabel(component.allocation_method)}`));
      row.appendChild(identity);
      const control = el(doc, 'div', 'kmc-variable-cost-panel-control');
      const input = doc.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.value = Number.isFinite(Number(component.default_value)) ? String(component.default_value) : '';
      input.dataset.originalValue = input.value;
      input.dataset.variableCostInput = component.key;
      input.setAttribute('aria-label', `Valeur de ${component.label || component.key}`);
      control.appendChild(input);
      control.appendChild(el(doc, 'span', '', unitLabel(component.unit) || component.unit || 'KMF'));
      row.appendChild(control);
      form.appendChild(row);
    });
    body.appendChild(form);
    panel.appendChild(body);

    const footer = el(doc, 'div', 'kmc-structure-panel-footer');
    const cancel = el(doc, 'button', 'kmc-cockpit-outline-action', 'Annuler');
    cancel.type = 'button';
    const save = el(doc, 'button', 'kmc-cockpit-footer-save', 'Enregistrer les coûts');
    save.type = 'button';
    footer.appendChild(cancel);
    footer.appendChild(save);
    panel.appendChild(footer);

    function closePanel() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    close.addEventListener('click', closePanel);
    cancel.addEventListener('click', closePanel);
    overlay.addEventListener('click', event => { if (event.target === overlay) closePanel(); });

    save.addEventListener('click', async () => {
      const inputs = Array.from(form.querySelectorAll('[data-variable-cost-input]'));
      const changed = inputs.filter(input => input.value !== input.dataset.originalValue);
      if (!changed.length) { closePanel(); return; }
      save.disabled = true;
      save.textContent = 'Enregistrement…';
      error.hidden = true;
      const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
      try {
        for (const input of changed) {
          const value = Number(input.value);
          if (!Number.isFinite(value) || value < 0) throw new Error('Chaque coût doit être un nombre positif ou nul.');
          await workspace.jsonRequest(options.fetch, `${endpoint}/cost-components/${encodeURIComponent(input.dataset.variableCostInput)}/update`, {
            method: 'POST',
            body: { default_value: value, source: 'economic_cockpit_variable_cost_panel' },
          });
        }
        closePanel();
        await rootObject.KomerceCanonicalPricingWorkspace.mount(options);
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        save.disabled = false;
        save.textContent = 'Enregistrer les coûts';
      }
    });

    doc.body.appendChild(overlay);
    return overlay;
  }

  function bindCockpit(rootObject, workspace, options, payload, cockpit) {'''
js = js.replace(marker, "\n" + variable_panel, 1)

old_click = """      if (openCosts) {\n        const detailKey = openCosts.dataset.openCostDetail;\n        if (detailKey === 'fixed-direct' || detailKey === 'fixed-mutualized') {\n          await openStructureEventForm(rootObject, doc, workspace, options, detailKey);\n          return;\n        }\n        advanced.open = true;\n        advanced.scrollIntoView?.({ behavior: 'smooth', block: 'start' });\n        return;\n      }"""
new_click = """      if (openCosts) {\n        const detailKey = openCosts.dataset.openCostDetail;\n        if (detailKey === 'variable') {\n          await openVariableCostPanel(rootObject, doc, workspace, options, payload);\n          return;\n        }\n        if (detailKey === 'fixed-direct' || detailKey === 'fixed-mutualized') {\n          await openStructureEventForm(rootObject, doc, workspace, options, detailKey);\n          return;\n        }\n        return;\n      }"""
assert old_click in js, 'old openCosts block not found'
js = js.replace(old_click, new_click, 1)

start = "    const slot = workshop.querySelector('[data-section-slot]') || workshop.querySelector('.kmc-section-body') || workshop;"
end = "    const portfolio = cockpit.querySelector('[data-cockpit-portfolio]');"
si = js.find(start)
ei = js.find(end, si)
assert si != -1 and ei != -1, 'enhance legacy composition block not found'
replacement = """    let decision = null;\n    try { decision = await fetchDecision(workspace, options); } catch (_) { decision = null; }\n    const cockpit = buildCockpit(options.document, options.root, payload, options.requestedMarket || payload.scope?.market_code || 'Marché', decision, options.user);\n\n    // Contrat exclusif : le mock approuvé EST l'Atelier économique.\n    // pricing-workspace.js reste un fournisseur de données/actions serveur,\n    // jamais une seconde surface visible ni un tiroir avancé.\n    options.root.replaceChildren(cockpit);\n    options.root.dataset.pricingMockContract = 'exclusive';\n    bindCockpit(rootObject, workspace, options, payload, cockpit);\n"""
js = js[:si] + replacement + js[ei:]

assert 'outerAdvancedNodes' not in js
assert 'pricingCockpitLegacyHidden' not in js
assert 'createAdvancedDetails' not in js
assert 'advanced.open' not in js
js_path.write_text(js)

css = css_path.read_text()
if '.kmc-variable-cost-panel-form' not in css:
    css += r'''

/* Panneau dédié au bouton « Ajuster les coûts » du mock. Il ne réintroduit
   aucune rubrique du Pricing Workspace historique dans la page principale. */
.kmc-variable-cost-panel-form {
  display: grid;
  gap: 10px;
}

.kmc-variable-cost-panel-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(180px, 0.55fr);
  align-items: center;
  gap: 18px;
  padding: 12px 0;
  border-bottom: 1px solid #e6edf7;
}

.kmc-variable-cost-panel-identity,
.kmc-variable-cost-panel-control {
  display: flex;
  align-items: center;
  gap: 10px;
}

.kmc-variable-cost-panel-identity {
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
}

.kmc-variable-cost-panel-identity small,
.kmc-variable-cost-panel-control span {
  color: #64748b;
  font-size: 12px;
}

.kmc-variable-cost-panel-control input {
  width: 100%;
  min-width: 0;
  height: 40px;
  padding: 0 10px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font: inherit;
}

@media (max-width: 720px) {
  .kmc-variable-cost-panel-row { grid-template-columns: 1fr; gap: 8px; }
}
'''
css_path.write_text(css)

index = index_path.read_text()
index = index.replace('/dashboards/canonical/js/pricing-economic-cockpit.js?v=1402', '/dashboards/canonical/js/pricing-economic-cockpit.js?v=1403')
index = index.replace('/dashboards/canonical/css/pricing-economic-cockpit.css?v=1401', '/dashboards/canonical/css/pricing-economic-cockpit.css?v=1402')
index_path.write_text(index)

test = test_path.read_text()
test = test.replace("expect(index).toContain('/dashboards/canonical/js/pricing-economic-cockpit.js?v=1402');", "expect(index).toContain('/dashboards/canonical/js/pricing-economic-cockpit.js?v=1403');")
test = test.replace("expect(index).toContain('/dashboards/canonical/css/pricing-economic-cockpit.css?v=1401');", "expect(index).toContain('/dashboards/canonical/css/pricing-economic-cockpit.css?v=1402');")
old_asserts = """  expect(source).toContain('outerAdvancedNodes');\n  expect(source).toContain(\"node.dataset.pricingCockpitLegacyHidden = ''\");\n  expect(source).toContain(\"workshop.dataset.pricingCockpitPrimary = ''\");"""
new_asserts = """  expect(source).toContain('options.root.replaceChildren(cockpit)');\n  expect(source).toContain(\"options.root.dataset.pricingMockContract = 'exclusive'\");\n  expect(source).not.toContain('outerAdvancedNodes');\n  expect(source).not.toContain('pricingCockpitLegacyHidden');\n  expect(source).not.toContain('createAdvancedDetails');\n  expect(source).not.toContain('advanced.open');"""
assert old_asserts in test, 'old exclusivity assertions not found'
test = test.replace(old_asserts, new_asserts, 1)
test = test.replace("test('Ajuster les charges et Gérer les mutualisations ouvrent un formulaire séparé, jamais inline', () => {", "test('les trois actions de coûts du mock ouvrent des panneaux séparés, jamais une ancienne rubrique inline', () => {")
needle = "  // Le vieux comportement (scroller vers les détails avancés de la même page)\n  // ne doit plus s'appliquer à fixed-direct / fixed-mutualized.\n"
replacement_test = """  // Le mock est exclusif : même les coûts variables passent par un panneau dédié.\n  expect(source).toContain(\"detailKey === 'variable'\");\n  expect(source).toContain('await openVariableCostPanel(rootObject, doc, workspace, options, payload)');\n  expect(source).toContain('data-variable-cost-input');\n\n  // Les charges structurelles utilisent leur panneau événementiel séparé.\n"""
assert needle in test, 'old action comment not found'
test = test.replace(needle, replacement_test, 1)
test_path.write_text(test)
