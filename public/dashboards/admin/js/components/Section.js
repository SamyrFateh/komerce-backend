/**
 * @komerce-arch
 * @role          admin-dashboard-section-component
 * @domain        admin-dashboard
 * @layer         ui-component
 * @criticality   low
 * @inputs        title, content, state
 * @outputs       page-section_dom
 * @depends       components/UI.js
 * @used-by       future SchemaDashboard renderer
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      none
 * @impact-areas  admin-dashboard, dashboard-layout
 * @version       2026-08
 */

'use strict';
/**
 * KOMERCE Dashboard — Section primitive
 *
 * Formalise le markup `.page-section` existant sans créer de convention CSS.
 */
(function (global) {
  'use strict';

  const STATES = new Set(['loading', 'empty', 'error']);

  function stateElement(state, message) {
    if (!state) return null;
    if (!STATES.has(state)) throw new Error(`Section: état inconnu: ${state}`);
    if (!global.UIState) throw new Error('Section requiert UIState pour rendre un état');

    if (state === 'loading') return global.UIState.loadingState(message);
    if (state === 'empty') return global.UIState.emptyState(message);
    return global.UIState.errorState(message);
  }

  function appendContent(slot, content) {
    if (content == null) return;
    if (content instanceof HTMLElement) {
      slot.appendChild(content);
      return;
    }
    if (typeof content === 'function') {
      const rendered = content(slot);
      if (rendered instanceof HTMLElement && rendered.parentNode !== slot) slot.appendChild(rendered);
      return;
    }
    slot.textContent = String(content);
  }

  function create(options = {}) {
    const section = document.createElement('section');
    section.className = 'page-section';

    if (options.title) {
      const title = document.createElement('h2');
      title.className = 'page-section-title';
      title.textContent = String(options.title);
      section.appendChild(title);
    }

    const slot = document.createElement('div');
    slot.setAttribute('data-section-slot', '');

    const state = stateElement(options.state, options.message);
    if (state) slot.appendChild(state);
    else appendContent(slot, options.content);

    section.appendChild(slot);
    return { element: section, slot };
  }

  function render(container, options = {}) {
    if (!container || typeof container.appendChild !== 'function') {
      throw new Error('Section: container invalide');
    }
    const built = create(options);
    container.appendChild(built.element);
    return built;
  }

  global.Section = { create, render };
})(window);
