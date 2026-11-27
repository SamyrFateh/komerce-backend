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

  async function mountStagingAdminTools(doc, configurationGroup) {
    if (!configurationGroup || global.location?.pathname !== '/admin/golden-e2e' || typeof global.fetch !== 'function') return false;

    try {
      // Fail closed: le lien de maintenance n'est projeté que lorsque
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
      tools.appendChild(textNode(doc,'p','muted','Les opérations globales Reset/Seed passent exclusivement par le workflow gouverné, avec verrou partagé G6. Exporter les preuves et terminer les recettes manuelles avant toute remise à zéro.'));
      const link=textNode(doc,'a','btn','Ouvrir le workflow de maintenance STAGING ↗');
      link.href='https://github.com/SamyrFateh/komerce-backend/actions/workflows/staging-reset.yml';
      link.target='_blank';link.rel='noopener noreferrer';
      tools.appendChild(link);
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
