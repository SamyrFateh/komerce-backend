/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/css/hub-live-cockpit.css'), 'utf8');

describe('hub-live-cockpit.css — formulaire de réception dans la colonne', () => {
  test('le formulaire est une grille à colonne unique rétractable (minmax(0, 1fr))', () => {
    expect(css).toMatch(/\.hlc-form \{[^}]*grid-template-columns: minmax\(0, 1fr\);[^}]*min-width: 0;/);
  });

  test('la carte, le tableau et la colonne de saisie ne forcent plus la largeur', () => {
    expect(css).toContain('.hlc-form .kmc-workspace-receive-card { border: 0; padding: 0; background: transparent; min-width: 0; }');
    expect(css).toContain('.hlc-form .kmc-workspace-receive-card .kmc-workspace-table { min-width: 0; }');
    expect(css).toMatch(/\.hlc-form \.kmc-workspace-receive-card \.kmc-workspace-table td:last-child \{ min-width: 0;/);
  });
});

describe('hub-live-cockpit — ancienneté des tâches (H4 #3998)', () => {
  const js = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/hub-live-cockpit.js'), 'utf8');

  test('la pastille affiche l\'âge fourni par le serveur et l\'alerte, sans rien calculer côté navigateur', () => {
    expect(js).toMatch(/item\.age_hours != null/);
    expect(js).toMatch(/hlc-todo-age\$\{item\.overdue \? ' is-overdue' : ''\}/);
    expect(css).toMatch(/\.hlc-todo-age\.is-overdue/);
  });
});

describe('H4 #3998 — branchement global de la directrice dans le vrai poste Hub', () => {
  const central = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/hub-workstation.js'), 'utf8');
  const operations = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
  test('le panneau est dans /admin/hub, pas un deuxième cockpit par marché', () => {
    // Le tableau de direction vit dans sa branche dédiée du poste Hub.
    // La surface interne `host` conserve son propre cycle de rendu :
    // l'ancien contrat attendait le conteneur `content` et était obsolète.
    expect(central).toContain("branch === 'direction'");
    expect(central).toContain('renderDirectorQueue(directorHost,{document:doc,fetch:fetchFn,user})');
    expect(central).toContain("requestJSON(fetchFn,'/api/hub/director-todo')");
    expect(central).toContain("['admin', 'agent_hub'].includes(user && user.role)");
    expect(central).toContain('data-hub-director-list');
    expect(central).toContain('task.age_hours');
    expect(central).toContain('task.overdue');
    expect(central).toContain('/admin/hub-live?view=execute&market=');
    expect(operations).not.toContain("'/api/hub/director-todo'");
    expect(css).toContain('.hlc-director-task.is-overdue');
  });
});

test('le formulaire de simulation fournisseur utilise la référence du dossier PO',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/hub-live-cockpit.js'),'utf8');
  expect(source).toContain("'SIM-STAGING-' + po.simulation_reference");
  expect(source).not.toContain("po.lines[0]?.order_ref");
});

describe('G6 ergonomie UX3 — sélection explicite et alertes métier', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/hub-live-cockpit.js'), 'utf8');
  test('le cockpit ne choisit pas une commande arbitraire au chargement', () => {
    expect(source).toContain('if (!state.selectionInitialized)');
    expect(source).toContain('item.viewer_can_act !== false');
    expect(source).toContain("title: 'Sélectionnez un élément'");
  });
  test('la sélection reste partageable et suit la navigation navigateur', () => {
    expect(source).toContain('function readUrlSelection()');
    expect(source).toContain('function putUrlSelection(type, id)');
    expect(source).toContain("win.history.pushState");
    expect(source).toContain("win.addEventListener('popstate'");
  });
  test('une alerte serveur garde son dossier sélectionnable même absent de la file compacte', () => {
    expect(source).toContain('const inTodo = todo.some(item =>');
    expect(source).toContain('target.type === state.sel.type && target.id === state.sel.id');
    expect(source).toContain('if (!known && !inTodo) state.sel = null;');
  });
});

describe('Hub UX guidée — sans nouvel acte métier', () => {
  const cockpit = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/hub-live-cockpit.js'), 'utf8');
  const operations = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/operations-workspace.js'), 'utf8');
  const opsCss = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/css/operations-workspace.css'), 'utf8');

  test('un seul CTA actif est déplacé, jamais recréé ou redirigé vers un nouveau writer', () => {
    expect(cockpit).toContain('const primaryRow = Array.from(list.children).find');
    expect(cockpit).toContain('nextAction.appendChild(primaryRow)');
    expect(cockpit).toContain("right.insertBefore(nextAction, right.children[1]);");
    expect(cockpit).toContain("nextAction.setAttribute('data-hlc-next-action', '');");
  });

  test('ateliers accessibles, détails ouverts, raccourci réception vers le véritable onglet', () => {
    expect(operations).toContain('secondary.open = true');
    expect(operations).toContain("secondary.setAttribute('data-hub-physical-details', '');");
    expect(operations).toContain("context.view = 'reception';");
    expect(operations).toContain("context.renderCurrent();");
    expect(cockpit).toContain("['reception', 'Réception fournisseur']");
    expect(cockpit).not.toContain("['bags', 'Préparer les sacs']");
    expect(cockpit).toContain("['boxes', 'Préparer les COMBOX']");
    expect(cockpit).not.toContain("ctx.endpoint('bags')");
    expect(cockpit).toContain("'Répartir les articles en COMBOX'");
    expect(cockpit).toContain("ctx.openPhysical('boxes')");
    expect(cockpit).toContain("['shipments', 'Expéditions']");
  });

  test('français métier seulement dans le rendu ; preuves et droits canoniques maintenus', () => {
    expect(cockpit).toContain("PICKED: 'Prélevé', PACKED: 'Emballé', DISPATCHED: 'Prêt au départ'");
    expect(cockpit).toContain("Ordre d’arrivée n°");
    expect(cockpit).toContain("Signification des états");
    expect(operations).toContain('manualProofLabel.hidden = !manualToggle.checked');
    expect(operations).toContain("data-receive-line");
    expect(operations).toContain("data-hub-box-scan");
    expect(opsCss).toContain('.kmc-workspace-receive-field-label');
    expect(css).toContain('.hlc-next-action .hlc-btn.is-primary');
  });
});

test('Hub UX : le conteneur data-hlc-actions englobe les actions du fil et le seul CTA déplacé', () => {
  const js = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/hub-live-cockpit.js'), 'utf8');
  expect(js).toContain("rootEl.setAttribute('data-hlc-actions', '');");
  expect(js).not.toContain("list.setAttribute('data-hlc-actions', '');");
  expect(js).toContain('nextAction.appendChild(primaryRow)');
  expect(js).toContain('rightP.appendChild(list)');
});

test('la file de la direction Hub garde une hauteur réservée et des groupes lisibles', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/css/hub-live-cockpit.css'), 'utf8');
  const src = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/hub-workstation.js'), 'utf8');
  expect(css).toContain('.hlc-director-body {\n  height: 220px;');
  expect(css).toContain('.hlc-director-group-heading');
  expect(css).toContain('.hlc-director-task.is-readonly');
  expect(src).toContain("group.setAttribute('data-hub-director-group',spec.key)");
  expect(src).toContain("task.viewer_can_act===false");
});

describe('M03 — Hub Live exige un prix confirmé et une devise saisis par un humain', () => {
  const js = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/hub-live-cockpit.js'), 'utf8');

  test('ligne sans devis : champs explicites, jamais préremplis par budget ni prix retail', () => {
    expect(js).toContain('if (!(Number(l.unit_price) > 0) || !l.currency)');
    expect(js).toContain("name: 'confirmed_unit_price'");
    expect(js).toContain("textInput('EUR', 'confirmed_currency')");
    expect(js).toContain("p.setAttribute('data-hlc-confirmed-price', '')");
    expect(js).toContain("c.setAttribute('data-hlc-confirmed-currency', '')");
    expect(js).toContain('const confirmMoney = new Map()');
    expect(js).not.toMatch(/confirmed_unit_price\s*=\s*(?:l\.unit_price|po\.amount)/);
  });

  test('la soumission refuse quantité positive sans vrai prix et devise ISO', () => {
    expect(js).toContain('if (money && row.confirmed_quantity > 0)');
    expect(js).toContain('row.confirmed_unit_price = Number(money.p.value)');
    expect(js).toContain('row.confirmed_currency = money.c.value.trim().toUpperCase()');
    expect(js).toContain('Prix confirmé positif et devise obligatoire pour les lignes sans devis fournisseur.');
    expect(js).toContain("purchase_proof_ref: confirmProof.value.trim()");
    expect(js).toContain("seller_label: confirmSeller.value.trim()");
  });
});

describe('M06 — confirmation manuelle avec allocations multi-vendeurs', () => {
  const js = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/hub-live-cockpit.js'), 'utf8');
  test('les allocations sont saisies dans le formulaire Hub et transmises au service canonique', () => {
    expect(js).toContain("data-hlc-execution-seller");
    expect(js).toContain("data-hlc-execution-quantity");
    expect(js).toContain("data-hlc-execution-amount");
    expect(js).toContain("data-hlc-execution-proof");
    expect(js).toContain("executions.push({ purchase_line_id: purchaseLineId, seller_label: sellerLabel");
    expect(js).toContain("...(executions ? { executions } : (confirmSeller.value.trim() ? { seller_label: confirmSeller.value.trim() } : {}))");
    expect(js).toContain('Les allocations vendeurs doivent couvrir exactement la quantité confirmée de chaque ligne.');
  });
  test('le chemin mono-vendeur reste celui utilisé par M01/M03', () => {
    expect(js).toContain("seller_label: confirmSeller.value.trim()");
    expect(js).toContain("if (confirmExecutions.length)");
  });
});


describe('G6 M03 — la PO partagée reste isolable par commande', () => {
  const cockpit = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/hub-live-cockpit.js'), 'utf8');
  const p3 = fs.readFileSync(path.join(__dirname, '../staging-clicks/g6-p3-kuyiyuk.spec.js'), 'utf8');
  const simulation = fs.readFileSync(path.join(__dirname, '../../scripts/recette/g6-hub-vendor-simulation-chromium.js'), 'utf8');

  test('la PO peut être préparée sur les seules lignes d’une commande', () => {
    expect(cockpit).toContain('const byOrder = new Map()');
    expect(cockpit).toContain("if (byOrder.size > 1)");
    expect(cockpit).toContain("A('prepare-po-order-' + orderId,");
    expect(cockpit).toContain('run: (b) => prepareBatch(b, g.batch, orderLines.ids, null)');
    expect(cockpit).toContain('disabled: lock');
  });

  test('le Chromium M03 privilégie le geste par commande et certifie le périmètre PostgreSQL', () => {
    expect(p3).toContain('prepare-po-order-');
    expect(p3).toContain('const members=await q(');
    expect(p3).toContain("expect(members,'G6_HUB_PO_EXACTLY_ONE_PURCHASE_LINE').toHaveLength(1)");
    expect(p3).toContain("expect(members[0].order_id,'G6_HUB_PO_CROSS_ORDER_LINE_BLOCKED').toBe(orderId)");
  });

  test('la confirmation fournisseur simulée refuse une PO M03 contenant une autre commande', () => {
    expect(simulation).toContain('G6_M03_PO_CROSS_ORDER_SCOPE_DRIFT');
    expect(simulation).toContain('report.price_scope=');
    expect(simulation).toContain('G6_SIM_MANUAL_PRICE_UNEXPECTED_SCOPE');
  });
});

test('accès direct aux étiquettes depuis le cockpit physique, avant la COMBOX', () => {
  const src=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/hub-live-cockpit.js'),'utf8');
  expect(src).toContain("['labels', 'Imprimer les étiquettes articles']");
  expect(src.indexOf("['labels',")).toBeLessThan(src.indexOf("['boxes', 'Préparer les COMBOX']"));
});

test('accès Kanban par commande : retrouver les besoins et toutes les PO liées',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/hub-live-cockpit.js'),'utf8');
  expect(js).toContain("A('goto-need-'+group.key");
  expect(js).toContain("line.order_id===o.id");
  expect(js).toContain("(o.po_ids || []).entries()");
});

test('achat Hub : canal API seulement pour les lignes éligibles et contrôle devise avant rattachement',()=>{
 const js=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/hub-live-cockpit.js'),'utf8');
 expect(js).toContain('g.batch.api_available===true');
 expect(js).toContain('lines.every(l=>l.api_eligible===true)');
 expect(js).toContain('execution_mode: executionMode');
 expect(js).toContain('devise incompatible');
});

test('les décisions de Direction restent sur le même formulaire canonique, sans opération physique',()=>{
 const js=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/hub-live-cockpit.js'),'utf8');
 expect(js).toContain('if(!decisionOnly&&ctx.openDecision)ctx.openDecision(id)');
 expect(js).toContain("decisionOnly?acts.filter");
});

describe('Mode Achat compact du Kanban', () => {
  const cockpit = require('../../public/dashboards/canonical/js/hub-live-cockpit');
  function element(tag) {
    const handlers={};
    return {tagName:tag, children:[], attrs:{}, textContent:'', disabled:false,
      appendChild(c){this.children.push(c);return c;},
      replaceChildren(...c){this.children=c;},
      setAttribute(k,v){this.attrs[k]=String(v);},getAttribute(k){return this.attrs[k];},
      addEventListener(k,fn){handlers[k]=fn;},click(){handlers.click?.({stopPropagation(){}});},
      querySelector(){return null;}};
  }
  function nodes(node,predicate){return [node,...node.children.flatMap(n=>nodes(n,predicate))].filter(predicate);}
  const po={id:'p1',ref:'PO-1',status:'draft',step:{key:'draft'},lines:[],order_ids:[],
    totals:{effective:2,missing:2},amount:{derived:true,amount:20,currency:'EUR'},authorizations:{}};
  function mount(viewer, isReadOnly=false){
    const host=element('div'),act=jest.fn();
    const state={sel:{type:'po',id:'p1'},selectionInitialized:true};
    cockpit.render(host,{document:{createElement:element},dossier:{purchase_orders:[po],cockpit:{viewer}},
      state,isReadOnly,purchaseOnly:true,act});
    return {host,act,state};
  }
  test('ouvre uniquement le formulaire canonique engagement et ne poste rien à l’ouverture',()=>{
    const {host,act,state}=mount({role:'admin',can_authorize_commitment:true});
    const buttons=nodes(host,n=>n.attrs['data-hlc-action']);
    expect(buttons.map(b=>b.attrs['data-hlc-action'])).toEqual(['authorize-commitment']);
    expect(buttons[0].disabled).toBe(false);
    buttons[0].click();
    expect(state.form.kind).toBe('commitment');
    expect(nodes(host,n=>n.attrs['data-hlc-form']==='commitment')).toHaveLength(1);
    expect(act).not.toHaveBeenCalled();
  });
  test('sans délégation, engagement désactivé et pas de formulaire',()=>{
    const {host,act}=mount({role:'agent_hub',can_authorize_commitment:false});
    const [button]=nodes(host,n=>n.attrs['data-hlc-action']==='authorize-commitment');
    expect(button.disabled).toBe(true);
    expect(nodes(host,n=>n.attrs['data-hlc-form'])).toHaveLength(0);
    expect(act).not.toHaveBeenCalled();
  });
});

test('confirmation compacte : défaut intégral, saisie des écarts, mêmes contrôles et writer',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/hub-live-cockpit.js'),'utf8');
  expect(js).toContain("value: compact?'0':String(l.ordered)");
  expect(js).toContain("confirmed_quantity: ctx.compactPO===true?Number(l.ordered)-Number(q.value):Number(q.value)");
  expect(js).toContain("Number(q.value)>Number(l.ordered)");
  expect(js).toContain("Justificatif d’achat obligatoire");
  expect(js).toContain("data-hlc-confirm-missing");
});


test('V8 decision focus exposes only existing decision actions',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../../public/dashboards/canonical/js/hub-live-cockpit.js'),'utf8');
 expect(src).toContain("ctx.decisionOnly==='commitment'?['authorize-commitment','download-commitment-pdf']");
 expect(src).toContain("ctx.decisionOnly==='payment'?['authorize-payment']");
 expect(src).toContain('actionsFor().filter(a => allowed.has(a.key)');
});
