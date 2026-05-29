import{a as g,b as S,c as q,e as E,g as L,h as x}from"./chunk-43ELGPLX.js";import{b as f,d as v,e as h,k as y,l as b,t as i}from"./chunk-MECZG36V.js";var C=[{key:"pending",label:"Commande re\xE7ue",icon:"\u2713",sub:"Enregistr\xE9e avec succ\xE8s"},{key:"preparing",label:"En pr\xE9paration",icon:"\u2699\uFE0F",sub:"Nous pr\xE9parons votre colis"},{key:"in_transit",label:"En route vers le relais",icon:"\u{1F69A}",sub:""},{key:"at_relay",label:"Disponible au relais",icon:"\u{1F3EA}",sub:"Pr\xEAt \xE0 \xEAtre retir\xE9"},{key:"delivered",label:"Retir\xE9",icon:"\u2705",sub:"Commande cl\xF4tur\xE9e"}];function _(e){let r=C.findIndex(n=>n.key===e);return C.map((n,c)=>{let k=c<r;return`<div class="k-track-step">
      <div class="k-track-step-dot ${k?"done":c===r?"current":""}">${k?"\u2713":n.icon}</div>
      <div class="k-track-step-info">
        <div class="k-track-step-label">${n.label}</div>
        <div class="k-track-step-sub">${n.sub}</div>
      </div>
    </div>`}).join("")}function j(e,r){return{pending:{emoji:"\u23F3",label:"En attente",cls:"pending"},confirmed:{emoji:"\u2705",label:"Confirm\xE9e",cls:"confirmed"},paid:{emoji:"\u{1F4B0}",label:"Pay\xE9e",cls:"confirmed"},ordered:{emoji:"\u{1F6D2}",label:"En pr\xE9paration",cls:"processing"},preparation:{emoji:"\u{1F4E6}",label:"En pr\xE9paration",cls:"processing"},shipped:{emoji:"\u{1F6A2}",label:"Exp\xE9di\xE9e",cls:"shipped"},in_transit:{emoji:"\u{1F69A}",label:"En transit",cls:"shipped"},available:{emoji:"\u{1F3EA}",label:"Au relais",cls:"available"},collected:{emoji:"\u2705",label:"Retir\xE9e",cls:"delivered"},delivered:{emoji:"\u2705",label:"Livr\xE9e",cls:"delivered"},cancelled:{emoji:"\u274C",label:"Annul\xE9e",cls:"cancelled"}}[e]||{emoji:"\u{1F4E6}",label:e||"Inconnu",cls:"pending"}}function I(e){if(!e)return"";try{let r=new Date(e),n=Date.now()-r,c=Math.floor(n/(1e3*60*60*24));return c===0?"Aujourd'hui":c===1?"Hier":c<7?"Il y a "+c+" jours":r.toLocaleDateString("fr-FR",{day:"numeric",month:"short",year:"numeric"})}catch{return""}}function T(e,r){if(!e.length){r.innerHTML='<div class="k-search-empty">Aucune commande trouv\xE9e.</div>';return}r.innerHTML=e.map(n=>`
    <div class="k-order-card">
      <div class="k-order-card-head">
        <span class="k-order-ref">${n.reference||n.id}</span>
        <span class="k-order-date">${n.created_at?new Date(n.created_at).toLocaleDateString("fr-FR"):""}</span>
      </div>
      <div class="k-order-card-total">${h(n.total_amount||0,"KMF")}</div>
      <div class="k-track-steps k-track-steps--compact">${_(n.status||"pending")}</div>
    </div>`).join("")}function w(e,r){r.innerHTML=`
    <div class="k-order-card">
      <div class="k-order-card-head">
        <span class="k-order-ref">${e.reference||e.id}</span>
        <span class="k-order-date">${e.created_at?new Date(e.created_at).toLocaleDateString("fr-FR"):""}</span>
      </div>
      <div class="k-order-card-total">${h(e.total_amount||0,"KMF")}</div>
      <div class="k-track-steps">${_(e.status||"pending")}</div>
    </div>`}function $(e,r){let n='<section class="k-track-orders-panel"><h2>\u{1F4E6} Mes commandes</h2><p class="k-track-sub-hint">'+r.length+" commande"+(r.length>1?"s":"")+" trouv\xE9e"+(r.length>1?"s":"")+"</p>",c=r.map(s=>{let u=j(s.status||"pending",s.payment_status),l=h(s.total_kmf||0,"KMF"),t=I(s.created_at),a=s.product_name||"Commande",o=s.product_image_url||null,d=parseInt(s.items_count,10)||1,m=o?'<img src="'+v(f(o,100))+'" alt="" loading="lazy" decoding="async">':'<div class="k-myorder-emoji">\u{1F4E6}</div>',p=d>1?a+" + "+(d-1)+" autre"+(d>2?"s":""):a;return'<button class="k-myorder-card" data-ref="'+v(s.reference||"")+'"><div class="k-myorder-img">'+m+'</div><div class="k-myorder-body"><div class="k-myorder-ref">'+v(s.reference||"\u2014")+'</div><div class="k-myorder-items">'+v(p)+'</div><div class="k-myorder-bottom"><span class="k-myorder-status k-myorder-status--'+u.cls+'">'+u.emoji+" "+u.label+'</span><span class="k-myorder-total">'+l+'</span></div><div class="k-myorder-date">'+t+'</div></div><span class="k-myorder-arrow">\u203A</span></button>'}).join("");e.innerHTML='<div class="k-track-dashboard">'+n+'<div class="k-myorders-list">'+c+'</div><button class="k-track-btn k-track-btn--ghost k-myorders-new-search" id="k-myorders-search-other">\u{1F50D} Chercher une autre commande</button></section></div>',e.querySelectorAll(".k-myorder-card").forEach(s=>{s.addEventListener("click",async()=>{let u=s.dataset.ref;if(u){s.classList.add("k-myorder-loading");try{let l=await y("/api/orders/"+encodeURIComponent(u));e.innerHTML="";let t=document.createElement("button");t.className="k-track-btn k-track-btn--ghost",t.textContent="\u2190 Retour \xE0 mes commandes",t.addEventListener("click",()=>M()),e.appendChild(t);let a=document.createElement("div");e.appendChild(a),w(l.order||l,a)}catch{i("Impossible de charger cette commande.","error"),s.classList.remove("k-myorder-loading")}}})});let k=e.querySelector("#k-myorders-search-other");k&&k.addEventListener("click",()=>R(e))}function M(){let e=document.getElementById("k-track-view");e||(e=document.createElement("div"),e.id="k-track-view",e.className="k-track-view",(document.getElementById("k-fav-view")||document.getElementById("k-catalog-section")).after(e)),e.innerHTML='<div class="k-track-loading"><div class="k-track-loading-spin"></div><p>Chargement de vos commandes\u2026</p></div>',(async()=>{let r=await y("/api/orders?limit=20").catch(()=>null),n=Array.isArray(r)?r:r?.orders||[];if(!n.length){R(e);return}e.innerHTML="",$(e,n)})()}function R(e){let r={phone:""};e.innerHTML=`
    <div class="k-track-dashboard k-track-dashboard--search">
      <section class="k-track-orders-panel">
        <h2>\u{1F4E6} Suivi de commande</h2>

        <div id="k-track-quick">
          <p class="k-otp-hint">Entrez les 4 derniers chiffres de votre commande</p>
          <div class="k-track-form">
            <div class="k-track-ref-wrap">
              <span class="k-track-ref-prefix">KMR-2025-</span>
              <input class="k-track-input k-track-input--ref" id="k-track-digits" type="text" inputmode="numeric" placeholder="0042" maxlength="4" autocomplete="off">
            </div>
            <button class="k-track-btn" id="k-track-quick-btn">\u{1F50D} Suivre</button>
          </div>
          <div class="k-otp-divider"><span>ou</span></div>
          <button class="k-track-btn k-track-btn--ghost" id="k-track-history-toggle">\u{1F4CB} Voir tout mon historique</button>
        </div>

        <div id="k-track-otp" class="u-hidden">
          <p class="k-otp-hint">Entrez votre num\xE9ro pour recevoir un code WhatsApp et voir toutes vos commandes.</p>
          <div class="k-track-form">
            <div class="k-track-phone-wrap">
              ${x("k-otp-country","k-otp-phone","+33")}
            </div>
            <button class="k-track-btn" id="k-otp-request-btn">\u{1F4F2} Envoyer le code</button>
          </div>
          <button class="k-track-btn k-track-btn--ghost k-track-btn--mt" id="k-track-back-quick">\u2190 Suivi rapide</button>
        </div>

        <div id="k-otp-step2" class="u-hidden">
          <div class="k-otp-sent-banner">
            \u{1F4F2} Code WhatsApp envoy\xE9 au <strong id="k-otp-phone-display"></strong><br>
            <small>V\xE9rifiez vos messages WhatsApp. Code valable 10 min.</small>
          </div>
          <input class="k-otp-code-input" id="k-otp-code" type="text" inputmode="numeric" placeholder="_ _ _ _ _ _" maxlength="6" autocomplete="one-time-code">
          <button class="k-track-btn" id="k-otp-verify-btn">V\xE9rifier</button>
          <button class="k-otp-resend-btn" id="k-otp-resend-btn">Renvoyer le code</button>
        </div>

        <div id="k-otp-step3" class="u-hidden">
          <div id="k-orders-list"></div>
          <button class="k-otp-resend-btn k-otp-back-btn" id="k-otp-back-btn">\u2190 Nouvelle recherche</button>
        </div>
      </section>
      </div>`;let n=e.querySelector("#k-track-digits");n.addEventListener("input",()=>{n.value=n.value.replace(/\D/g,"").slice(0,4),n.value.length===4&&e.querySelector("#k-track-quick-btn").click()}),e.querySelector("#k-track-quick-btn").addEventListener("click",async()=>{let t=n.value.replace(/\D/g,"");if(t.length!==4){i("Entrez 4 chiffres.","error");return}let a="KMR-2025-"+t.padStart(4,"0"),o=e.querySelector("#k-track-quick-btn");o.disabled=!0,o.textContent="\u23F3 Recherche\u2026";try{let d=await y("/api/orders/"+encodeURIComponent(a));e.querySelector("#k-track-quick").classList.add("u-hidden"),e.querySelector("#k-otp-step3").classList.remove("u-hidden"),w(d.order||d,e.querySelector("#k-orders-list"))}catch{i("Commande introuvable. V\xE9rifiez les 4 chiffres.","error"),o.disabled=!1,o.textContent="\u{1F50D} Suivre"}}),e.querySelector("#k-track-history-toggle").addEventListener("click",()=>{e.querySelector("#k-track-quick").classList.add("u-hidden"),e.querySelector("#k-track-otp").classList.remove("u-hidden")}),e.querySelector("#k-track-back-quick").addEventListener("click",()=>{e.querySelector("#k-track-otp").classList.add("u-hidden"),e.querySelector("#k-track-quick").classList.remove("u-hidden")}),L("k-otp-country","k-otp-phone","+33",null);let c=e.querySelector("#k-otp-country");c&&(c.className="k-track-country");let k=e.querySelector("#k-otp-phone");k&&(k.className="k-track-input k-track-input--phone");function s(){let t=e.querySelector("#k-otp-country")?.value||"+33",a=e.querySelector("#k-otp-phone")?.value||"";return E(t,a)}function u(){let t=e.querySelector("#k-otp-country")?.value||"+33",a=e.querySelector("#k-otp-phone")?.value||"",o=g.find(m=>m.code===t);return o?q(t,S(a)).length===o.digits:!1}e.querySelector("#k-otp-request-btn").addEventListener("click",async()=>{if(!u()){i("Entrez un num\xE9ro valide pour ce pays.","error");return}let t=s(),a=e.querySelector("#k-otp-request-btn");a.disabled=!0,a.textContent="\u23F3 Envoi\u2026";try{await b("/api/auth/otp/request",{phone:t}),r.phone=t,e.querySelector("#k-otp-phone-display").textContent=t,e.querySelector("#k-track-otp").classList.add("u-hidden"),e.querySelector("#k-otp-step2").classList.remove("u-hidden"),i("\u{1F4F2} Code WhatsApp envoy\xE9 !","success")}catch(o){i(o?.message||"Erreur lors de l'envoi.","error"),a.disabled=!1,a.textContent="\u{1F4F2} Envoyer le code"}}),e.querySelector("#k-otp-verify-btn").addEventListener("click",async()=>{let t=e.querySelector("#k-otp-code").value.replace(/\s/g,"");if(t.length<4){i("Entrez le code complet.","error");return}let a=e.querySelector("#k-otp-verify-btn");a.disabled=!0,a.textContent="\u23F3 V\xE9rification\u2026";try{let o=await b("/api/auth/otp/verify",{phone:r.phone,code:t});i("\u2705 V\xE9rifi\xE9 \u2014 chargement de vos commandes\u2026","success");try{let d=await y("/api/client/tracking");e.querySelector("#k-otp-step2").classList.add("u-hidden"),e.querySelector("#k-otp-step3").classList.remove("u-hidden");let m=(d.orders||[]).map(p=>({...p,total_amount:p.totalKmf||p.total_kmf||p.total_amount||0,created_at:p.createdAt||p.created_at}));T(m,e.querySelector("#k-orders-list"))}catch{e.querySelector("#k-otp-step2").classList.add("u-hidden"),e.querySelector("#k-otp-step3").classList.remove("u-hidden"),e.querySelector("#k-orders-list").innerHTML=`
          <div class="k-search-empty">
            <p>\u2705 Num\xE9ro v\xE9rifi\xE9 ! Bienvenue <strong>${o.user?.name||""}</strong></p>
            <p class="k-confirm-notice-item">Aucune commande trouv\xE9e pour ce num\xE9ro.</p>
          </div>`}}catch(o){i(o?.message||"Code incorrect ou expir\xE9.","error"),a.disabled=!1,a.textContent="V\xE9rifier"}});let l=null;e.querySelector("#k-otp-resend-btn").addEventListener("click",async()=>{let t=e.querySelector("#k-otp-resend-btn");if(!l){t.disabled=!0,t.textContent="\u23F3 Renvoi\u2026";try{await b("/api/auth/otp/request",{phone:r.phone}),i("\u{1F4F2} Nouveau code envoy\xE9 !","success");let a=30;l=setInterval(()=>{a--,t.textContent=`Renvoyer (${a}s)`,a<=0&&(clearInterval(l),l=null,t.disabled=!1,t.textContent="Renvoyer le code")},1e3)}catch{i("Erreur lors du renvoi.","error"),t.disabled=!1,t.textContent="Renvoyer le code"}}}),e.querySelector("#k-otp-back-btn").addEventListener("click",()=>M())}export{_ as a,j as b,I as c,T as d,w as e,$ as f,M as g,R as h};
