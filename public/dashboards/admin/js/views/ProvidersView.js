/**
 * @komerce-arch
 * @role          admin-provider-control-center
 * @domain        admin-dashboard
 * @layer         ui-page
 * @criticality   high
 * @inputs        canonical sourcing workspace sources, connectors, certification contract
 * @outputs       provider operational controls
 * @depends       api-client.js
 * @used-by       public/dashboards/admin/js/app.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      source_autopilot_is_explicit_operator_authority
 * @impact-areas  sourcing, catalog, admin-dashboard
 * @version       2026-09
 */
'use strict';
(function(global){
 const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 function styles(){if(document.getElementById('provider-control-styles'))return;const s=document.createElement('style');s.id='provider-control-styles';s.textContent=`
 .pc-head{display:flex;justify-content:space-between;gap:16px;align-items:end;margin-bottom:18px}.pc-sub{color:var(--text-secondary);font-size:13px}
 .pc-table{width:100%;border-collapse:separate;border-spacing:0;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;overflow:hidden}
 .pc-table th,.pc-table td{padding:12px 14px;border-bottom:1px solid var(--border);text-align:left;font-size:13px}.pc-table th{color:var(--text-secondary);font-size:11px;text-transform:uppercase;letter-spacing:.4px}.pc-table tr:last-child td{border-bottom:0}
 .pc-provider{font-weight:700}.pc-ref{font-size:11px;color:var(--text-secondary);margin-top:2px}.pc-pill{display:inline-flex;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:700}.pc-ok{background:#dcfce7;color:#166534}.pc-off{background:var(--bg-secondary);color:#64748b}.pc-warn{background:#fef3c7;color:#92400e}
 .pc-switch{position:relative;width:42px;height:24px;border:0;border-radius:999px;background:#cbd5e1;cursor:pointer;transition:.15s}.pc-switch:after{content:'';position:absolute;width:18px;height:18px;left:3px;top:3px;background:white;border-radius:50%;transition:.15s;box-shadow:0 1px 3px #0003}.pc-switch.on{background:#16a34a}.pc-switch.on:after{transform:translateX(18px)}.pc-switch:disabled{opacity:.45;cursor:not-allowed}
 .pc-note{margin-top:14px;padding:11px 13px;background:var(--bg-secondary);border-radius:8px;color:var(--text-secondary);font-size:12px}.pc-empty{padding:32px;text-align:center;color:var(--text-secondary)}
 `;document.head.appendChild(s)}
 function providerName(source){return source.provider_name||source.provider||source.supplier_name||source.name||source.source_ref||'Provider'}
 function render(container){styles();container.innerHTML='<div class="kmc-loading">Chargement des fournisseurs catalogue…</div>';global.KmcApi.getSourcingWorkspace().then(data=>{
  const sources=Array.isArray(data.sources)?data.sources:[];const connectors=Array.isArray(data.connectors)?data.connectors:[];
  let html=`<div class="pc-head"><div><h2>🔌 Fournisseurs catalogue</h2><div class="pc-sub">Provider Control Center · connexion, autorité d’ingestion et état opérationnel</div></div><span class="pc-pill pc-ok">Contrat pipeline 46 scénarios</span></div>`;
  if(!sources.length) html+='<div class="pc-empty">Aucune source fournisseur enregistrée.</div>';else{html+='<table class="pc-table"><thead><tr><th>Fournisseur</th><th>Connexion</th><th>Runtime</th><th>Dernière capture</th><th>Ingestion auto</th><th>État</th></tr></thead><tbody>';
   for(const source of sources){const ref=source.source_ref;const on=Boolean(source.autopilot_enabled);const name=providerName(source);const connected=Boolean(source.connector_ready);const runtime=Boolean(source.runtime_enabled);const capture=source.last_capture_status||'jamais';const captureClass=capture==='complete'?'pc-ok':capture==='failed'?'pc-warn':'pc-off';
    html+=`<tr><td><div class="pc-provider">${esc(name)}</div><div class="pc-ref">${esc(ref||'—')}</div></td><td><span class="pc-pill ${connected?'pc-ok':'pc-warn'}">${connected?'Disponible':'À vérifier'}</span></td><td><button class="pc-switch ${on?'on':''}" role="switch" aria-checked="${on}" data-source-ref="${esc(ref)}" data-enabled="${on}" ${ref?'':'disabled'} title="${on?'Désactiver':'Activer'} l’ingestion automatique"></button></td><td><span class="pc-pill ${on?'pc-ok':'pc-off'}">${on?'ACTIF':'ARRÊTÉ'}</span></td></tr>`;
   }html+='</tbody></table>'}
  html+='<div class="pc-note"><strong>Certification :</strong> le contrat déterministe 46 scénarios est un prérequis de plateforme. L’état opérationnel ci-dessus reste distinct : connexion, runtime et dernière capture sont lus du backend en temps réel.</div><div class="pc-note">Couper une source arrête les nouvelles ingestions automatiques. Cela ne supprime ni les produits, ni les candidats, ni les preuves déjà persistées.</div>';container.innerHTML=html;
  container.querySelectorAll('.pc-switch[data-source-ref]').forEach(btn=>btn.addEventListener('click',async()=>{const ref=btn.dataset.sourceRef;const enabled=btn.dataset.enabled==='true';btn.disabled=true;try{await global.KmcApi.setSourcingSourceAutopilot(ref,!enabled);render(container)}catch(e){btn.disabled=false;alert('❌ '+(e.message||e))}}));
 }).catch(e=>container.innerHTML='<div class="kmc-error">Erreur Provider Control Center : '+esc(e.message||e)+'</div>')}
 function ProvidersView(){this.render=render} global.ProvidersView=ProvidersView;
})(window);
