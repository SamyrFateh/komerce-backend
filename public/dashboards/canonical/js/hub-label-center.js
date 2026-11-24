/**
 * @komerce-arch-lite
 * @role hub-label-center
 * @domain admin-dashboard
 * @layer ui
 * @owner backend-core
 * @purpose Find and download already issued opaque ARTICLE / COMBOX labels without navigating historic boxes.
 * @db-read none
 * @db-write none
 * @impact-areas dashboard, logistics, hub, qr
 */
'use strict';
(function initHubLabelCenter(global){
  const PREFIX='/api/admin/workspaces/operations/market/';
  const el=(doc,tag,cls,value)=>{
    const n=doc.createElement(tag);
    if(cls)n.className=cls;
    if(value!==undefined)n.textContent=String(value);
    return n;
  };
  const endpoint=(market,path)=>PREFIX+encodeURIComponent(market)+'/'+path;
  const safeTarget=id=>/^[0-9a-f-]{36}$/i.test(String(id||''))?id:null;
  function mount({host,doc,marketCode,fetchFn,act,fillable=[]}){
    if(!host||!doc||!/^[A-Z]{2}$/.test(marketCode)||typeof fetchFn!=='function')return;
    host.replaceChildren();
    host.setAttribute('data-hub-label-center','');
    const header=el(doc,'div','kmc-hub-label-head');
    header.appendChild(el(doc,'h2','', 'Étiquettes QR · ARTICLE et COMBOX'));
    header.appendChild(el(doc,'p','', 'Téléchargez les QR déjà émis, même si la COMBOX a quitté le Hub. Un scan identifie une unité ; seule la confirmation de l’agent valide une opération.'));
    host.appendChild(header);
    const controls=el(doc,'div','kmc-hub-label-controls');
    const search=doc.createElement('input');
    search.type='search';search.placeholder='Commande, COMBOX ou relais…';
    search.setAttribute('aria-label','Rechercher les étiquettes QR');
    const type=doc.createElement('select');
    type.setAttribute('aria-label','Type d’étiquette QR');
    [['all','Toutes les étiquettes'],['ARTICLE','Articles'],['COMBOX','COMBOX']].forEach(([v,t])=>{
      const o=doc.createElement('option');o.value=v;o.textContent=t;type.appendChild(o);
    });
    const refresh=el(doc,'button','kmc-hub-label-reload','Actualiser');
    refresh.type='button';
    controls.append(search,type,refresh);
    host.appendChild(controls);
    const notice=el(doc,'p','kmc-workspace-note','Chargement des QR émis pour ce marché…');
    notice.setAttribute('role','status');host.appendChild(notice);
    const list=el(doc,'div','kmc-hub-label-grid');host.appendChild(list);
    let issued=[],busy=false;
    const file=(entry,format)=>{
      const a=el(doc,'a','kmc-hub-label-download',
        format==='a4'?'Télécharger PDF A4':'Télécharger PDF 80 mm');
      a.href=endpoint(marketCode,'labels/'+(entry.type==='ARTICLE'?'articles':'boxes')+'/'+encodeURIComponent(entry.target_id)+'/pdf?format='+format);
      a.setAttribute('data-hub-label-pdf',entry.type+'-'+format);
      a.addEventListener('click',async event=>{
        event.preventDefault();
        if(busy)return;
        busy=true;
        try{
          const response=await fetchFn(a.href,{method:'GET',credentials:'include',headers:{Accept:'application/pdf'}});
          if(!response.ok)throw new Error('HTTP '+response.status+' · vérifiez les droits ou les étiquettes émises');
          if(!String(response.headers.get('content-type')||'').includes('application/pdf'))throw Error('Réponse non PDF');
          const blob=await response.blob();
          if(blob.size<100)throw Error('PDF vide');
          const url=URL.createObjectURL(blob);
          try{
            const download=doc.createElement('a');
            download.href=url;download.download='KOMERCE-'+entry.type+'-'+marketCode+'-'+format+'.pdf';
            download.hidden=true;doc.body.appendChild(download);download.click();download.remove();
          }finally{setTimeout(()=>URL.revokeObjectURL(url),30000);}
          notice.textContent='PDF prêt : affichez-le sur l’ordinateur, puis scannez depuis Komerce sur le téléphone.';
        }catch(err){notice.textContent='Téléchargement indisponible : '+err.message;}
        finally{busy=false;}
      });
      return a;
    };
    const row=(title,description,entry)=>{
      const card=el(doc,'article','kmc-hub-label-card');
      card.appendChild(el(doc,'strong','',title));
      card.appendChild(el(doc,'p','',description));
      const actions=el(doc,'div','kmc-hub-label-actions');
      actions.append(file(entry,'a4'),file(entry,'thermal'));
      card.appendChild(actions);
      return card;
    };
    function paint(){
      list.replaceChildren();
      const q=search.value.trim().toLocaleLowerCase('fr');
      const chosen=type.value;
      const filter=e=> (chosen==='all'||e.type===chosen)&&
        (!q||[e.reference,e.relay_code,e.type].some(v=>String(v||'').toLocaleLowerCase('fr').includes(q)));
      const shown=issued.filter(filter);
      for(const entry of shown){
        const id=safeTarget(entry.target_id);
        if(!id)continue;
        const name=entry.type==='ARTICLE'?'ARTICLE':'COMBOX';
        const extra=entry.type==='COMBOX'?(entry.box_state||''):String(entry.quantity)+' unité(s)';
        list.appendChild(row(name+' · '+(entry.reference||'—'),
          marketCode+' · relais '+(entry.relay_code||'—')+' · '+extra,
          {...entry,target_id:id}));
      }
      const missing=new Set(issued.filter(e=>e.type==='ARTICLE').map(e=>String(e.target_id)));
      const candidates=fillable.filter(e=>Number(e.quantity)>0&&safeTarget(e.allocation_id)&&!missing.has(String(e.allocation_id)));
      for(const item of candidates){
        if(chosen==='COMBOX')continue;
        if(q&&![item.order_ref,item.product,item.relais_code].some(v=>String(v||'').toLocaleLowerCase('fr').includes(q)))continue;
        const card=el(doc,'article','kmc-hub-label-card');
        card.appendChild(el(doc,'strong','', 'ARTICLE · '+(item.order_ref||item.product||'Réception')));
        card.appendChild(el(doc,'p','', marketCode+' · relais '+(item.relais_code||'—')+' · '+item.quantity+' unité(s) reçue(s), QR non émis'));
        const create=el(doc,'button','kmc-hub-label-issue','Préparer les QR ARTICLE');
        create.type='button';
        create.addEventListener('click',async()=>{
          await act(create,{
            url:endpoint(marketCode,'labels/articles/'+encodeURIComponent(item.allocation_id)+'/issue'),
            body:{},runningMessage:'Émission des identités QR…',
            successMessage:'QR ARTICLE émis : PDF disponible.',
            onSuccess:()=>load(),
          }).catch(err=>{notice.textContent='Émission refusée : '+String(err.message||err);});
        });
        card.appendChild(create);list.appendChild(card);
      }
      if(!list.children.length)list.appendChild(el(doc,'p','kmc-workspace-empty',
        issued.length?'Aucune étiquette correspondant au filtre.':'Aucun QR émis dans ce marché : réceptionnez d’abord les articles, puis préparez leurs QR.'));
      notice.textContent=issued.length+' groupe(s) de QR émis, '+shown.length+' visible(s) (80 plus récents maximum).';
    }
    async function load(){
      refresh.disabled=true;
      try{
        const response=await fetchFn(endpoint(marketCode,'labels/index'),{credentials:'include',headers:{Accept:'application/json'}});
        if(!response.ok)throw new Error('HTTP '+response.status);
        const data=await response.json();
        if(data.market!==marketCode||!Array.isArray(data.labels))throw new Error('Index QR invalide');
        issued=data.labels;paint();
      }catch(err){notice.textContent='Impossible de lire les QR : '+err.message;list.replaceChildren();}
      finally{refresh.disabled=false;}
    }
    search.addEventListener('input',paint);
    type.addEventListener('change',paint);
    refresh.addEventListener('click',load);
    load();
  }
  global.KomerceHubLabelCenter=Object.freeze({mount});
})(typeof globalThis!=='undefined'?globalThis:this);
