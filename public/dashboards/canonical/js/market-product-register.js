/**
 * @komerce-arch
 * @role          market-commercial-product-register-ui
 * @domain        admin-dashboard
 * @layer         ui-workspace
 * @criticality   high
 * @inputs        authorized_market_catalog_exposure, authorized_market_local_price_decisions
 * @outputs       market_product_list, audited_price_draft_and_explicit_publication_actions
 * @depends       market-delegation catalog API, pricing local-price API
 * @used-by       public/dashboards/canonical/js/market-catalog.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      global_catalog_is_quality_owner, market_owns_price_and_publication, saving_price_never_publishes, pricing_gate_is_server_authoritative, no_browser_market_id
 * @impact-areas  admin-dashboard, market-delegation, economic-engine, catalog
 * @version       2026-10
 */
'use strict';

(function initMarketProductRegister(global, make) {
  const api=make();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(global)global.KomerceMarketProductRegister=api;
})(typeof globalThis==='undefined'?null:globalThis,function factory(){
  'use strict';

  const money=(n,currency)=>n==null||n===''||!Number.isFinite(Number(n))
    ? '—' : new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(Number(n))+' '+currency;
  const validPrice=value=>Number.isFinite(Number(value))&&Number(value)>0;

  function decisionRows(payload,priceData){
    const byRef=new Map((priceData?.products||[])
      .filter(p=>p.product_ref).map(p=>[p.product_ref,p]));
    return (Array.isArray(payload?.exposure)?payload.exposure:[]).map(product=>({
      ...product, local_price_decision:byRef.get(product.product_ref)||null,
    }));
  }

  function publicationState(row){
    const exposed=row.commercial_exposure==='ENABLED';
    const active=row.local_price_decision?.decision_status==='LOCAL_ACTIVE';
    if(exposed&&active)return {checked:true,label:'Publié sur ce marché',tone:'published'};
    if(exposed)return {checked:true,label:'Exposé sans prix actif · vente bloquée',tone:'warning'};
    if(active)return {checked:false,label:'Prix actif · produit masqué',tone:'ready'};
    if(row.local_price_decision?.local_price!=null)
      return {checked:false,label:'Prix enregistré · non publié',tone:'draft'};
    return {checked:false,label:'Non publié · prix à définir',tone:'off'};
  }

  const marketPriceBase=(marketCode,productRef)=>
    '/api/admin/workspaces/pricing/market/'+encodeURIComponent(marketCode)
    +'/products/'+encodeURIComponent(productRef)+'/local-price';

  async function savePrice({row,amount,marketCode,request}){
    if(row.commercial_exposure==='ENABLED')
      throw new Error('Masquez le produit avant de modifier son prix.');
    if(row.local_price_decision?.decision_status==='LOCAL_ACTIVE')
      throw new Error('Prix actif : réinitialisez la décision après masquage pour le modifier.');
    if(!validPrice(amount))throw new Error('Saisissez un prix local strictement positif.');
    return request(marketPriceBase(marketCode,row.product_ref),{
      method:'POST',body:{amount:Number(amount),reason:'Décision commerciale dans le Catalogue du marché',
        source:'market_catalog_product_register'},
    });
  }

  async function setPublication({row,enabled,marketCode,request}){
    const ref=row.product_ref;
    if(!ref||!row.product_id)throw new Error('Référence produit du marché manquante.');
    if(!enabled){
      return request('/api/market-delegation/markets/'+encodeURIComponent(marketCode)
        +'/catalog/exposure/'+encodeURIComponent(row.product_id),{
          method:'PUT',body:{commercial_exposure:'DISABLED'},
        });
    }
    if(row.needs_review===true||row.is_available===false)
      throw new Error('Fiche indisponible ou à corriger : publication impossible.');
    const price=row.local_price_decision;
    if(!price||!validPrice(price.local_price))
      throw new Error('Enregistrez un prix local avant d’activer la publication.');
    if(price.decision_status!=='LOCAL_ACTIVE'){
      const preview=await request(marketPriceBase(marketCode,ref)+'/activation-preview');
      if(preview.activation?.allowed!==true){
        throw new Error('Publication refusée par le moteur économique : '
          +(preview.activation?.reason||'contrôle indisponible'));
      }
    }
    // This existing server endpoint rechecks economics and requires both
    // pricing.activate + catalog.expose. It also sets market exposure.
    return request(marketPriceBase(marketCode,ref)+'/activate',{
      method:'POST',body:{reason:'Interrupteur publication du Catalogue du marché',
        source:'market_catalog_publication_switch'},
    });
  }

  function render(options={}){
    const {root,payload={},marketCode,priceData,request,feedback=()=>{},reload=async()=>{}}=options;
    if(!root?.ownerDocument||!marketCode||typeof request!=='function')return null;
    const doc=root.ownerDocument;
    // Load versioned register styling even when an older shell HTML is cached.
    if(doc.head && !doc.querySelector('[data-market-product-register-style]')){
      const sheet=doc.createElement('link');
      sheet.rel='stylesheet';
      sheet.href='/dashboards/canonical/css/market-catalog-essential.css?v=261031-1';
      sheet.setAttribute('data-market-product-register-style','');
      doc.head.appendChild(sheet);
    }
    const node=(tag,cls,txt)=>{
      const n=doc.createElement(tag);
      if(cls)n.className=cls;
      if(txt!==undefined)n.textContent=String(txt);
      return n;
    };
    const rows=decisionRows(payload,priceData);
    const currency=payload.market?.currency||priceData?.market?.currency||'';
    const cap=new Set(payload.actor_capabilities||[]);
    const canSave=priceData!=null&&cap.has('pricing.decide');
    const canPublish=priceData!=null&&cap.has('pricing.activate')&&cap.has('catalog.expose');
    const canHide=cap.has('catalog.expose');
    const section=node('section','kmc-section kmc-market-product-register');
    section.id='market-catalog-exposure';
    section.setAttribute('data-market-product-register','');
    section.appendChild(node('h2','kmc-section-title','Catalogue du marché · produits et prix'));
    section.appendChild(node('p','kmc-workspace-note',
      'Tous les produits approuvés du Catalogue global. Le prix et la publication sont des décisions propres à '+marketCode+'. L’enregistrement du prix ne publie jamais le produit.'));
    const toolbar=node('div','kmc-market-register-toolbar');
    const search=node('input','kmc-workspace-input');
    search.type='search';search.placeholder='Rechercher un produit ou une référence';
    search.setAttribute('aria-label','Rechercher dans le Catalogue du marché');
    toolbar.appendChild(search);
    toolbar.appendChild(node('span','kmc-workspace-note',rows.length+' produits du Catalogue global'));
    section.appendChild(toolbar);
    if(priceData==null){
      section.appendChild(node('p','kmc-workspace-note',
        'Données de prix masquées : l’habilitation pricing.read est nécessaire pour les consulter et décider.'));
    }
    const wrap=node('div','kmc-workspace-table-wrap');
    const table=node('table','kmc-workspace-table kmc-market-register-table');
    table.innerHTML='<thead><tr><th>Produit</th><th>Catégorie</th><th>Prix du marché</th><th>Économie locale</th><th>Publication</th></tr></thead>';
    const tbody=doc.createElement('tbody');
    async function runAction(button,work,ok){
      button.disabled=true;
      try{await work();feedback(ok,'positive');await reload();}
      catch(err){feedback((err.message||String(err))+(err.code?' · '+err.code:''),'critical');button.disabled=false;}
    }
    rows.forEach(row=>{
      const tr=node('tr','kmc-market-register-row');
      tr.setAttribute('data-market-product-ref',row.product_ref||'');
      const product=node('td');
      const identity=node('div','kmc-market-product-line');
      if(typeof row.image_url==='string'&&/^https:\/\//i.test(row.image_url)){
        const img=node('img');img.src=row.image_url;img.alt='';img.loading='lazy';
        img.width=48;img.height=48;identity.appendChild(img);
      }
      const title=node('div');
      title.appendChild(node('strong','',row.product_name||row.product_ref||'Produit'));
      title.appendChild(node('small','kmc-workspace-note',row.product_ref||'—'));
      identity.appendChild(title);product.appendChild(identity);tr.appendChild(product);
      tr.appendChild(node('td','',[row.category,row.subcategory].filter(Boolean).join(' · ')||'À classer'));
      const priceCell=node('td','kmc-market-price-cell');
      const price=row.local_price_decision;
      const current=price?.local_price;
      const input=node('input','kmc-workspace-input kmc-market-price-input');
      input.type='number';input.step='any';input.min='0';input.inputMode='decimal';
      input.placeholder='Prix';input.value=current==null?'':String(current);
      input.setAttribute('aria-label','Prix '+row.product_ref+' en '+currency);
      input.disabled=!canSave||row.commercial_exposure==='ENABLED'
        ||price?.decision_status==='LOCAL_ACTIVE';
      priceCell.appendChild(input);
      priceCell.appendChild(node('span','kmc-market-price-currency',currency));
      priceCell.appendChild(node('small','kmc-workspace-note',
        price?.decision_status==='LOCAL_ACTIVE'?'Prix actif'
          :current!=null?'Prix enregistré · non publié':'Prix non défini'));
      if(canSave&&price?.decision_status!=='LOCAL_ACTIVE'){
        const save=node('button','kmc-workspace-action is-secondary','Enregistrer le prix');
        save.type='button';save.disabled=row.commercial_exposure==='ENABLED'||!validPrice(input.value);
        input.addEventListener('input',()=>{save.disabled=row.commercial_exposure==='ENABLED'||!validPrice(input.value);});
        save.addEventListener('click',()=>runAction(save,
          ()=>savePrice({row,amount:input.value,marketCode,request}),
          'Prix du marché enregistré, produit toujours masqué.'));
        priceCell.appendChild(save);
      }
      tr.appendChild(priceCell);
      const economic=node('td','kmc-market-economics-cell');
      if(priceData!=null&&current!=null){
        const detail=node('button','kmc-workspace-action is-secondary','Voir coûts et marge');
        detail.type='button';economic.appendChild(detail);
        const facts=node('div','kmc-market-economic-facts');
        facts.hidden=true;economic.appendChild(facts);
        detail.addEventListener('click',async()=>{
          if(!facts.hidden){facts.hidden=true;return;}
          detail.disabled=true;
          try{
            const preview=await request(marketPriceBase(marketCode,row.product_ref)+'/activation-preview');
            const e=preview.economics||{};
            facts.replaceChildren();
            [
              ['Coût variable complet',money(e.variable_cost_complete_kmf,'KMF')],
              ['CDR complet',money(e.cdr_complete_kmf,'KMF')],
              ['Marge estimée',e.estimated_margin_pct==null?'—':e.estimated_margin_pct+' %'],
              ['Position du prix',e.strategy_risk||'À vérifier'],
              ['Gate économique',preview.activation?.allowed===true?'Autorisé':'À arbitrer / bloqué'],
            ].forEach(([k,v])=>{
              const line=node('div','kmc-market-economic-line');
              line.appendChild(node('span','',k));line.appendChild(node('strong','',v));
              facts.appendChild(line);
            });
            facts.hidden=false;
          }catch(err){feedback('Calcul économique indisponible : '+err.message,'critical');}
          finally{detail.disabled=false;}
        });
      }else economic.appendChild(node('small','kmc-workspace-note',
        priceData==null?'Accès Pricing requis':'Enregistrer un prix pour calculer sa marge'));
      tr.appendChild(economic);
      const publish=node('td','kmc-market-publication-cell');
      const currentState=publicationState(row);
      const switchLabel=node('label','kmc-market-publish-switch');
      const checkbox=node('input');checkbox.type='checkbox';checkbox.setAttribute('role','switch');
      checkbox.checked=currentState.checked;
      checkbox.setAttribute('aria-label','Publier '+row.product_ref+' sur '+marketCode);
      checkbox.disabled=currentState.checked?!canHide:!canPublish
        ||!price||!validPrice(price.local_price)||row.needs_review===true
        ||row.is_available===false;
      switchLabel.appendChild(checkbox);
      switchLabel.appendChild(node('span','kmc-market-switch-track'));
      publish.appendChild(switchLabel);
      publish.appendChild(node('small','kmc-market-publication-status is-'+currentState.tone,currentState.label));
      checkbox.addEventListener('change',async()=>{
        const desired=checkbox.checked;checkbox.disabled=true;
        try{
          await setPublication({row,enabled:desired,marketCode,request});
          feedback(desired?'Produit publié sur ce marché.':'Produit masqué sur ce marché.','positive');
          await reload();
        }catch(err){
          checkbox.checked=!desired;checkbox.disabled=false;
          feedback((err.message||String(err))+(err.code?' · '+err.code:''),'critical');
        }
      });
      tr.appendChild(publish);tbody.appendChild(tr);
    });
    table.appendChild(tbody);wrap.appendChild(table);section.appendChild(wrap);
    if(!rows.length)section.appendChild(node('p','kmc-workspace-empty','Aucun produit approuvé dans le Catalogue global.'));
    search.addEventListener('input',()=>{
      const q=search.value.trim().toLocaleLowerCase('fr-FR');
      Array.from(tbody.children).forEach(tr=>{
        tr.hidden=Boolean(q)&&!tr.textContent.toLocaleLowerCase('fr-FR').includes(q);
      });
    });
    root.appendChild(section);return section;
  }

  return Object.freeze({decisionRows,publicationState,marketPriceBase,savePrice,setPublication,render});
});
