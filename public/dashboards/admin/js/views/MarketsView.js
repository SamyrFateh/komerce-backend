/**
 * @komerce-arch
 * @role          admin-markets-control-plane-view
 * @domain        admin-dashboard
 * @layer         ui-page
 * @criticality   high
 * @inputs        Market Control Plane APIs
 * @outputs       canonical market creation and lifecycle UI
 * @depends       api-client.js
 * @used-by       admin SPA /admin/markets
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      ui_never_authority, provisioning_before_activation
 * @impact-areas  admin-dashboard, market-control-plane
 * @version       2026-10-v1
 */
'use strict';

(function (global) {
  'use strict';

  const LIMIT_CAPS = [
    ['execution.cash.confirm','Confirmation cash'],
    ['settlement.receive','Réception settlement'],
    ['finance.act','Action finance'],
  ];

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  function styles() {
    if (document.getElementById('markets-view-styles')) return;
    const el=document.createElement('style');
    el.id='markets-view-styles';
    el.textContent=`
      .mv-wrap{max-width:1180px;margin:0 auto}.mv-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:18px}
      .mv-head h2{font-size:24px;margin:0;color:var(--text-primary)}.mv-muted{color:var(--text-secondary);font-size:13px}
      .mv-grid{display:grid;grid-template-columns:1fr 1.35fr;gap:18px;align-items:start}.mv-card{background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:18px}
      .mv-card h3{margin:0 0 14px;color:var(--text-primary)}.mv-list{display:grid;gap:8px}.mv-market{border:1px solid var(--border);border-radius:10px;padding:12px;cursor:pointer;display:flex;justify-content:space-between;gap:12px}
      .mv-market:hover{border-color:#3b82f6}.mv-badge{font-size:11px;font-weight:800;padding:4px 8px;border-radius:999px;background:var(--bg-secondary)}
      .mv-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.mv-field{display:flex;flex-direction:column;gap:5px}.mv-field.full{grid-column:1/-1}
      .mv-field label{font-size:12px;font-weight:700;color:var(--text-secondary)}.mv-field input,.mv-field select,.mv-field textarea{padding:9px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);color:var(--text-primary);font-family:inherit}
      .mv-section{grid-column:1/-1;border-top:1px solid var(--border);padding-top:12px;margin-top:3px}.mv-section strong{color:var(--text-primary);font-size:13px}
      .mv-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}.mv-btn{border:0;border-radius:8px;padding:10px 15px;font-weight:700;cursor:pointer}.mv-primary{background:#3b82f6;color:white}.mv-success{background:#16a34a;color:white}
      .mv-status{margin-top:14px;border-radius:10px;padding:12px;background:var(--bg-secondary);font-size:13px}.mv-ready{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}.mv-pill{padding:5px 9px;border-radius:999px;font-weight:700;font-size:12px}.mv-ok{background:#dcfce7;color:#166534}.mv-no{background:#fee2e2;color:#991b1b}
      @media(max-width:900px){.mv-grid{grid-template-columns:1fr}.mv-fields{grid-template-columns:1fr}}
    `;
    document.head.appendChild(el);
  }

  function centralOptions(authority) {
    const seen=new Map();
    (authority?.domains||[]).forEach(d => (d.holders||[]).forEach(h => {
      const id=String(h.user_id);
      if(!seen.has(id)) seen.set(id,[]);
      seen.get(id).push(d.domain);
    }));
    return [...seen.entries()].map(([id,domains]) =>
      `<option value="${esc(id)}">${esc(id)} — ${esc(domains.join(', '))}</option>`
    ).join('');
  }

  function renderMarkets(root, markets) {
    const list=root.querySelector('#mv-market-list');
    if(!markets.length){list.innerHTML='<div class="mv-muted">Aucun marché.</div>';return;}
    list.innerHTML=markets.map(m=>`
      <div class="mv-market" data-code="${esc(m.code)}">
        <div><strong>${esc(m.code)} · ${esc(m.name)}</strong><div class="mv-muted">${esc(m.currency)} · ${Number(m.active_members||0)} membre(s)</div></div>
        <span class="mv-badge">${esc(m.lifecycle_status||'—')}</span>
      </div>`).join('');
    list.querySelectorAll('.mv-market').forEach(el=>el.addEventListener('click',()=>showControl(root,el.dataset.code)));
  }

  async function showControl(root, code) {
    const box=root.querySelector('#mv-status');
    box.innerHTML='Chargement…';
    try{
      const c=await global.KmcApi.getMarketControlPlane(code);
      const r=c.readiness||{};
      box.innerHTML=`
        <strong>${esc(code)} — ${esc(c.market?.lifecycle_status||'')}</strong>
        <div class="mv-ready">
          <span class="mv-pill ${r.platform?.ready?'mv-ok':'mv-no'}">Plate-forme ${r.platform?.ready?'✓':'✕'}</span>
          <span class="mv-pill ${r.operations?.ready?'mv-ok':'mv-no'}">Exploitation ${r.operations?.ready?'✓':'✕'}</span>
        </div>
        ${r.ready_for_activation && c.market.lifecycle_status!=='ACTIVE'
          ? '<div class="mv-actions"><button class="mv-btn mv-success" id="mv-activate">Activer le marché</button></div>' : ''}
        <div class="mv-muted" style="margin-top:8px">${(c.gaps||[]).map(g=>esc(g.message)).join(' · ')||'Aucun écart.'}</div>`;
      const btn=box.querySelector('#mv-activate');
      if(btn) btn.addEventListener('click',async()=>{
        btn.disabled=true;
        try{await global.KmcApi.setMarketLifecycle(code,'ACTIVE'); await load(root); await showControl(root,code);}
        catch(e){box.insertAdjacentHTML('beforeend',`<div style="color:#dc2626;margin-top:8px">${esc(e.message)}</div>`);}
      });
    }catch(e){box.innerHTML=`<span style="color:#dc2626">${esc(e.message)}</span>`;}
  }

  function payload(form) {
    const fd=new FormData(form);
    const limits={};
    LIMIT_CAPS.forEach(([cap])=>{limits[cap]=Number(fd.get('limit_'+cap));});
    return {
      code:String(fd.get('code')||'').trim().toUpperCase(),
      name:String(fd.get('name')||'').trim(),
      currency:String(fd.get('currency')||'').trim().toUpperCase(),
      minor_unit:Number(fd.get('minor_unit')||0),
      central_referent_user_id:String(fd.get('central_referent_user_id')||''),
      storefront_texts:{ welcome:String(fd.get('storefront_welcome')||'').trim() },
      financial_limits:limits,
      lead:{
        email:String(fd.get('lead_email')||'').trim()||null,
        phone:String(fd.get('lead_phone')||'').trim()||null,
        channel:String(fd.get('lead_channel')||'EMAIL'),
      },
      payment_provider:{
        provider:String(fd.get('payment_provider')||''),
        currency:String(fd.get('currency')||'').trim().toUpperCase(),
        priority:10,
      },
      cash_policy:{
        cash_enabled:fd.get('cash_enabled')==='true',
        confirmation_mode:String(fd.get('confirmation_mode')||'SINGLE'),
      },
      initial_relais:{
        name:String(fd.get('relay_name')||'').trim(),
        agent_name:String(fd.get('relay_agent')||'').trim()||null,
        phone:String(fd.get('relay_phone')||'').trim(),
        address:String(fd.get('relay_address')||'').trim(),
        island:String(fd.get('relay_island')||'').trim()||null,
      },
    };
  }

  async function load(root) {
    const [markets, authority]=await Promise.all([
      global.KmcApi.getMarkets(),
      global.KmcApi.getMarketCentralAuthority(),
    ]);
    renderMarkets(root,markets.markets||[]);
    root.querySelector('#mv-central').innerHTML='<option value="">Choisir…</option>'+centralOptions(authority);
  }

  global.MarketsView=async function(root){
    styles();
    root.innerHTML=`
      <div class="mv-wrap">
        <div class="mv-head"><div><h2>🌍 Marchés</h2><div class="mv-muted">Créer, préparer et activer un marché depuis le Control Plane canonique.</div></div></div>
        <div class="mv-grid">
          <section class="mv-card"><h3>Marchés existants</h3><div id="mv-market-list" class="mv-list">Chargement…</div><div id="mv-status" class="mv-status">Sélectionnez un marché pour voir sa readiness.</div></section>
          <section class="mv-card"><h3>Créer un nouveau marché</h3>
            <form id="mv-form" class="mv-fields">
              <div class="mv-field"><label>Code marché</label><input name="code" maxlength="2" required placeholder="GA"></div>
              <div class="mv-field"><label>Nom</label><input name="name" required placeholder="Gabon"></div>
              <div class="mv-field"><label>Devise</label><input name="currency" maxlength="3" required placeholder="XAF"></div>
              <div class="mv-field"><label>Décimales devise</label><input name="minor_unit" type="number" min="0" max="4" value="0" required></div>
              <div class="mv-section"><strong>Gouvernance</strong></div>
              <div class="mv-field full"><label>Référent central</label><select id="mv-central" name="central_referent_user_id" required></select></div>
              <div class="mv-field"><label>Email responsable</label><input name="lead_email" type="email" required></div>
              <div class="mv-field"><label>Canal invitation</label><select name="lead_channel"><option>EMAIL</option><option>WHATSAPP</option></select></div>
              <div class="mv-field full"><label>Téléphone responsable (E.164, requis si WhatsApp)</label><input name="lead_phone" placeholder="+241…"></div>
              <div class="mv-section"><strong>Limites financières par opération</strong></div>
              ${LIMIT_CAPS.map(([cap,label])=>`<div class="mv-field"><label>${esc(label)} · ${esc(cap)}</label><input name="limit_${esc(cap)}" type="number" min="0" step="0.01" required></div>`).join('')}
              <div class="mv-section"><strong>Paiement & caisse</strong></div>
              <div class="mv-field"><label>Provider paiement</label><select name="payment_provider"><option value="orange_money">Orange Money</option><option value="mtn_momo">MTN MoMo</option></select></div>
              <div class="mv-field"><label>Cash</label><select name="cash_enabled"><option value="true">Activé</option><option value="false">Désactivé</option></select></div>
              <div class="mv-field"><label>Confirmation cash</label><select name="confirmation_mode"><option>SINGLE</option><option>DUAL_ALWAYS</option></select></div>
              <div class="mv-field"><label>Texte boutique</label><input name="storefront_welcome" placeholder="Bienvenue…"></div>
              <div class="mv-section"><strong>Premier relais</strong></div>
              <div class="mv-field"><label>Nom</label><input name="relay_name" required></div>
              <div class="mv-field"><label>Agent</label><input name="relay_agent"></div>
              <div class="mv-field"><label>Téléphone</label><input name="relay_phone" required></div>
              <div class="mv-field"><label>Adresse</label><input name="relay_address" required></div>
              <div class="mv-field full"><label>Île / zone historique (optionnel)</label><input name="relay_island"></div>
              <div class="mv-actions full"><button class="mv-btn mv-primary" type="submit">Créer le marché</button></div>
            </form>
            <div id="mv-create-result"></div>
          </section>
        </div>
      </div>`;
    const form=root.querySelector('#mv-form');
    form.addEventListener('submit',async e=>{
      e.preventDefault();
      const out=root.querySelector('#mv-create-result');
      const btn=form.querySelector('button[type=submit]');
      btn.disabled=true; out.className='mv-status'; out.textContent='Provisioning en cours…';
      try{
        const res=await global.KmcApi.provisionMarket(payload(form));
        const ready=res.readiness||{};
        out.innerHTML=`<strong>${esc(res.market.code)} créé en PROVISIONING</strong>
          <div class="mv-ready"><span class="mv-pill ${ready.platform?.ready?'mv-ok':'mv-no'}">Plate-forme ${ready.platform?.ready?'✓':'✕'}</span>
          <span class="mv-pill ${ready.operations?.ready?'mv-ok':'mv-no'}">Exploitation ${ready.operations?.ready?'✓':'✕'}</span></div>
          <div class="mv-muted" style="margin-top:8px">${(res.gaps||[]).map(g=>esc(g.message)).join(' · ')||'Prêt à activer.'}</div>`;
        form.reset(); await load(root); await showControl(root,res.market.code);
      }catch(err){out.innerHTML=`<span style="color:#dc2626">❌ ${esc(err.message)}</span>`;}
      finally{btn.disabled=false;}
    });
    try{await load(root);}catch(err){root.querySelector('#mv-market-list').innerHTML=`<span style="color:#dc2626">${esc(err.message)}</span>`;}
  };
})(window);
