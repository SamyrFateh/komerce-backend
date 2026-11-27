/**
 * @komerce-arch-lite
 * @role          golden-recipe-staging-tools
 * @domain        dashboard
 * @layer         ui
 * @purpose       Isolate destructive staging utilities from all product shells.
 * @impact-areas  dashboard, recipe, authorization
 */
'use strict';
(function(global){
  function textNode(doc,tag,cls,value){const node=doc.createElement(tag);node.className=cls;node.textContent=value;return node;}
  function runtimeIsStaging(payload) {
    return String(payload && payload.komerce_env || '').trim().toLowerCase() === 'staging';
  }

  async function postStagingAdminAction(path, body) {
    const response = await global.fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    let payload = {};
    try { payload = await response.json(); } catch (_) { /* réponse non JSON */ }
    if (!response.ok) {
      throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
    }
    return payload;
  }

  async function mountStagingAdminTools(doc, configurationGroup) {
    if (!configurationGroup || global.location?.pathname !== '/admin/golden-e2e' || typeof global.fetch !== 'function') return false;

    try {
      // Fail closed: les outils destructifs ne sont projetés que lorsque
      // le serveur lui-même déclare KOMERCE_ENV=staging.
      const response = await global.fetch('/health', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return false;
      const runtime = await response.json();
      if (!runtimeIsStaging(runtime)) return false;
      const identity = await global.fetch('/api/auth/me', {credentials:'include',headers:{Accept:'application/json'}});
      if (!identity.ok || (await identity.json()).role !== 'admin') return false;

      const tools = doc.createElement('div');
      tools.className = 'kmc-admin-staging-tools';
      tools.setAttribute('data-staging-tools', 'true');

      const badge = textNode(doc, 'div', 'kmc-admin-staging-badge', 'STAGING');
      tools.appendChild(badge);
      tools.appendChild(textNode(doc,'p','muted','Opérations globales de recette : elles modifient les données STAGING de tous les marchés. Exporter les preuves et arrêter les recettes concurrentes avant utilisation.'));

      const reset = textNode(doc, 'button', 'btn danger kmc-admin-staging-action is-danger', 'Reset commandes');
      reset.type = 'button';
      reset.setAttribute('data-admin-action', 'reset-orders');

      const seed = textNode(doc, 'button', 'btn kmc-admin-staging-action is-seed', 'Seed test');
      seed.type = 'button';
      seed.setAttribute('data-admin-action', 'seed-test');

      const status = textNode(doc, 'div', 'kmc-admin-staging-status', '');
      status.setAttribute('aria-live', 'polite');

      reset.addEventListener('click', async () => {
        const confirmFn = typeof global.confirm === 'function' ? global.confirm.bind(global) : null;
        if (!confirmFn || !confirmFn('Supprimer toutes les commandes et données de session de test sur STAGING ?')) return;
        reset.disabled = true;
        seed.disabled = true;
        status.className = 'kmc-admin-staging-status';
        status.textContent = 'Reset en cours…';
        try {
          const result = await postStagingAdminAction('/api/admin/reset', { mode: 'orders', confirm: true });
          status.className = 'kmc-admin-staging-status is-success';
          status.textContent = result.message || 'Reset terminé.';
        } catch (error) {
          status.className = 'kmc-admin-staging-status is-error';
          status.textContent = error.message || 'Échec du reset.';
        } finally {
          reset.disabled = false;
          seed.disabled = false;
        }
      });

      seed.addEventListener('click', async () => {
        const confirmFn = typeof global.confirm === 'function' ? global.confirm.bind(global) : null;
        if (!confirmFn || !confirmFn('Injecter les données de test sur STAGING ?')) return;
        reset.disabled = true;
        seed.disabled = true;
        status.className = 'kmc-admin-staging-status';
        status.textContent = 'Seed en cours…';
        try {
          const result = await postStagingAdminAction('/api/admin/seed-test', { confirm: true });
          status.className = 'kmc-admin-staging-status is-success';
          status.textContent = result.message || 'Seed terminé.';
        } catch (error) {
          status.className = 'kmc-admin-staging-status is-error';
          status.textContent = error.message || 'Échec du seed.';
        } finally {
          reset.disabled = false;
          seed.disabled = false;
        }
      });

      tools.appendChild(reset);
      tools.appendChild(seed);
      tools.appendChild(status);
      configurationGroup.appendChild(tools);
      return true;
    } catch (_) {
      return false;
    }
  }

  if(typeof module==='object'&&module.exports){module.exports={mountStagingAdminTools};return;}
  const doc=global.document;
  if(!doc)return;
  const container=doc.getElementById('stagingAdminTools');
  if(container)mountStagingAdminTools(doc,container).then(mounted=>{container.hidden=!mounted;});
})(typeof window!=='undefined'?window:globalThis);
