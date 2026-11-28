/**
 * @komerce-arch
 * @role          markets-management-ui
 * @domain        admin-dashboard
 * @layer         ui-workspace
 * @criticality   high
 * @inputs        authenticated_admin, /api/admin/markets
 * @outputs       markets_list, readiness_gaps_view, lifecycle_open_suspend_actions, delivery_attestation_form
 * @depends       /api/admin/markets/central-authority, /api/admin/markets, /api/admin/markets/:marketCode/control-plane, /api/admin/markets/:marketCode/lifecycle, /api/admin/markets/:marketCode/delivery-attestations
 * @used-by       /dashboards/canonical/access.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      control_plane_orchestrates_owned_writers, central_by_role_declared, no_new_api, server_readiness_is_authority, merge_is_not_activation
 * @impact-areas  admin-dashboard, market-control-plane
 * @version       2026-10
 */
'use strict';

(function bootMarketsManagement(global) {
  const LABELS = Object.freeze({
    PROVISIONING: 'En préparation',
    ACTIVE: 'Ouvert',
    SUSPENDED: 'Suspendu',
    CLOSED: 'Clôturé',
  });

  // Miroir d'affichage de ALLOWED_TRANSITIONS (services/market-lifecycle-service.js).
  // Le serveur reste l'autorité : une transition refusée remonte son message.
  // CLOSED est volontairement absent de l'UI (irréversible).
  function actionsFor(status) {
    if (status === 'PROVISIONING') return [{ target: 'ACTIVE', label: 'Ouvrir' }];
    if (status === 'ACTIVE') return [{ target: 'SUSPENDED', label: 'Suspendre' }];
    if (status === 'SUSPENDED') return [{ target: 'ACTIVE', label: 'Rouvrir' }];
    return [];
  }

  function statusLabel(status) {
    return LABELS[status] || status || '—';
  }

  function confirmMessage(market, action) {
    const verb = action.target === 'ACTIVE' ? 'ouvrir' : 'suspendre';
    return `Confirmer : ${verb} le marché ${market.code} (${market.name}) ?`;
  }

  async function request(fetchImpl, url, options = {}) {
    const response = await fetchImpl(url, {
      method: options.method || 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body == null ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body == null ? undefined : JSON.stringify(options.body),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = body.code || null;
      throw error;
    }
    return body;
  }

  function el(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  const MODES = ['SEA', 'AIR', 'ROAD', 'MIXED'];
  const RATE_UNITS = ['PER_KG', 'PER_PARCEL'];

  function field(doc, form, name, label, type, choices) {
    const wrap = el(doc, 'label', 'kmc-markets-mgmt-field', label);
    const input = choices ? el(doc, 'select') : el(doc, 'input');
    if (!choices) input.type = type || 'text';
    input.name = name;
    input.dataset.field = name;
    if (choices) {
      choices.forEach(choice => {
        const option = el(doc, 'option', '', choice.label);
        option.value = choice.value;
        input.appendChild(option);
      });
    }
    wrap.appendChild(input);
    form.appendChild(wrap);
    form.fields = form.fields || {};
    form.fields[name] = input;
    return input;
  }

  function attestationPayload(fields) {
    const num = key => (fields[key].value === '' ? null : Number(fields[key].value));
    return {
      carrier_id: fields.carrier_id.value,
      mode: fields.mode.value,
      origin_ref: fields.origin_ref.value,
      freight_rate: num('freight_rate'),
      rate_currency: String(fields.rate_currency.value || '').toUpperCase(),
      rate_unit: fields.rate_unit.value,
      transit_days: num('transit_days'),
      evidence_ref: fields.evidence_ref.value,
      valid_until: fields.valid_until.value ? new Date(`${fields.valid_until.value}T23:59:59Z`).toISOString() : null,
    };
  }

  // Preuve de livrabilité (lot B) : lecture de la readiness serveur, écriture via les routes centrales existantes.
  // Le coût attesté n'est jamais un prix de vente ; l'écran ne montre que la preuve, pas un tarif client.
  function renderDeliveryProof(doc, cell, state, market, options) {
    const proof = state.gaps.deliveryProof || null;
    const hasGap = state.gaps.items.some(gap => gap.code === 'NO_DELIVERY_PROOF');
    const box = el(doc, 'div', 'kmc-markets-mgmt-proof');
    box.dataset.deliveryProof = market.code;
    if (proof && proof.proven && proof.attestation) {
      const att = proof.attestation;
      box.appendChild(el(doc, 'p', '',
        `Livrabilité attestée : ${att.carrier_name} · ${att.mode} depuis ${att.origin_ref} · coût ${att.freight_rate} ${att.rate_currency}/${att.rate_unit === 'PER_KG' ? 'kg' : 'colis'} (coût, pas un prix de vente) · ${att.transit_days} j · valable jusqu’au ${String(att.valid_until).slice(0, 10)} · preuve : ${att.evidence_ref}`));
      const revoke = el(doc, 'form', 'kmc-markets-mgmt-form');
      field(doc, revoke, 'reason', 'Motif de révocation', 'text');
      const submit = el(doc, 'button', 'kmc-access-button is-danger', 'Révoquer l’attestation');
      submit.type = 'submit';
      revoke.appendChild(submit);
      revoke.addEventListener('submit', event => {
        if (event && event.preventDefault) event.preventDefault();
        options.onRevoke(market, att.id, revoke.fields.reason.value);
      });
      box.appendChild(revoke);
    } else if (proof && proof.proven && proof.basis === 'HISTORY') {
      box.appendChild(el(doc, 'p', '', `Livrabilité prouvée par l’historique (${proof.collected_orders} commandes remises). Aucune attestation à saisir.`));
    } else if (hasGap) {
      box.appendChild(el(doc, 'p', '', 'Aucune preuve de livrabilité : saisir une attestation centrale (transporteur, mode, coût de fret, validité, référence de la preuve documentaire).'));
      const form = el(doc, 'form', 'kmc-markets-mgmt-form');
      field(doc, form, 'carrier_id', 'Transporteur', null, [{ value: '', label: '—' }].concat(
        (state.carriers || []).map(carrier => ({ value: carrier.id, label: carrier.name }))));
      field(doc, form, 'mode', 'Mode', null, MODES.map(value => ({ value, label: value })));
      field(doc, form, 'origin_ref', 'Origine', 'text');
      field(doc, form, 'freight_rate', 'Coût de fret', 'number');
      field(doc, form, 'rate_currency', 'Devise du coût', 'text');
      field(doc, form, 'rate_unit', 'Unité', null, RATE_UNITS.map(value => ({ value, label: value === 'PER_KG' ? 'par kg' : 'par colis' })));
      field(doc, form, 'transit_days', 'Délai (jours)', 'number');
      field(doc, form, 'evidence_ref', 'Référence de la preuve', 'text');
      field(doc, form, 'valid_until', 'Valable jusqu’au', 'date');
      const submit = el(doc, 'button', 'kmc-access-button is-primary', 'Attester la livrabilité');
      submit.type = 'submit';
      form.appendChild(submit);
      form.addEventListener('submit', event => {
        if (event && event.preventDefault) event.preventDefault();
        options.onAttest(market, attestationPayload(form.fields));
      });
      box.appendChild(form);
    } else {
      return;
    }
    cell.appendChild(box);
  }

  const INITIAL_LIMITS = [
    ['cash.custody.receive','Réception de caisse'],
    ['execution.cash.confirm','Confirmation cash'],
    ['settlement.receive','Réception des règlements'],
    ['finance.act','Action financière'],
  ];

  function professionalAddress(lastName, firstName) {
    const part = value => String(value || '').trim().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/œ/g,'oe').replace(/æ/g,'ae')
      .replace(/[\s'’\-]+/g, '-');
    const last = part(lastName), first = part(firstName);
    return /^[a-z]+(?:-[a-z]+)*$/.test(last) && /^[a-z]+(?:-[a-z]+)*$/.test(first)
      && last.length + first.length + 1 <= 64 ? last + '.' + first + '@komerce.co' : '';
  }

  function referentChoices(authority) {
    const people = new Map();
    for (const domain of authority?.domains || []) {
      for (const holder of domain.holders || []) {
        const name = holder.full_name || holder.email || holder.user_id;
        const id = String(holder.user_id);
        if (!people.has(id)) people.set(id, { value: id, label: name, domains: [] });
        people.get(id).domains.push(domain.domain);
      }
    }
    return [{ value: '', label: 'Choisir le référent…' }].concat([...people.values()].map(person => ({
      value: person.value, label: person.label + ' — ' + person.domains.join(', '),
    })));
  }

  function initialPayload(values) {
    const timezone = String(values.business_timezone || '').trim();
    if (!timezone) throw new Error('Fuseau horaire IANA du marché requis.');
    try { new Intl.DateTimeFormat('fr-FR',{timeZone:timezone}); } catch (_) { throw new Error('Fuseau horaire IANA invalide.'); }
    const limits = {};
    for (const [cap] of INITIAL_LIMITS) {
      const value = values['limit_' + cap];
      if (value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0) {
        throw new Error('Renseigner chaque plafond financier initial.');
      }
      limits[cap] = Number(value);
    }
    const email = professionalAddress(values.last_name, values.first_name);
    if (!email) throw new Error('Nom et prénom du responsable requis.');
    const cash = values.cash_enabled === 'true';
    const provider = values.provider || '';
    const central = ['stripe_eur','paypal_eur'].filter(mode => values[mode] === 'true').map(mode => {
      const evidence = String(values[mode + '_evidence'] || '').trim();
      if (evidence.length < 3) throw new Error('Référence de décision requise pour ' + mode + '.');
      return { payment_mode: mode, evidence_ref: evidence };
    });
    if (!cash && !provider && !central.length) throw new Error('Sélectionner au moins un moyen de paiement.');
    const relay = String(values.relay_name || '').trim();
    const relayFields = ['relay_phone','relay_address','relay_agent'];
    if ((relay || relayFields.some(key => String(values[key] || '').trim())) &&
        (!relay || !values.relay_phone || !values.relay_address)) {
      throw new Error('Pour créer un premier relais, renseigner nom, téléphone et adresse.');
    }
    return {
      code: String(values.code || '').trim().toUpperCase(),
      name: String(values.name || '').trim(),
      currency: String(values.currency || '').trim().toUpperCase(),
      minor_unit: Number(values.minor_unit),
      business_timezone: timezone,
      central_referent_user_id: values.central_referent_user_id,
      financial_limits: limits,
      lead: { last_name: values.last_name, first_name: values.first_name, phone: values.phone },
      payment_provider: provider ? { provider, currency: String(values.currency || '').trim().toUpperCase(), priority: 10 } : null,
      central_collection_modes: central,
      cash_policy: { cash_enabled: cash, confirmation_mode: values.confirmation_mode },
      initial_relais: relay ? { name: relay, agent_name: values.relay_agent || null,
        phone: values.relay_phone, address: values.relay_address } : null,
    };
  }

  function renderInitialisation(doc, host, state, options) {
    const wizard = state.wizard;
    if (!wizard) return;
    const steps = ['Identité','Responsable et droits','Relais (facultatif)','Paiements','Vérification'];
    const section = el(doc, 'section', 'kmc-access-panel kmc-markets-onboarding');
    section.appendChild(el(doc, 'h3', '', wizard.existingMarket ? 'Initialiser le marché existant · '+wizard.existingMarket : 'Initialiser un marché'));
    section.appendChild(el(doc, 'p', 'kmc-access-muted', 'Étape ' + (wizard.step+1) + ' sur ' + steps.length + ' · ' + steps[wizard.step] + '. La boutique restera fermée.'));
    const form = el(doc, 'form', 'kmc-markets-mgmt-form');
    function input(name, label, type, choices, required = true) {
      const node = field(doc, form, name, label, type, choices);
      node.required = required;
      node.value = wizard.values[name] == null ? '' : wizard.values[name];
      node.addEventListener('input', () => { wizard.values[name] = node.value; });
      node.addEventListener('change', () => { wizard.values[name] = node.value; });
      return node;
    }
    if (wizard.step === 0) {
      const code = input('code','Code pays (ISO à 2 lettres)','text');
      code.maxLength = 2; code.pattern = '[A-Za-z]{2}';
      const name = input('name','Nom du marché','text');
      if(wizard.existingMarket){code.readOnly=true;name.readOnly=true;}
      const currencies = wizard.authority.currency_options || [];
      const currency = input('currency','Devise (moteur de change canonique)',null,[{value:'',label:'Choisir…'}].concat(currencies.map(c=>({value:c.code,label:c.code}))));
      const unit = input('minor_unit','Décimales de la devise','number');
      unit.readOnly = true;
      function syncUnit(){
        const selected = currencies.find(c=>c.code===currency.value);
        unit.value = selected ? String(selected.minor_unit) : '';
        wizard.values.minor_unit = unit.value;
      }
      currency.addEventListener('change',syncUnit);
      if(wizard.existingMarket){currency.disabled=true;unit.value=wizard.values.minor_unit;}
      else syncUnit();
      const timezone = input('business_timezone','Fuseau horaire IANA du marché','text');
      timezone.placeholder = 'Ex. Africa/Libreville';
      if(wizard.existingMarket && wizard.fixedTimezone)timezone.readOnly=true;
      form.appendChild(el(doc,'p','kmc-access-muted','La conversion EUR est contrôlée par le serveur. Langue initiale : français.'));
    } else if (wizard.step === 1) {
      input('central_referent_user_id','Référent central',null,referentChoices(wizard.authority));
      const last = input('last_name','Nom du responsable','text');
      const first = input('first_name','Prénom du responsable','text');
      const email = field(doc,form,'email_preview','Identifiant professionnel (automatique)','text');
      email.readOnly = true;
      function preview() { email.value = professionalAddress(last.value, first.value); }
      preview();
      last.addEventListener('input', () => { wizard.values.last_name = last.value; preview(); });
      first.addEventListener('input', () => { wizard.values.first_name = first.value; preview(); });
      input('phone','Téléphone international du responsable','tel');
      form.appendChild(el(doc,'p','kmc-access-muted','Rôle responsable marché, périmètre du nouveau marché. Aucun mot de passe ni boîte mail à créer.'));
      for (const [cap,label] of INITIAL_LIMITS) {
        const limit = input('limit_' + cap,label + ' — plafond (' + (wizard.values.currency || '').toUpperCase() + ')','number');
        limit.min = '0'; limit.step = '0.01';
      }
    } else if (wizard.step === 2) {
      form.appendChild(el(doc,'p','kmc-access-muted','Le responsable pourra organiser son réseau dans son dashboard. Vous pouvez passer cette étape.'));
      input('relay_name','Nom du premier relais','text',null,false);
      input('relay_agent','Agent (nom affiché)','text',null,false);
      input('relay_phone','Téléphone du relais','tel',null,false);
      input('relay_address','Adresse du relais','text',null,false);
    } else if (wizard.step === 3) {
      input('cash_enabled','Cash au relais',null,[{value:'',label:'Choisir…'},{value:'true',label:'Autorisé'},{value:'false',label:'Non autorisé'}]);
      input('confirmation_mode','Contrôle de caisse',null,[{value:'',label:'Choisir…'},{value:'SINGLE',label:'Confirmation simple'},{value:'DUAL_ALWAYS',label:'Double confirmation'}]);
      const options = wizard.authority.payment_options || { central:[], mobile:[] };
      const eligible = options.mobile.filter(option => option.market_code === String(wizard.values.code || '').toUpperCase());
      if (!eligible.some(option => option.provider === wizard.values.provider)) wizard.values.provider = '';
      input('provider','Fournisseur mobile money (facultatif)',null,[{value:'',label:'Aucun'}].concat(
        eligible.map(option => ({ value:option.provider, label:option.label + (option.configured ? '' : ' — configuration technique manquante') }))),false);
      if (!eligible.length) form.appendChild(el(doc,'p','kmc-access-muted','Aucun adaptateur mobile money disponible pour ce marché.'));
      for (const option of options.central) {
        input(option.mode,option.label + (option.configured ? '' : ' — configuration technique manquante'),null,[
          {value:'false',label:'Non autorisé'},{value:'true',label:'Autorisé par décision centrale'},
        ],false);
        input(option.mode+'_evidence','Référence de décision du titulaire des fonds — '+option.label,'text',null,false);
      }
      form.appendChild(el(doc,'p','kmc-access-muted','Les moyens centraux exigent une décision du propriétaire. La configuration technique manquante bloque leur disponibilité. Le cash seul est possible.'));
    } else {
      const values = wizard.values;
      for (const line of [
        values.name + ' (' + values.code + ') — ' + values.currency + ' · ' + values.business_timezone,
        'Responsable : ' + values.last_name + ' ' + values.first_name,
        professionalAddress(values.last_name, values.first_name) + ' · ' + values.phone,
        'Premier relais : ' + (values.relay_name || 'à configurer localement'),
        'Paiements : ' + [values.cash_enabled==='true'?'Cash au relais':'', values.provider||'',values.stripe_eur==='true'?'Stripe EUR':'',values.paypal_eur==='true'?'PayPal EUR':''].filter(Boolean).join(', '),
      ]) form.appendChild(el(doc,'p','',line));
      form.appendChild(el(doc,'p','kmc-access-muted','Les raccordements et prérequis sont contrôlés par le serveur. Cette action ne publie pas la boutique.'));
    }
    if (wizard.step > 0) {
      const back = el(doc,'button','kmc-access-button','Précédent');
      back.type = 'button'; back.disabled = Boolean(wizard.busy);
      back.addEventListener('click', () => options.onWizardBack());
      form.appendChild(back);
    }
    const next = el(doc,'button','kmc-access-button is-primary',wizard.step === 4 ? 'Initialiser le marché' : 'Suivant');
    next.type = 'submit'; next.disabled = Boolean(wizard.busy);
    form.appendChild(next);
    const cancel = el(doc,'button','kmc-access-button','Fermer');
    cancel.type = 'button'; cancel.disabled = Boolean(wizard.busy);
    cancel.addEventListener('click', () => options.onWizardClose());
    form.appendChild(cancel);
    if (wizard.error) form.appendChild(el(doc,'p','kmc-access-feedback is-critical',wizard.error));
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (wizard.busy) return;
      for (const [key,node] of Object.entries(form.fields || {})) {
        if (key !== 'email_preview') wizard.values[key] = node.value;
      }
      return options.onWizardNext();
    });
    section.appendChild(form);
    host.appendChild(section);
  }

  function render(host, state, options) {
    const doc = options.document;
    host.replaceChildren();
    host.appendChild(el(doc, 'h2', '', 'Gestion des marchés'));
    host.appendChild(el(doc, 'p', 'kmc-access-muted',
      'Initialiser un marché, suivre sa préparation, puis autoriser son ouverture. Le serveur contrôle les prérequis.'));

    const feedback = el(doc, 'p', `kmc-access-feedback${state.feedbackTone ? ` is-${state.feedbackTone}` : ''}`, state.feedback || '');
    feedback.setAttribute('role', 'status');
    host.appendChild(feedback);
    const create = el(doc, 'button', 'kmc-access-button is-primary', state.wizard ? 'Reprendre la création' : 'Nouveau marché');
    create.type = 'button';
    create.disabled = Boolean(state.wizard?.busy);
    create.addEventListener('click', () => options.onWizardOpen());
    host.appendChild(create);
    renderInitialisation(doc, host, state, options);

    if (!state.markets.length) {
      host.appendChild(el(doc, 'p', 'kmc-access-muted', 'Aucun marché.'));
      return;
    }

    const table = el(doc, 'table', 'kmc-markets-mgmt-table');
    const head = el(doc, 'tr');
    ['Marché', 'Devise', 'État', 'Équipe active', 'Actions'].forEach(label => head.appendChild(el(doc, 'th', '', label)));
    table.appendChild(el(doc, 'thead')).appendChild(head);
    const body = el(doc, 'tbody');
    state.markets.forEach(market => {
      const row = el(doc, 'tr');
      row.dataset.marketCode = market.code;
      row.appendChild(el(doc, 'td', '', `${market.code} · ${market.name}`));
      row.appendChild(el(doc, 'td', '', market.currency));
      const status = el(doc, 'td');
      status.appendChild(el(doc, 'span', 'kmc-markets-mgmt-status', statusLabel(market.lifecycle_status)));
      row.appendChild(status);
      row.appendChild(el(doc, 'td', '', market.active_members == null ? '—' : market.active_members));
      const actions = el(doc, 'td', 'kmc-markets-mgmt-actions');
      const gapsButton = el(doc, 'button', 'kmc-access-button', 'Voir les écarts');
      gapsButton.type = 'button';
      gapsButton.addEventListener('click', () => options.onGaps(market));
      actions.appendChild(gapsButton);
      actionsFor(market.lifecycle_status).forEach(action => {
        const button = el(doc, 'button', action.target === 'ACTIVE' ? 'kmc-access-button is-primary' : 'kmc-access-button is-danger', action.label);
        button.type = 'button';
        button.dataset.lifecycleTarget = action.target;
        button.addEventListener('click', () => options.onLifecycle(market, action));
        actions.appendChild(button);
      });
      row.appendChild(actions);
      body.appendChild(row);
      if (state.gaps && state.gaps.code === market.code) {
        const detail = el(doc, 'tr', 'kmc-markets-mgmt-gaps');
        const cell = el(doc, 'td');
        cell.colSpan = 5;
        if (!state.gaps.items.length) {
          cell.appendChild(el(doc, 'p', '', 'Aucun écart : le marché est prêt.'));
        } else {
          const list = el(doc, 'ul');
          state.gaps.items.forEach(gap => list.appendChild(el(doc, 'li', '', gap.message || gap.code)));
          cell.appendChild(list);
        }
        const current = state.gaps.market;
        if(market.lifecycle_status==='PROVISIONING' && current){
          if(state.gaps.assignmentStatus===null || state.gaps.assignmentStatus==='ENDED'){
            const initialise=el(doc,'button','kmc-access-button is-primary','Initialiser ce marché existant');
            initialise.type='button';
            initialise.addEventListener('click',()=>options.onHistoricalWizard(current));
            cell.appendChild(initialise);
          }else if(state.gaps.assignmentStatus==='ACTIVE'){
            cell.appendChild(el(doc,'p','kmc-access-muted','Préparation existante conservée : équipe, relais, paiements et référentiels ne sont pas recréés. Le responsable poursuit dans son dashboard canonique.'));
            if(current.business_timezone===null){
              const form=el(doc,'form','kmc-markets-mgmt-form');
              const timezone=field(doc,form,'business_timezone','Compléter le fuseau horaire IANA','text');
              timezone.required=true;timezone.placeholder='Ex. Africa/Libreville';
              const save=el(doc,'button','kmc-access-button','Enregistrer le fuseau');
              save.type='submit';form.appendChild(save);
              form.addEventListener('submit',event=>{event.preventDefault();return options.onCompleteTimezone(current,timezone.value);});
              cell.appendChild(form);
            }
          }else{
            cell.appendChild(el(doc,'p','kmc-access-muted','Mandat non actif : traiter son statut avant de poursuivre, sans recréer une équipe.'));
          }
        }
        renderDeliveryProof(doc, cell, state, market, options);
        detail.appendChild(cell);
        body.appendChild(detail);
      }
    });
    table.appendChild(body);
    host.appendChild(table);
  }

  async function mount(host, options = {}) {
    const fetchImpl = options.fetch || global.fetch.bind(global);
    const confirmImpl = options.confirm || ((message) => global.confirm(message));
    const state = { markets: [], gaps: null, feedback: '', feedbackTone: '' };
    const ctx = { document: options.document || global.document };

    async function load() {
      const payload = await request(fetchImpl, '/api/admin/markets');
      state.markets = Array.isArray(payload.markets) ? payload.markets : [];
    }
    function paint() { render(host, state, ctx); }

    ctx.onWizardOpen = async () => {
      if (state.wizard) return;
      try {
        const authority = await request(fetchImpl, '/api/admin/markets/central-authority');
        state.wizard = { step: 0, values: { minor_unit: '0' }, authority, error: '', busy: false };
        state.feedback = '';
      } catch (error) { state.feedback = error.message; state.feedbackTone = 'critical'; }
      paint();
    };
    ctx.onHistoricalWizard = async market => {
      if(state.wizard)return;
      try{
        const authority=await request(fetchImpl,'/api/admin/markets/central-authority');
        state.wizard={step:0,existingMarket:market.code,fixedTimezone:market.business_timezone||null,
          values:{code:market.code,name:market.name,currency:market.currency,minor_unit:String(market.minor_unit),business_timezone:market.business_timezone||''},
          authority,error:'',busy:false};
        state.feedback='';
      }catch(error){state.feedback=error.message;state.feedbackTone='critical';}
      paint();
    };
    ctx.onCompleteTimezone=async(market,timezone)=>{
      try{
        await request(fetchImpl,'/api/admin/markets/'+encodeURIComponent(market.code)+'/reprovision',{method:'POST',body:{operation:'complete_timezone',business_timezone:String(timezone||'').trim()}});
        await load();
        await ctx.onGaps(market);
        state.feedback='Fuseau du marché '+market.code+' enregistré, configuration existante conservée.';
        state.feedbackTone='positive';
      }catch(error){state.feedback=error.message;state.feedbackTone='critical';}
      paint();
    };
    ctx.onWizardBack = () => {
      if (!state.wizard || state.wizard.busy) return;
      state.wizard.step--; state.wizard.error = ''; paint();
    };
    ctx.onWizardClose = () => {
      if (!state.wizard || state.wizard.busy) return;
      if (!confirmImpl('Fermer la création ? Les données non envoyées seront perdues.')) return;
      state.wizard = null; paint();
    };
    ctx.onWizardNext = async () => {
      const wizard = state.wizard;
      if (!wizard || wizard.busy) return;
      wizard.error = '';
      if (wizard.step === 1 && !professionalAddress(wizard.values.last_name,wizard.values.first_name)) {
        wizard.error = 'Vérifier le nom et le prénom du responsable.'; paint(); return;
      }
      if (wizard.step < 4) { wizard.step++; paint(); return; }
      let payload;
      try { payload = initialPayload(wizard.values); }
      catch (error) { wizard.error = error.message; paint(); return; }
      wizard.busy = true; paint();
      try {
        const endpoint=wizard.existingMarket?'/api/admin/markets/'+encodeURIComponent(wizard.existingMarket)+'/reprovision':'/api/admin/markets';
        const result = await request(fetchImpl,endpoint,{method:'POST',body:payload});
        state.wizard = null;
        state.feedback = 'Marché ' + result.market.code + ' initialisé. Boutique fermée.';
        state.feedbackTone = 'positive';
        await load();
        await ctx.onGaps(result.market);
      } catch (error) {
        if (state.wizard) { wizard.busy = false; wizard.error = error.message; }
        else { state.feedback = error.message; state.feedbackTone = 'critical'; }
      }
      paint();
    };

    ctx.onGaps = async market => {
      try {
        const control = await request(fetchImpl, `/api/admin/markets/${encodeURIComponent(market.code)}/control-plane`);
        state.gaps = { code: market.code, items: control.gaps || [], deliveryProof: control.deliveryProof || null,
          market:control.market||null,assignmentStatus:control.assignment?.status??null };
        state.carriers = Array.isArray(control.carriers) ? control.carriers : [];
        state.feedback = '';
      } catch (error) {
        state.feedback = error.message;
        state.feedbackTone = 'critical';
      }
      paint();
    };
    ctx.onLifecycle = async (market, action) => {
      if (!confirmImpl(confirmMessage(market, action))) return;
      try {
        await request(fetchImpl, `/api/admin/markets/${encodeURIComponent(market.code)}/lifecycle`, {
          method: 'POST', body: { status: action.target },
        });
        await load();
        state.feedback = `Marché ${market.code} : ${statusLabel(action.target).toLowerCase()}.`;
        state.feedbackTone = 'positive';
      } catch (error) {
        state.feedback = error.message;
        state.feedbackTone = 'critical';
        if (error.code === 'MARKET_NOT_READY_FOR_ACTIVATION') state.gaps = null;
      }
      paint();
    };

    ctx.onAttest = async (market, payload) => {
      try {
        await request(fetchImpl, `/api/admin/markets/${encodeURIComponent(market.code)}/delivery-attestations`, {
          method: 'POST', body: payload,
        });
        await ctx.onGaps(market);
        state.feedback = `Marché ${market.code} : livrabilité attestée.`;
        state.feedbackTone = 'positive';
        paint();
        return;
      } catch (error) {
        state.feedback = error.message;
        state.feedbackTone = 'critical';
      }
      paint();
    };
    ctx.onRevoke = async (market, attestationId, reason) => {
      if (!confirmImpl(`Confirmer : révoquer l’attestation de livrabilité du marché ${market.code} ? Cette révocation retire la preuve documentaire ; elle ne ferme pas le marché.`)) return;
      try {
        await request(fetchImpl, `/api/admin/markets/${encodeURIComponent(market.code)}/delivery-attestations/${encodeURIComponent(attestationId)}/revoke`, {
          method: 'POST', body: { reason },
        });
        await ctx.onGaps(market);
        state.feedback = `Marché ${market.code} : attestation révoquée.`;
        state.feedbackTone = 'positive';
        paint();
        return;
      } catch (error) {
        state.feedback = error.message;
        state.feedbackTone = 'critical';
      }
      paint();
    };

    try {
      await load();
    } catch (error) {
      state.feedback = error.message;
      state.feedbackTone = 'critical';
    }
    paint();
    return state;
  }

  const api = { actionsFor, statusLabel, confirmMessage, professionalAddress, initialPayload, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.KomerceMarketsManagement = api;

  // Montage sur access.html (admin) : section après la vue décision, avant les accès.
  const doc = global.document;
  const root = doc && doc.getElementById && doc.getElementById('canonical-admin-root');
  if (!root || typeof global.fetch !== 'function') return;
  let attempts = 80;
  (function wait() {
    if (root.querySelector('.kmc-access-hero')) {
      const host = doc.createElement('section');
      host.id = 'markets-management';
      host.className = 'kmc-access-panel kmc-markets-mgmt';
      const overview = doc.getElementById('markets-decision-admin-overview');
      if (overview && overview.parentNode) overview.parentNode.insertBefore(host, overview.nextSibling);
      else root.insertBefore(host, root.querySelector('.kmc-access-hero'));
      mount(host, { document: doc });
      return;
    }
    attempts -= 1;
    if (attempts > 0) global.setTimeout(wait, 50);
  }());
}(typeof window !== 'undefined' ? window : globalThis));
