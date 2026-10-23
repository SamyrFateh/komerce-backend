/**
 * @komerce-arch
 * @role          canonical-market-prompt
 * @domain        dashboard
 * @layer         ui-component
 * @criticality   medium
 * @inputs        explicit_market_state, allowed_markets
 * @outputs       market_prompt_dom
 * @depends       market
 * @used-by       canonical admin shell, market-autonomy, market-catalog
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      explicit_market_context, server_market_scope_is_authority
 * @impact-areas  admin-dashboard, market-authorization
 * @version       2026-10
 */

'use strict';

(function initMarketPrompt(root, factory) {
  const api = factory();
  /* istanbul ignore else -- CommonJS sous Jest, global navigateur en production. */
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  /* istanbul ignore else -- exercé par le navigateur, sans branche métier. */
  if (root) root.KomerceMarketPrompt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMarketPrompt() {
  // Composant d'invite unique « Choisir un marché » (L1). Aucun calcul métier, aucune requête.
  // Message seul : le sélecteur du shell reste le seul sélecteur visible.
  function messageFor(state, requested) {
    if (state === 'unauthorized') {
      return `Le marché « ${requested} » n’est pas autorisé pour ce compte. Choisissez un marché autorisé.`;
    }
    if (state === 'no_access') {
      return 'Aucun marché n’est autorisé pour ce compte. Contactez un administrateur.';
    }
    return 'Choisissez un marché pour afficher cet écran. Aucune donnée marché n’est chargée avant ce choix.';
  }

  function render(doc, container, options) {
    const state = options.state;
    const node = doc.createElement('section');
    node.className = 'kmc-market-prompt';
    node.setAttribute('data-market-prompt', state);
    node.setAttribute('role', 'status');

    const title = doc.createElement('strong');
    title.className = 'kmc-market-prompt-title';
    title.textContent = state === 'no_access' ? 'Accès indisponible' : 'Choisir un marché';
    node.appendChild(title);

    const text = doc.createElement('p');
    text.className = 'kmc-market-prompt-text';
    text.textContent = messageFor(state, options.requested);
    node.appendChild(text);

    container.appendChild(node);
    return node;
  }

  return Object.freeze({ messageFor, render });
});
