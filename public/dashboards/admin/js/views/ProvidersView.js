/**
 * @komerce-arch
 * @role          admin-provider-control-center
 * @domain        admin-dashboard
 * @layer         ui-page
 * @criticality   high
 * @inputs        canonical sourcing workspace sources, connectors, persisted provider capability policy, provider runtime certification status
 * @outputs       provider operational controls
 * @depends       api-client.js
 * @used-by       public/dashboards/admin/js/app.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      provider_capabilities_are_backend_authority, provider_runtime_certification_is_backend_truth, source_autopilot_is_explicit_operator_authority
 * @impact-areas  sourcing, catalog, admin-dashboard
 * @version       2026-09
 */
'use strict';
(function(global){
 const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 const CAPABILITIES=[
  ['discovery','Découverte','discovery_enabled'],
  ['sync','Sync','sync_enabled'],
  ['import','Import','import_enabled'],
  ['production','Production','production_enabled'],
 ];
 function styles(){if(document.getElementById('provider-control-styles'))return;const s=document.createElement('style');s.id='provider-control-styles';s.textContent=`
 .pc-head{display:flex;justify-content:space-between;gap:16px;align-items:end;margin-bottom:18px}.pc-sub{color:var(--text-secondary);font-size:13px}
 .pc-table{width:100%;border-collapse:separate;border-spacing:0;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;overflow:hidden}
 .pc-table th,.pc-table td{padding:12px 14px;border-bottom:1px solid var(--border);text-align:left;font-size:13px;vertical-align:middle}.pc-table th{color:var(--text-secondary);font-size:11px;text-transform:uppercase;letter-spacing:.4px}.pc-table tr:last-child td{border-bottom:0}
 .pc-provider{font-weight:700}.pc-ref{font-size:11px;color:var(--text-secondary);margin-top:2px}.pc-pill{display:inline-flex;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:700}.pc-ok{background:#dcfce7;color:#166534}.pc-off{background:var(--bg-secondary);color:#64748b}.pc-warn{background:#fef3c7;color:#92400e}
 .pc-switch{position:relative;width:42px;height:24px;border:0;border-radius:999px;background:#cbd5e1;cursor:pointer;transition:.15s;flex:0 0 auto}.pc-switch:after{content:'';position:absolute;width:18px;height:18px;left:3px;top:3px;background:white;border-radius:50%;transition:.15s;box-shadow:0 1px 3px #0003}.pc-switch.on{background:#16a34a}.pc-switch.on:after{transform:translateX(18px)}.pc-switch:disabled{opacity:.45;cursor:not-allowed}
 .pc-capabilities{display:grid;grid-template-columns:repeat(2,minmax(118px,1fr));gap:8px 12px;min-width:270px}.pc-cap{display:flex;align-items:center;justify-content:space-between;gap:8px}.pc-cap-label{font-size:11px;font-weight:700;color:var(--text-secondary)}.pc-cap-copy{display:flex;flex-direction:column;gap:2px}.pc-cert{font-size:9px;font-weight:700}.pc-cert.is-ok{color:#166534}.pc-cert.is-pending{color:#92400e}
 .pc-note{margin-top:14px;padding:11px 13px;background:var(--bg-secondary);border-radius:8px;color:var(--text-secondary);font-size:12px}.pc-empty{padding:32px;text-align:center;color:var(--text-secondary)}
 `;document.head.appendChild(s)}
 function providerName(source){return source.provider_name||source.provider||source.supplier_name||source.name||source.source_ref||'Provider'}
 function errorMessage(error){try{const body=JSON.parse(error?.body||'{}');return body.error||error.message||String(error)}catch(_){return error?.message||String(error)}}
 function capabilityControls(source){
  const runtimeCertified=Boolean(source.production_runtime_certified);
  return CAPABILITIES.map(([capability,label,field])=>{
   const on=Boolean(source[field]);
   const isProduction=capability==='production';
   const title=isProduction&&!runtimeCertified?'Import API CANONICAL_RESOLVED requis avant activation Production':'';
   const lockProduction=isProduction&&!runtimeCertified&&!on;
   const certification=isProduction
    ? `<span class="pc-cert ${runtimeCertified?'is-ok':'is-pending'}">${runtimeCertified?'RUNTIME CERTIFIÉ':'À CERTIFIER'}</span>`
    : '';
   return `<div class="pc-cap"><span class="pc-cap-copy"><span class="pc-cap-label" title="${esc(title)}">${esc(label)}</span>${certification}</span><button class="pc-switch ${on?'on':''}" role="switch" aria-label="${esc(label)}" aria-checked="${on}" data-source-ref="${esc(source.source_ref||'')}" data-capability="${capability}" data-enabled="${on}" ${source.source_ref&&!lockProduction?'':'disabled'} title="${esc(title||((on?'Désactiver ':'Activer ')+label))}"></button></div>`;
  }).join('');
 }
 function render(container){styles();container.innerHTML='<div class="kmc-loading">Chargement des fournisseurs catalogue…</div>';global.KmcApi.getSourcingWorkspace().then(data=>{
  const sources=Array.isArray(data.sources)?data.sources:[];
  let html=`<div class="pc-head"><div><h2>🔌 Fournisseurs catalogue</h2><div class="pc-sub">Provider Control Center · connexion, permissions d’ingestion et état opérationnel</div></div></div>`;
  if(!sources.length) html+='<div class="pc-empty">Aucune source fournisseur enregistrée.</div>';else{html+='<table class="pc-table"><thead><tr><th>Fournisseur</th><th>Connexion</th><th>Runtime</th><th>Dernière capture</th><th>Autorisations</th><th>Autopilot</th></tr></thead><tbody>';
   for(const source of sources){const ref=source.source_ref;const on=Boolean(source.autopilot_enabled);const name=providerName(source);const connected=Boolean(source.connector_ready);const runtime=Boolean(source.runtime_enabled);const capture=source.last_capture_status||'jamais';const captureClass=capture==='complete'?'pc-ok':capture==='failed'?'pc-warn':'pc-off';
    html+=`<tr><td><div class="pc-provider">${esc(name)}</div><div class="pc-ref">${esc(ref||'—')}</div></td><td><span class="pc-pill ${connected?'pc-ok':'pc-warn'}" title="${esc(source.connector_reason||'')}">${connected?'CONNECTÉ':'NON PRÊT'}</span></td><td><span class="pc-pill ${runtime?'pc-ok':'pc-off'}">${runtime?'ON':'OFF'}</span></td><td><span class="pc-pill ${captureClass}">${esc(capture)}</span><div class="pc-ref">${esc(source.last_capture_at||'')}</div></td><td><div class="pc-capabilities">${capabilityControls(source)}</div></td><td><button class="pc-switch ${on?'on':''}" role="switch" aria-label="Autopilot" aria-checked="${on}" data-source-ref="${esc(ref)}" data-autopilot="true" data-enabled="${on}" ${ref?'':'disabled'} title="${on?'Désactiver':'Activer'} l’autopilot"></button><div class="pc-ref">${on?'ACTIF':'ARRÊTÉ'}</div></td></tr>`;
   }html+='</tbody></table>'}
  html+='<div class="pc-note"><strong>Permissions fournisseur :</strong> Découverte, Sync, Import et Production viennent directement de la politique persistée côté backend. Production reste refusée tant qu’aucune preuve runtime fournisseur durable n’est disponible ; l’état RUNTIME CERTIFIÉ / À CERTIFIER vient directement du backend.</div><div class="pc-note">L’autopilot est un interrupteur séparé : même activé, il ne peut tourner que si les quatre permissions fournisseur sont autorisées.</div>';container.innerHTML=html;
  container.querySelectorAll('.pc-switch[data-capability]').forEach(btn=>btn.addEventListener('click',async()=>{const ref=btn.dataset.sourceRef;const capability=btn.dataset.capability;const enabled=btn.dataset.enabled==='true';const next=!enabled;const reason=prompt('Motif opérateur',`Provider Control Center · ${capability} ${next?'ON':'OFF'}`);if(!reason||!reason.trim())return;btn.disabled=true;try{await global.KmcApi.setSourcingSourceCapability(ref,capability,next,reason.trim());render(container)}catch(e){btn.disabled=false;alert('❌ '+errorMessage(e))}}));
  container.querySelectorAll('.pc-switch[data-autopilot]').forEach(btn=>btn.addEventListener('click',async()=>{const ref=btn.dataset.sourceRef;const enabled=btn.dataset.enabled==='true';btn.disabled=true;try{await global.KmcApi.setSourcingSourceAutopilot(ref,!enabled);render(container)}catch(e){btn.disabled=false;alert('❌ '+errorMessage(e))}}));
 }).catch(e=>container.innerHTML='<div class="kmc-error">Erreur Provider Control Center : '+esc(errorMessage(e))+'</div>')}
 function ProvidersView(){this.render=render} global.ProvidersView=ProvidersView;
})(window);
