/**
 * @komerce-arch
 * @role          g8-admin-refund-staging-operator-ui
 * @domain        admin-dashboard
 * @layer         ui-page
 * @criticality   high
 * @inputs        authenticated-role, local refund and PSP item-refund projections
 * @outputs       two-step PSP sandbox item refund plus explicit local payout decisions
 * @depends       GET/POST /api/admin/orders, PSP refund reservation/execution, relay cash handoff
 * @used-by       public/g8-remboursements.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      two_step_refund_decision, no_blind_retry, source_payee_verified_external, distinct_actors, staging_flags
 * @impact-areas  admin-dashboard, refunds, relay
 * @version       2026-11
 */
'use strict';
(function initG8Operator() {
  const state = document.querySelector('#g8-status');
  const list = document.querySelector('#g8-list');
  const title = document.querySelector('#g8-title');
  const env = document.querySelector('#g8-env');
  const back = document.querySelector('#g8-back');
  const refresh = document.querySelector('#g8-refresh');
  let userRole = null;

  const fieldDefs = Object.freeze({
    holder_id: 'Identifiant UUID du détenteur au relais',
    original_payer_proof_ref: 'Référence de la preuve du payeur initial',
    identity_check_proof_ref: 'Contrôle d’identité indépendant (référence)',
    operator_id: 'UUID de l’admin qui exécute le virement',
    payer_fingerprint: 'Empreinte SHA-256 du payeur attesté',
    transfer_ref: 'Référence unique du virement opéré',
    transfer_proof_ref: 'Reçu du virement réellement effectué',
    operator_verification_ref: 'Référence du contrôle indépendant portail opérateur',
    capture_external_transaction_id: 'Référence de la capture source vérifiée',
    amount_minor: 'Montant natif (unités mineures)',
    currency: 'Devise',
    payee_fingerprint: 'Empreinte SHA-256 du bénéficiaire constaté',
    signed_receipt_ref: 'Référence de la quittance client signée',
    payer_signature_proof_ref: 'Preuve de la signature du payeur',
    witness_proof_ref: 'Attestation du témoin (référence distincte)'
  });

  function announce(message, tone) {
    state.textContent = message;
    state.className = 'status' + (tone ? ' ' + tone : '');
  }
  function node(tag, className, content) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (content !== undefined) el.textContent = String(content);
    return el;
  }
  function append(parent, tag, className, content) {
    const child = node(tag, className, content);
    parent.appendChild(child);
    return child;
  }
  function money(row) {
    if (row.payment_mode === 'cash_relais') {
      const val = Number(row.amount_kmf);
      return Number.isFinite(val) ? val.toLocaleString('fr-FR') + ' KMF' : 'Montant indisponible';
    }
    return String(row.amount_minor) + ' unités mineures · ' + String(row.currency);
  }
  async function json(url, method, payload) {
    const options = { credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (method) {
      options.method = method;
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(payload || {});
    }
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || 'Accès ou action refusé (' + response.status + ')');
      error.status = response.status;
      error.code = body.code || '';
      throw error;
    }
    return body;
  }
  function inputForm(parent, action, definitions, endpoint, caution, requireConfirmation) {
    const form = append(parent, 'form', 'proof-form');
    form.noValidate = false;
    const controls = new Map();
    definitions.forEach(function (def) {
      const key = typeof def === 'string' ? def : def.key;
      const initial = typeof def === 'string' ? '' : String(def.value || '');
      const label = append(form, 'label', 'field');
      append(label, 'span', '', fieldDefs[key] || key);
      const input = append(label, 'input');
      input.name = key;
      input.type = 'text';
      input.required = true;
      input.autocomplete = 'off';
      input.maxLength = key.includes('fingerprint') ? 64 : 200;
      if (key.includes('fingerprint')) input.setAttribute('pattern', '[a-f0-9]{64}');
      if (key.endsWith('_id') && !key.includes('transaction')) input.minLength = 36;
      input.value = initial;
      controls.set(key, input);
    });
    if (caution) append(form, 'p', 'hint', caution);
    const button = append(form, 'button', 'action' + (requireConfirmation ? ' action-warning' : ''), action);
    button.type = 'submit';
    button.setAttribute('data-g8-action', endpoint.split('/').slice(-2).join('-'));
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const payload = {};
      controls.forEach((control, key) => { payload[key] = control.value.trim(); });
      if (requireConfirmation && !window.confirm(requireConfirmation)) return;
      button.disabled = true;
      announce('Enregistrement en cours…');
      try {
        const result = await json(endpoint, 'POST', payload);
        announce(result.paid
          ? 'Remboursement déclaré et comptabilisé : reçu ' + (result.receiptRef || result.documentStatus || 'à réconcilier')
          : 'État enregistré : ' + String(result.status || 'en attente') + '. Aucune remise supplémentaire automatique.', 'ok');
        await load(true);
      } catch (error) {
        announce((error.code ? error.code + ' — ' : '') + error.message, 'error');
      } finally { button.disabled = false; }
    });
  }
  function clickAction(parent, label, endpoint, confirmText) {
    const button = append(parent, 'button', 'action action-warning', label);
    button.type = 'button';
    button.setAttribute('data-g8-action', endpoint.split('/').slice(-2).join('-'));
    button.addEventListener('click', async function () {
      if (!window.confirm(confirmText)) return;
      button.disabled = true;
      announce('Enregistrement en cours…');
      try {
        const result = await json(endpoint, 'POST', {});
        announce('État : ' + String(result.status || 'en attente') +
          '. Un éventuel rejeu ne déclenche aucun nouveau paiement.', 'ok');
        await load(true);
      } catch (error) {
        announce((error.code ? error.code + ' — ' : '') + error.message, 'error');
      } finally { button.disabled = false; }
    });
  }
  function adminCase(row, box) {
    const stem = '/api/admin/orders/' + encodeURIComponent(row.order_id) +
      '/items/' + encodeURIComponent(row.order_item_id) +
      '/local-refund-reservations/' + encodeURIComponent(row.reservation_id);
    if (row.payment_mode === 'cash_relais') {
      const stage = row.cash_status || 'non autorisé';
      append(box, 'p', 'case-summary', 'Espèces · ' + stage +
        (row.cash_holder_id ? ' · relais affecté' : ''));
      if (!row.cash_authorization_id) {
        inputForm(box, 'Autoriser la remise au relais', [
          'holder_id', 'original_payer_proof_ref', 'identity_check_proof_ref'
        ], stem + '/authorize-cash',
        'Contrôler le payeur d’origine et la disponibilité de la garde avant d’autoriser.',
        'Avez-vous personnellement vérifié les pièces d’identité et le payeur de la transaction encaissée ?');
      } else {
        append(box, 'p', 'hint', 'Remise gérée par le détenteur affecté au relais. Aucune deuxième autorisation.');
      }
      return;
    }
    const status = row.mobile_status || 'non autorisé';
    append(box, 'p', 'case-summary', 'Mobile Money manuel · ' + status +
      '. Aucun transfert n’est effectué par Komerce.');
    if (!row.mobile_status) {
      inputForm(box, 'Autoriser le virement manuel', [
        'operator_id', 'payer_fingerprint', 'original_payer_proof_ref'
      ], stem + '/manual-mobile/approve',
      'Identifier le payeur sur une preuve opérateur extérieure au numéro fourni par le client.',
      'Confirmez-vous avoir comparé le payeur initial à une preuve de capture opérateur indépendante ?');
    } else if (status === 'approved') {
      clickAction(box, 'Prendre en charge le transfert externe',
        stem + '/manual-mobile/start',
        'L’opérateur désigné doit ensuite exécuter le transfert dans le portail officiel. Un échec ou délai doit rester en rapprochement, jamais relancé aveuglément.');
    } else if (status === 'transfer_pending') {
      inputForm(box, 'Rapprocher le virement déjà exécuté', [
        { key: 'amount_minor', value: row.amount_minor },
        { key: 'currency', value: row.currency },
        'payee_fingerprint', 'capture_external_transaction_id',
        'transfer_ref', 'transfer_proof_ref', 'operator_verification_ref'
      ], stem + '/manual-mobile/confirm',
      'Seul un troisième administrateur indépendant peut constater sur le portail du fournisseur le montant, le compte payeur d’origine et le bénéficiaire effectif.',
      'ATTENTION : cette confirmation inscrit un remboursement EFFECTUÉ dans la comptabilité. Avez-vous vérifié une preuve externe de virement effectivement réussi ?');
    } else {
      append(box, 'p', 'hint', 'Virement rapproché. Aucun nouvel ordre de transfert.');
    }
  }
  function relayCase(row, box) {
    const endpoint = '/api/relay/orders/' + encodeURIComponent(row.order_id) +
      '/items/' + encodeURIComponent(row.order_item_id) +
      '/local-cash-handoffs/' + encodeURIComponent(row.authorization_id);
    const status = row.status;
    append(box, 'p', 'case-summary', 'Remise espèces · ' + status);
    if (status === 'approved') {
      clickAction(box, 'Engager une remise physique', endpoint + '/start',
        'La garde sera réservée et cette remise ne pourra pas être réengagée. Le client d’origine a-t-il été identifié physiquement au comptoir ?');
    } else if (status === 'handoff_pending') {
      inputForm(box, 'Confirmer après remise réelle des espèces', [
        'signed_receipt_ref', 'payer_signature_proof_ref', 'witness_proof_ref'
      ], endpoint + '/confirm',
      'N’utiliser cette opération qu’après la remise effective des espèces et obtention des trois preuves.',
      'ATTENTION : les espèces ont-elles DÉJÀ été remises au payeur initial avec une quittance signée et un témoin ?');
    } else {
      append(box, 'p', 'hint', 'Remise clôturée ; aucune deuxième sortie de caisse.');
    }
  }
  function ensureReservationForm() {
    if (userRole !== 'admin' || document.querySelector('#g8-new-reservation')) return;
    const panel = node('details', 'case');
    panel.id = 'g8-new-reservation';
    panel.style.marginBottom = '20px';
    const summary = append(panel, 'summary', 'case-head', 'Créer une obligation pour un manquant attesté');
    summary.style.cursor = 'pointer';
    const box = append(panel, 'div', 'case-body');
    append(box, 'p', 'hint', 'La réservation ne débite aucune caisse ni opérateur. Une preuve d\'incident existante est obligatoire, et le serveur plafonne les quantités.');
    const form = append(box, 'form');
    const keys = [
      ['order_id', 'UUID de la commande'],
      ['order_item_id', 'UUID de la ligne manquante'],
      ['incident_id', 'UUID de l’incident fournisseur ou relais'],
      ['quantity', 'Quantité effectivement manquante'],
      ['reason', 'Motif vérifié (au moins 8 caractères)']
    ];
    const inputs = {};
    keys.forEach(([key, labelText]) => {
      const label = append(form, 'label', 'field');
      append(label, 'span', '', labelText);
      const input = append(label, 'input');
      input.type = key === 'quantity' ? 'number' : 'text';
      input.required = true;
      input.name = key;
      input.autocomplete = 'off';
      input.maxLength = 200;
      if (key === 'quantity') input.min = '1';
      inputs[key] = input;
    });
    const btn = append(form, 'button', 'action', 'Réserver cette dette');
    btn.type = 'submit';
    btn.setAttribute('data-g8-action', 'reserve');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      if (!window.confirm('Le manquant est-il attesté par un incident existant et la commande réellement encaissée ?')) return;
      const id = inputs.order_id.value.trim(), itemId = inputs.order_item_id.value.trim();
      btn.disabled = true;
      announce('Réservation en cours…');
      try {
        const result = await json('/api/admin/orders/' + encodeURIComponent(id) +
          '/items/' + encodeURIComponent(itemId) + '/local-refund-reservations',
          'POST', {
            incident_id: inputs.incident_id.value.trim(),
            quantity: Number(inputs.quantity.value),
            operation_key: window.crypto.randomUUID(),
            reason: inputs.reason.value.trim()
          });
        announce('Dette réservée : ' + result.reservationId + '. Aucun montant n’a encore été remboursé.', 'ok');
        form.reset();
        await load(true);
      } catch (error) {
        announce((error.code ? error.code + ' — ' : '') + error.message, 'error');
      } finally { btn.disabled = false; }
    });
    list.parentNode.insertBefore(panel, list);
  }
  function ensureItemRefundForm() {
    if (userRole !== 'admin' || document.querySelector('#g8-item-refund')) return;
    const panel = node('details','case'); panel.id='g8-item-refund'; panel.style.marginBottom='20px';
    const summary=append(panel,'summary','case-head','N26a · Remboursement PSP partiel d’une ligne');
    summary.style.cursor='pointer';
    const box=append(panel,'div','case-body');
    append(box,'p','hint','Réservé aux commandes payées Stripe ou PayPal et aux quantités couvertes par une preuve de manquant. La réservation et le paiement sont deux décisions séparées. L’exécution est strictement sandbox et sans nouvel essai automatique après une réponse incertaine.');
    const lookup=append(box,'form','proof-form');
    const refLabel=append(lookup,'label','field'); append(refLabel,'span','','Référence de commande');
    const reference=append(refLabel,'input'); reference.name='order_reference'; reference.required=true;
    reference.autocomplete='off'; reference.maxLength=80; reference.pattern='[A-Za-z0-9][A-Za-z0-9._-]{1,79}';
    const loadButton=append(lookup,'button','action','Charger les lignes et preuves');
    loadButton.type='submit'; loadButton.setAttribute('data-g8-action','load-item-refund-context');
    const notice=append(box,'p','case-summary','Chargez une commande pour afficher les lignes admissibles.');
    notice.setAttribute('role','status');
    const decision=append(box,'form','proof-form'); decision.hidden=true;
    const candidateLabel=append(decision,'label','field'); append(candidateLabel,'span','','Ligne et incident attesté');
    const candidateSelect=append(candidateLabel,'select'); candidateSelect.name='candidate'; candidateSelect.required=true;
    const quantityLabel=append(decision,'label','field'); append(quantityLabel,'span','','Quantité partielle');
    const quantity=append(quantityLabel,'input'); quantity.name='quantity'; quantity.type='number';
    quantity.min='1'; quantity.step='1'; quantity.required=true;
    const reasonLabel=append(decision,'label','field'); append(reasonLabel,'span','','Motif (8 caractères minimum)');
    const reason=append(reasonLabel,'input'); reason.name='reason'; reason.required=true;
    reason.minLength=8; reason.maxLength=500; reason.autocomplete='off';
    const reserve=append(decision,'button','action','Réserver le remboursement partiel');
    reserve.type='submit'; reserve.setAttribute('data-g8-action','reserve-item-refund');
    const execute=append(box,'button','action','Exécuter le remboursement PSP sandbox');
    execute.type='button'; execute.hidden=true; execute.setAttribute('data-g8-action','execute-item-refund');
    let context=null, operationKey=null, reservation=null, executionAttempted=false;
    const invalidate=()=>{operationKey=null;};
    const setLimit=()=>{
      const c=context?.candidates?.[Number(candidateSelect.value)];
      quantity.max=String(c?.available_quantity||1);
      if(!quantity.value||Number(quantity.value)>Number(quantity.max))quantity.value='1';
      invalidate();
    };
    candidateSelect.addEventListener('change',setLimit);
    quantity.addEventListener('input',invalidate); reason.addEventListener('input',invalidate);
    lookup.addEventListener('submit',async event=>{
      event.preventDefault(); if(!lookup.reportValidity())return;
      loadButton.disabled=true;decision.hidden=true;execute.hidden=true;context=null;reservation=null;operationKey=null;executionAttempted=false;
      notice.textContent='Lecture des preuves de manquant…';
      try{
        context=await json('/api/admin/orders/'+encodeURIComponent(reference.value.trim())+'/item-refund-context');
        candidateSelect.replaceChildren();
        const byId=new Map((context.items||[]).map(item=>[String(item.id),item]));
        (context.candidates||[]).forEach((candidate,index)=>{
          const item=byId.get(String(candidate.order_item_id));
          const option=node('option','',(item?.product_name||'Article')+' · '+candidate.available_quantity+
            ' admissible(s) · '+candidate.proof+' · incident '+String(candidate.incident_id).slice(0,8));
          option.value=String(index);candidateSelect.appendChild(option);
        });
        if(!candidateSelect.children.length){
          notice.textContent=context.blocked?'Dossier bloqué : rail de paiement, remboursement ou intention à rapprocher.':
            'Aucune ligne non remise avec une preuve de manquant admissible.';
        }else{
          notice.textContent='Commande '+context.order.reference+' · '+context.order.payment_mode+
            ' · payée. Réservation calculée sur la capture originale; aucun taux de change courant.';
          decision.hidden=false;setLimit();
        }
      }catch(error){context=null;notice.textContent=(error.code?error.code+' — ':'')+error.message;}
      finally{loadButton.disabled=false;}
    });
    decision.addEventListener('submit',async event=>{
      event.preventDefault();if(!decision.reportValidity()||!context)return;
      const candidate=context.candidates[Number(candidateSelect.value)];
      if(!candidate||Number(quantity.value)<1||Number(quantity.value)>Number(candidate.available_quantity))return;
      if(!window.confirm('Réserver '+quantity.value+' unité(s) pour un remboursement partiel au payeur original ? Aucun paiement ne sera envoyé à cette étape.'))return;
      reserve.disabled=true;
      try{
        operationKey=operationKey||window.crypto.randomUUID();
        const result=await json('/api/admin/orders/'+encodeURIComponent(context.order.id)+
          '/items/'+encodeURIComponent(candidate.order_item_id)+'/refund-reservations','POST',{
            incident_id:candidate.incident_id,quantity:Number(quantity.value),operation_key:operationKey,reason:reason.value.trim()});
        reservation=result.reservationId;operationKey=null;
        notice.textContent='Réservation '+reservation+' · '+result.amountEur+' EUR · '+result.status+
          '. Vérifiez les détails avant la décision séparée d’exécution sandbox.';
        execute.hidden=result.status!=='reserved';
      }catch(error){notice.textContent=(error.code?error.code+' — ':'')+error.message+
        '. Réessayer sans modifier la décision réutilisera la même clé.';}
      finally{reserve.disabled=false;}
    });
    execute.addEventListener('click',async()=>{
      if(!reservation||executionAttempted||!window.confirm('Envoyer une seule demande de remboursement au PSP sandbox, vers la capture du payeur d’origine ? Une réponse incertaine ne sera jamais relancée automatiquement.'))return;
      executionAttempted=true;execute.disabled=true;
      try{
        const candidate=context.candidates[Number(candidateSelect.value)];
        const result=await json('/api/admin/orders/'+encodeURIComponent(context.order.id)+
          '/items/'+encodeURIComponent(candidate.order_item_id)+'/refund-reservations/'+
          encodeURIComponent(reservation)+'/execute','POST',{});
        execute.hidden=true;
        if(result.status==='confirmed'){
          notice.textContent='Remboursement PSP confirmé; reçu partiel émis ou placé en reprise documentaire.';
          await load(true);
        }else if(result.status==='unknown'){
          notice.textContent='Résultat PSP incertain. Aucun nouvel essai : rapprocher la référence existante.';
        }else{
          notice.textContent='Le PSP a refusé définitivement le remboursement; réservation libérée.';
        }
      }catch(error){execute.hidden=true;notice.textContent='Réponse à rapprocher : '+(error.code?error.code+' — ':'')+
        error.message+'. Aucun nouvel essai automatique ou depuis cet écran.';}
    });
    list.parentNode.insertBefore(panel,list);
  }
  function renderCase(row) {
    const card = append(list, 'article', 'case');
    card.setAttribute('data-g8-case', String(row.reservation_id || row.authorization_id));
    const head = append(card, 'div', 'case-head');
    append(head, 'div', 'case-eyebrow', (row.market_code || '') + ' · ' +
      (row.payment_mode === 'cash_relais' ? 'F1 espèces' : 'F2 Mobile Money'));
    append(head, 'h3', '', row.order_reference || row.order_id);
    const meta = append(head, 'div', 'meta');
    append(meta, 'span', '', 'Quantité : ' + row.quantity);
    append(meta, 'span', '', 'Article : ' + String(row.order_item_id).slice(0, 8));
    const body = append(card, 'div', 'case-body');
    append(body, 'p', 'money', money(row));
    if (row.reason) append(body, 'p', 'case-summary', row.reason);
    if (userRole === 'admin') adminCase(row, body);
    else relayCase(row, body);
  }
  async function load(preserveNotice) {
    refresh.disabled = true;
    if (!preserveNotice) announce('Lecture des obligations autorisées…');
    list.replaceChildren();
    try {
      const url = userRole === 'admin'
        ? '/api/admin/orders/local-refunds'
        : '/api/relay/local-cash-refunds';
      const payload = await json(url);
      const rows = Array.isArray(payload.refunds) ? payload.refunds : [];
      title.textContent = 'Obligations (' + rows.length + ')';
      if (!rows.length) {
        append(list, 'p', 'empty', 'Aucune obligation de remboursement dans cette file.');
      } else {
        rows.forEach(renderCase);
      }
      env.textContent = 'Recette autorisée';
      ensureReservationForm();
      if (!preserveNotice) announce('Lecture autorisée. Les opérations ne réalisent aucun transfert automatique.', 'ok');
    } catch (error) {
      env.textContent = 'Parcours désactivé';
      title.textContent = 'Obligations indisponibles';
      append(list, 'p', 'empty', 'La liste est masquée tant que les flags de recette ou les autorisations sont absents.');
      announce((error.code ? error.code + ' — ' : '') + error.message, 'error');
    } finally { refresh.disabled = false; }
  }
  async function boot() {
    refresh.addEventListener('click', () => load(false));
    try {
      const info = await json('/api/auth/me');
      const actor = info.user || info;
      userRole = actor.role;
      if (!['admin', 'agent_relais'].includes(userRole)) {
        throw new Error('Seuls les administrateurs et agents relais habilités ont accès au parcours G8.');
      }
      if(userRole==='admin'){
        try{
          const readiness=await json('/api/admin/orders/item-refund-readiness');
          if(readiness.enabled===true)ensureItemRefundForm();
        }catch(_){}
      }
      const compensationEntry = document.querySelector('[data-g6-sav-compensation-entry]');
      if (compensationEntry && userRole === 'admin') compensationEntry.hidden = false;
      if (userRole === 'agent_relais') {
        back.href = '/relais/';
        document.querySelector('.brand').href = '/relais/';
      }
      await load(false);
    } catch (error) {
      env.textContent = 'Accès refusé';
      refresh.disabled = true;
      announce(error.message, 'error');
    }
  }
  boot();
}());
