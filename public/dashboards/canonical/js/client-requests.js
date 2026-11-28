/**
 * @komerce-arch-lite
 * @role          canonical-client-requests-workspace
 * @domain        dashboard
 * @layer         ui-workspace
 * @owner         public/dashboards/canonical/js/client-requests.js
 * @purpose       Market client requests and explicitly shared Hub conversations.
 * @impact-areas  dashboard, market-delegation, notifications
 */
'use strict';
(function(global){
  const MOTIFS={auto_parts:'Pièces automobiles',express:'Livraison express',other:'Autre recherche'};
  const STATUS={new:'Nouvelle',in_progress:'En cours',closed:'Clôturée'};
  const EVENTS={hub_shared:'Partagé avec le Hub',hub_revoked:'Accès Hub révoqué',started:'Prise en charge',closed:'Dossier clôturé',reopened:'Dossier rouvert',callback:'Rappel effectué'};
  function node(tag,text,cls){const n=global.document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n}
  function button(text,action){const b=node('button',text,'kmc-workspace-action is-secondary');b.type='button';b.addEventListener('click',action);return b}
  async function request(url,method='GET',body){
    const headers={Accept:'application/json'};
    if(body!=null&&!(body instanceof global.FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body)}
    const res=await global.fetch(url,{method,headers,body,credentials:'include',cache:'no-store'});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw Object.assign(new Error(data.error||'Demande indisponible.'),{status:res.status});
    return data;
  }
  async function mount({root,marketCode=null,hub=false}={}){
    if(!root||(!hub&&!marketCode))return;
    const base=hub?'/api/hub/client-requests':'/api/markets/'+encodeURIComponent(marketCode)+'/client-requests';
    const detailPath=ref=>base+'/'+encodeURIComponent(ref);
    const section=node('section',null,'kmc-section kmc-client-requests');
    section.dataset.clientRequests=hub?'hub':'market';
    let selected=null,generation=0,busy=false,timer=null;
    const heading=node('h2',hub?'Demandes partagées avec le Hub':'Demandes clients — On Demand');
    const list=node('div',null,'kmc-client-requests-list');
    const detail=node('div',null,'kmc-client-requests-detail');
    const note=node('p',null,'kmc-workspace-note');note.setAttribute('role','status');
    const refresh=button('Actualiser',()=>loadList());
    section.append(heading,refresh,list,detail,note);
    const clearDetail=()=>{generation++;selected=null;detail.replaceChildren();if(timer)clearInterval(timer);timer=null};
    const alive=g=>root.isConnected&&generation===g;
    let oldest=null;
    async function loadList(append=false){
      try{
        const data=await request(base+(append&&oldest?'?before='+encodeURIComponent(oldest):''));
        if(!root.isConnected)return;
        if(!section.isConnected)root.append(section);
        const rows=data.requests||[];
        if(!append)list.replaceChildren();
        list.querySelector('[data-more]')?.remove();
        if(!rows.length&&!append)list.append(node('p',hub?'Aucune demande partagée.':'Aucune demande client.'));
        for(const r of rows){
          const b=button((MOTIFS[r.motif]||r.motif)+' · '+(STATUS[r.status]||r.status)+' · '+r.reference.slice(0,10),()=>open(r.reference));b.dataset.requestRef=r.reference;list.append(b)
        }
        oldest=rows.at(-1)?.reference||null;
        if(rows.length===50){const more=button('Demandes précédentes',()=>loadList(true));more.dataset.more='1';list.append(more)}
        note.textContent='';
      }catch(err){if(!root.isConnected)return;if(err.status===403){clearDetail();section.remove();return}if(!section.isConnected)root.append(section);note.textContent=err.message}
    }
    function renderMessages(log,ref,messages,channel,prepend=false){
      const fragment=global.document.createDocumentFragment();
      for(const m of messages){
        if(m.visibility!==channel)continue;
        const row=node('article',null,'kmc-client-request-message'+(m.author_side==='staff'?' is-staff':''));
        row.dataset.messageId=m.id;
        row.append(node('small',m.author_side==='client'?'Client':m.event_type==='message'?'Personnel':'Événement interne'));
        if(m.event_type!=='message')row.append(node('strong',EVENTS[m.event_type]||'Événement'));
        if(m.body)row.append(node('p',m.body));
        for(const a of m.attachments||[]){const img=node('img');img.src=detailPath(ref)+'/attachments/'+encodeURIComponent(a.id);img.alt='Photo jointe';img.loading='lazy';row.append(img)}
        fragment.append(row);
      }
      if(prepend)log.prepend(fragment);else{log.replaceChildren(fragment);log.scrollTop=log.scrollHeight}
    }
    async function open(ref){
      clearDetail();selected=ref;const g=generation;
      const title=node('h3','Dossier '+ref.slice(0,10)),status=node('p');
      const actions=node('div',null,'kmc-client-request-actions'),tabs=node('div',null,'kmc-client-request-actions');
      const log=node('div',null,'kmc-client-request-thread');log.setAttribute('role','log');
      const composer=node('form',null,'kmc-client-request-compose');
      const input=node('textarea');input.rows=2;input.maxLength=2000;input.placeholder='Votre message';input.setAttribute('aria-label','Votre message');
      const files=node('input');files.type='file';files.accept='image/jpeg,image/png,image/webp';files.multiple=true;files.setAttribute('aria-label','Photos privées');
      const send=node('button','Envoyer','kmc-workspace-action');send.type='submit';composer.append(input,files,send);
      let channel=hub?'internal':'client',data=null,last='',loading=false,older=false,cursor=null;
      const msg=node('p',null,'kmc-workspace-note');msg.setAttribute('role','status');
      const earlier=button('Messages précédents',async()=>{if(!cursor)return;try{const page=await request(detailPath(ref)+'?before='+encodeURIComponent(cursor));if(alive(g)){const rows=page.messages||[];cursor=rows[0]?.id||null;earlier.disabled=rows.length<100;older=true;renderMessages(log,ref,rows,channel,true)}}catch(err){msg.textContent=err.message}});
      detail.replaceChildren(title,status,actions,tabs,earlier,log,composer,msg);
      function paint(force=false){
        const r=data.request;const canWrite=hub||r.can_handle===true;
        status.textContent=(MOTIFS[r.motif]||r.motif)+' · '+(STATUS[r.status]||r.status);
        actions.replaceChildren();
        if(!hub&&canWrite){
          if(/^\+[0-9]{8,15}$/.test(r.callback_phone||'')){const a=node('a','Rappeler le client','kmc-workspace-action is-secondary');a.href='tel:'+r.callback_phone;actions.append(a)}
          if(r.status!=='closed'){
            if(r.status==='new')actions.append(button('Prendre en charge',()=>mutate('/reopen','POST',{})));
            actions.append(button(r.hub_shared?'Révoquer le partage Hub':'Partager avec le Hub',()=>mutate('/hub-share',r.hub_shared?'DELETE':'POST',{})));
            const reason=node('input');reason.placeholder='Motif de clôture';reason.maxLength=2000;reason.setAttribute('aria-label','Motif de clôture');
            actions.append(reason,button('Clôturer',()=>{if(!reason.value.trim()){msg.textContent='Précisez le motif de clôture.';return}mutate('/close','POST',{reason:reason.value})}));
          }else{
            if(r.hub_shared)actions.append(button('Révoquer le partage Hub',()=>mutate('/hub-share','DELETE',{})));
            actions.append(button('Rouvrir',()=>mutate('/reopen','POST',{})));
          }
        }
        composer.hidden=!canWrite||r.status==='closed';
        tabs.replaceChildren();
        if(!hub)for(const [v,label] of [['client','Conversation client'],['internal','Échanges internes']]){const b=button(label,()=>{channel=v;older=false;paint(true)});b.setAttribute('aria-pressed',String(channel===v));tabs.append(b)}
        else tabs.append(node('small','Canal interne uniquement. Aucun accès aux messages, photos ou coordonnées du client.'));
        const rows=data.messages||[];
        const signature=JSON.stringify([channel,rows.map(m=>[m.id,m.attachments?.map(a=>a.id)])]);
        if(force||signature!==last){if(!older||force){renderMessages(log,ref,rows,channel);cursor=rows[0]?.id||null;earlier.disabled=rows.length<100;older=false}else{const known=new Set([...log.children].map(e=>e.dataset.messageId));const temp=node('div');renderMessages(temp,ref,rows.filter(m=>!known.has(m.id)),channel);log.append(...temp.children)}last=signature}
      }
      async function load(force=false){
        if(loading)return;loading=true;
        try{const result=await request(detailPath(ref));if(!alive(g))return;const old=data;data=result;const changed=!old||JSON.stringify(old.request)!==JSON.stringify(data.request)||JSON.stringify(old.messages)!==JSON.stringify(data.messages);if(force||changed)paint(force);msg.textContent=''}
        catch(err){if(alive(g)){msg.textContent=err.message;if([401,403,404].includes(err.status)){if(timer)clearInterval(timer);timer=null;actions.replaceChildren();tabs.replaceChildren();log.replaceChildren();composer.hidden=true;earlier.disabled=true}}}finally{loading=false}
      }
      async function mutate(suffix,method,body){
        if(busy)return;busy=true;try{await request(detailPath(ref)+suffix,method,body);if(alive(g)){await load(true);await loadList()}}catch(err){if(alive(g))msg.textContent=err.message}finally{busy=false}
      }
      composer.addEventListener('submit',async e=>{e.preventDefault();if(busy)return;const photos=[...files.files];if(!input.value.trim()&&!photos.length){msg.textContent='Écrivez un message ou ajoutez une photo.';return}if(photos.length>3||photos.some(f=>f.size>5*1024*1024)){msg.textContent='Maximum 3 photos de 5 Mo.';return}
        const body=new global.FormData();body.append('body',input.value);body.append('visibility',channel);for(const file of photos)body.append('photos',file);
        busy=true;send.disabled=true;try{await request(detailPath(ref)+'/messages','POST',body);if(alive(g)){input.value='';files.value='';await load(true);await loadList()}}catch(err){if(alive(g))msg.textContent=err.message}finally{busy=false;send.disabled=false}
      });
      await load(true);if(alive(g))timer=setInterval(()=>{if(!alive(g)){clearInterval(timer);timer=null;return}if(global.document.visibilityState==='visible'&&!busy)load()},30000);
    }
    await loadList();
    const requested=new URLSearchParams(global.location.search).get('client_request_ref');
    if(requested&&section.isConnected)await open(requested);
  }
  global.KomerceClientRequests=Object.freeze({mount});
})(window);
