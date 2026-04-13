/* ===================================================================
   Komerce Control Tower — ct-scenarios.js
   Config-driven test scenarios, extensible by registering new ones.
   =================================================================== */
window.CT = window.CT || {};
CT.scenarios = [];

/**
 * Register a test scenario.
 */
CT.registerScenario = function(scenario) {
  CT.scenarios.push(scenario);
};

/**
 * Execute a scenario: collect field values, call execute(), display result.
 */
CT.executeScenario = async function(scenario, container) {
  var btn = container.querySelector('#btn-' + scenario.id);
  var resultEl = container.querySelector('#result-' + scenario.id);
  if (!btn || !resultEl) return;

  // Collect form field values
  var params = {};
  if (scenario.fields) {
    scenario.fields.forEach(function(f) {
      var fieldEl = container.querySelector('#field-' + scenario.id + '-' + f.key);
      if (fieldEl) {
        params[f.key] = f.type === 'number' ? Number(fieldEl.value) : fieldEl.value;
      }
    });
  }

  // Set loading state
  var origText = btn.textContent;
  btn.textContent = '⏳ Exécution...';
  btn.disabled = true;
  resultEl.className = 'ct-scenario-result';
  resultEl.style.display = 'none';
  resultEl.textContent = '';

  try {
    var result = await scenario.execute(params);
    resultEl.className = 'ct-scenario-result success';
    resultEl.style.display = 'block';
    if (typeof result === 'string') {
      resultEl.innerHTML = result;
    } else {
      resultEl.textContent = JSON.stringify(result, null, 2);
    }
  } catch (e) {
    resultEl.className = 'ct-scenario-result error';
    resultEl.style.display = 'block';
    resultEl.textContent = '❌ ' + (e.message || 'Erreur inconnue');
  }

  btn.textContent = origText;
  btn.disabled = false;

  // Auto-refresh dashboard after 2s
  setTimeout(function() {
    if (CT.currentView && CT.currentView !== 'scenarios') {
      CT.navigate(CT.currentView);
    }
  }, 2000);
};

/* ---------------------------------------------------------------
   CATEGORY: setup
   --------------------------------------------------------------- */

CT.registerScenario({
  id: 'seed-data',
  name: 'Injecter données test',
  icon: '🌱',
  category: 'setup',
  description: 'Injecte un jeu de données de test complet (produits, commandes, clients). Idéal pour démarrer.',
  fields: [],
  execute: async function() {
    var result = await CT.api.seedTest();
    return '✅ Données de test injectées avec succès.\n' + JSON.stringify(result, null, 2);
  }
});

CT.registerScenario({
  id: 'reset-data',
  name: 'Reset complet',
  icon: '🗑️',
  category: 'setup',
  description: 'Supprime TOUTES les données (commandes, clients, produits). Irréversible !',
  fields: [],
  execute: async function() {
    if (!confirm('⚠️ Supprimer TOUTES les données ? Cette action est irréversible.')) {
      return '🚫 Reset annulé par l\'utilisateur.';
    }
    var result = await CT.api.resetAll();
    return '✅ Reset complet effectué.\n' + JSON.stringify(result, null, 2);
  }
});

/* ---------------------------------------------------------------
   CATEGORY: orders
   --------------------------------------------------------------- */

CT.registerScenario({
  id: 'create-order',
  name: 'Créer commande',
  icon: '🛒',
  category: 'orders',
  description: 'Crée une commande pour un client invité. Sélectionnez un produit et les détails de livraison.',
  fields: [
    { key: 'product', label: 'Produit', type: 'select', options: [{ value: '', label: 'Chargement...' }] },
    { key: 'qty', label: 'Quantité', type: 'number', default: '1' },
    { key: 'payment', label: 'Mode de paiement', type: 'select', options: [
      { value: 'cash_relais', label: 'Cash relais' },
      { value: 'stripe_eur', label: 'Stripe EUR' }
    ], default: 'cash_relais' },
    { key: 'relayPoint', label: 'Point relais', type: 'select', options: [
      { value: 'Moroni Centre', label: 'Moroni Centre' },
      { value: 'Mutsamudu', label: 'Mutsamudu' },
      { value: 'Fomboni', label: 'Fomboni' },
      { value: 'Domicile', label: 'Domicile' }
    ], default: 'Moroni Centre' },
    { key: 'customerName', label: 'Nom du client', type: 'text', default: 'Client Test' },
    { key: 'customerPhone', label: 'Téléphone', type: 'text', default: '+2693210000' }
  ],
  execute: async function(params) {
    if (!params.product) throw new Error('Veuillez sélectionner un produit');

    // Step 1: Guest checkout to get customer session
    var guest = await CT.api.guestCheckout(params.customerPhone, params.customerName);
    var msg = '👤 Client invité créé: ' + (params.customerName) + '\n';

    // Step 2: Create order
    var orderData = {
      items: [{ product_id: params.product, quantity: parseInt(params.qty) || 1 }],
      relay_point_id: params.relayPoint,
      payment_mode: params.payment,
      recipient_name: params.customerName,
      recipient_phone: params.customerPhone
    };
    var order = await CT.api.createOrder(orderData);
    msg += '✅ Commande créée !\n';
    msg += '📋 Référence: ' + (order.reference || order.id || '—') + '\n';
    msg += '💰 Total: ' + CT.html.formatKMF(order.total_kmf) + '\n';
    msg += '📍 Relais: ' + params.relayPoint;
    return msg;
  }
});

CT.registerScenario({
  id: 'advance-order',
  name: 'Avancer commande',
  icon: '⏩',
  category: 'orders',
  description: 'Avance une commande au statut suivant dans le flux. Affiche un stepper visuel.',
  fields: [
    { key: 'reference', label: 'Référence commande', type: 'text', default: '' }
  ],
  execute: async function(params) {
    if (!params.reference) throw new Error('Veuillez entrer une référence');

    var order = await CT.api.getOrder(params.reference);
    if (!order || !order.id) throw new Error('Commande non trouvée: ' + params.reference);

    var flow = ['new','confirmed','ordered','preparation','shipped','in_transit','available','collected','delivered'];
    var current = order.status;
    var currentIdx = flow.indexOf(current);

    if (currentIdx === -1) throw new Error('Statut actuel "' + current + '" non avançable (annulé/retourné ?)');
    if (currentIdx >= flow.length - 1) throw new Error('Commande déjà au statut final: ' + CT.html.statusLabel(current));

    var nextStatus = flow[currentIdx + 1];
    await CT.api.updateOrderStatus(order.id, nextStatus);

    // Build stepper HTML
    var stepper = '<div class="ct-stepper">';
    flow.forEach(function(s, i) {
      var cls = i < currentIdx + 1 ? 'done' : (i === currentIdx + 1 ? 'current' : 'pending');
      if (i > 0) stepper += '<span class="ct-step-arrow">→</span>';
      stepper += '<span class="ct-step ' + cls + '">' + CT.html.statusLabel(s) + '</span>';
    });
    stepper += '</div>';

    return '✅ Commande ' + params.reference + ' avancée\n' +
           CT.html.statusLabel(current) + ' → ' + CT.html.statusLabel(nextStatus) + '\n\n' +
           stepper;
  }
});

CT.registerScenario({
  id: 'bulk-orders',
  name: 'Créer lot de commandes',
  icon: '📦',
  category: 'orders',
  description: 'Crée N commandes aléatoires avec des produits, clients et modes de paiement variés.',
  fields: [
    { key: 'count', label: 'Nombre de commandes', type: 'number', default: '5' }
  ],
  execute: async function(params) {
    var count = parseInt(params.count) || 5;
    if (count < 1 || count > 50) throw new Error('Nombre entre 1 et 50');

    // Fetch available products
    var products = await CT.api.products();
    if (!products || products.length === 0) throw new Error('Aucun produit disponible. Injectez d\'abord les données test.');

    var relays = ['Moroni Centre', 'Mutsamudu', 'Fomboni', 'Domicile'];
    var payments = ['cash_relais', 'stripe_eur'];
    var names = ['Ali Hassan', 'Fatima Mohamed', 'Youssouf Ahmed', 'Amina Said', 'Ibrahim Abdou',
                 'Mariama Combo', 'Omar Bacar', 'Salima Ali', 'Nassim Djae', 'Hadidja Moussa'];
    var results = [];

    for (var i = 0; i < count; i++) {
      try {
        var name = names[i % names.length];
        var phone = '+26932' + String(10000 + i).padStart(5, '0');
        var product = products[Math.floor(Math.random() * products.length)];
        var payment = payments[Math.floor(Math.random() * payments.length)];
        var relay = relays[Math.floor(Math.random() * relays.length)];

        // Guest checkout
        await CT.api.guestCheckout(phone, name);

        // Create order
        var order = await CT.api.createOrder({
          items: [{ product_id: product.id, quantity: 1 + Math.floor(Math.random() * 3) }],
          relay_point_id: relay,
          payment_mode: payment,
          recipient_name: name,
          recipient_phone: phone
        });
        results.push('✅ #' + (i + 1) + ' ' + (order.reference || '—') + ' — ' + name + ' — ' + product.name);
      } catch (e) {
        results.push('❌ #' + (i + 1) + ' Erreur: ' + e.message);
      }
    }

    return '📦 Création de ' + count + ' commandes terminée:\n\n' + results.join('\n');
  }
});

/* ---------------------------------------------------------------
   CATEGORY: problems
   --------------------------------------------------------------- */

CT.registerScenario({
  id: 'simulate-delay',
  name: 'Simuler retard',
  icon: '⏰',
  category: 'problems',
  description: 'Crée une commande antidatée pour simuler un retard. En production, created_at serait modifié directement en base.',
  fields: [
    { key: 'daysBack', label: 'Jours de retard', type: 'number', default: '15' }
  ],
  execute: async function(params) {
    var daysBack = parseInt(params.daysBack) || 15;

    // Fetch products
    var products = await CT.api.products();
    if (!products || products.length === 0) throw new Error('Aucun produit. Injectez les données test d\'abord.');

    var product = products[0];
    var name = 'Client Retard Test';
    var phone = '+2693299999';

    // Create guest + order
    await CT.api.guestCheckout(phone, name);
    var order = await CT.api.createOrder({
      items: [{ product_id: product.id, quantity: 1 }],
      relay_point_id: 'Moroni Centre',
      payment_mode: 'cash_relais',
      recipient_name: name,
      recipient_phone: phone
    });

    // Advance to confirmed so it sits in pipeline
    if (order.id) {
      try { await CT.api.updateOrderStatus(order.id, 'confirmed'); } catch(e) {}
    }

    return '✅ Commande créée: ' + (order.reference || order.id) + '\n' +
           '⏰ Pour simuler un retard de ' + daysBack + ' jours:\n' +
           '   → En production, mettre à jour created_at via SQL:\n' +
           '   UPDATE orders SET created_at = NOW() - INTERVAL \'' + daysBack + ' days\' WHERE id = \'' + order.id + '\';\n\n' +
           'La commande est au statut "confirmed" et apparaîtra dans les dashboards.';
  }
});

CT.registerScenario({
  id: 'cancel-order',
  name: 'Annuler commande',
  icon: '❌',
  category: 'problems',
  description: 'Annule une commande en la passant au statut "cancelled".',
  fields: [
    { key: 'reference', label: 'Référence commande', type: 'text', default: '' }
  ],
  execute: async function(params) {
    if (!params.reference) throw new Error('Veuillez entrer une référence');
    var order = await CT.api.getOrder(params.reference);
    if (!order || !order.id) throw new Error('Commande non trouvée: ' + params.reference);
    if (order.status === 'cancelled') throw new Error('Commande déjà annulée');

    var prevStatus = order.status;
    await CT.api.updateOrderStatus(order.id, 'cancelled');
    return '✅ Commande ' + params.reference + ' annulée\n' +
           CT.html.statusLabel(prevStatus) + ' → ' + CT.html.statusLabel('cancelled');
  }
});

CT.registerScenario({
  id: 'return-order',
  name: 'Retour commande',
  icon: '↩️',
  category: 'problems',
  description: 'Passe une commande au statut "returned" (retournée).',
  fields: [
    { key: 'reference', label: 'Référence commande', type: 'text', default: '' }
  ],
  execute: async function(params) {
    if (!params.reference) throw new Error('Veuillez entrer une référence');
    var order = await CT.api.getOrder(params.reference);
    if (!order || !order.id) throw new Error('Commande non trouvée: ' + params.reference);
    if (order.status === 'returned') throw new Error('Commande déjà retournée');

    var prevStatus = order.status;
    await CT.api.updateOrderStatus(order.id, 'returned');
    return '✅ Commande ' + params.reference + ' retournée\n' +
           CT.html.statusLabel(prevStatus) + ' → ' + CT.html.statusLabel('returned');
  }
});

CT.registerScenario({
  id: 'inject-anomalies',
  name: 'Injecter anomalies',
  icon: '🐛',
  category: 'problems',
  description: 'Crée 3 commandes dans des états divers pour tester la robustesse du dashboard.',
  fields: [],
  execute: async function() {
    var products = await CT.api.products();
    if (!products || products.length === 0) throw new Error('Aucun produit. Injectez les données test d\'abord.');

    var results = [];

    // Anomaly 1: Order with minimal data
    try {
      await CT.api.guestCheckout('+2693200001', 'Anomalie Minimal');
      var o1 = await CT.api.createOrder({
        items: [{ product_id: products[0].id, quantity: 1 }],
        relay_point_id: 'Moroni Centre',
        payment_mode: 'cash_relais',
        recipient_name: 'Anomalie Minimal',
        recipient_phone: '+2693200001'
      });
      results.push('✅ Anomalie 1 (minimal): ' + (o1.reference || o1.id));
    } catch(e) {
      results.push('❌ Anomalie 1: ' + e.message);
    }

    // Anomaly 2: Order then immediately cancelled
    try {
      await CT.api.guestCheckout('+2693200002', 'Anomalie Annulée');
      var o2 = await CT.api.createOrder({
        items: [{ product_id: products[Math.min(1, products.length - 1)].id, quantity: 10 }],
        relay_point_id: 'Mutsamudu',
        payment_mode: 'stripe_eur',
        recipient_name: 'Anomalie Annulée',
        recipient_phone: '+2693200002'
      });
      if (o2.id) await CT.api.updateOrderStatus(o2.id, 'cancelled');
      results.push('✅ Anomalie 2 (annulée immédiat): ' + (o2.reference || o2.id));
    } catch(e) {
      results.push('❌ Anomalie 2: ' + e.message);
    }

    // Anomaly 3: Order advanced to shipped state
    try {
      await CT.api.guestCheckout('+2693200003', 'Anomalie Expédiée');
      var o3 = await CT.api.createOrder({
        items: [{ product_id: products[0].id, quantity: 5 }],
        relay_point_id: 'Fomboni',
        payment_mode: 'cash_relais',
        recipient_name: 'Anomalie Expédiée',
        recipient_phone: '+2693200003'
      });
      if (o3.id) {
        var advanceSteps = ['confirmed', 'ordered', 'preparation', 'shipped'];
        for (var i = 0; i < advanceSteps.length; i++) {
          try { await CT.api.updateOrderStatus(o3.id, advanceSteps[i]); } catch(e2) { break; }
        }
      }
      results.push('✅ Anomalie 3 (expédiée): ' + (o3.reference || o3.id));
    } catch(e) {
      results.push('❌ Anomalie 3: ' + e.message);
    }

    return '🐛 Injection d\'anomalies terminée:\n\n' + results.join('\n');
  }
});

/* ---------------------------------------------------------------
   CATEGORY: cleanup
   --------------------------------------------------------------- */

CT.registerScenario({
  id: 'delete-order',
  name: 'Supprimer commande',
  icon: '🗑️',
  category: 'cleanup',
  description: 'Supprime définitivement une commande par son ID (UUID).',
  fields: [
    { key: 'orderId', label: 'ID de la commande (UUID)', type: 'text', default: '' }
  ],
  execute: async function(params) {
    if (!params.orderId) throw new Error('Veuillez entrer l\'ID de la commande');
    await CT.api.deleteOrder(params.orderId);
    return '✅ Commande ' + params.orderId + ' supprimée définitivement.';
  }
});

CT.registerScenario({
  id: 'refresh-all',
  name: 'Rafraîchir tout',
  icon: '🔄',
  category: 'cleanup',
  description: 'Recharge la vue courante pour rafraîchir les données.',
  fields: [],
  execute: async function() {
    if (CT.currentView) {
      CT.navigate(CT.currentView);
    }
    return '✅ Données rafraîchies.';
  }
});

/* ---------------------------------------------------------------
   SCENARIOS VIEW — renders all scenarios grouped by category
   --------------------------------------------------------------- */

CT.views.scenarios = {
  label: 'Scénarios',
  icon: '🎮',
  load: async function(el) {
    var categories = {
      setup: '⚙️ Configuration',
      orders: '📦 Commandes',
      problems: '⚠️ Problèmes',
      cleanup: '🧹 Nettoyage'
    };

    var html = '';
    for (var cat in categories) {
      var label = categories[cat];
      var items = CT.scenarios.filter(function(s) { return s.category === cat; });
      if (!items.length) continue;
      html += '<h3 class="ct-category-title">' + label + '</h3>';
      html += '<div class="ct-scenarios-grid">';
      for (var i = 0; i < items.length; i++) {
        html += CT.html.scenarioCard(items[i]);
      }
      html += '</div>';
    }

    el.innerHTML = html;

    // Bind execute buttons
    CT.scenarios.forEach(function(s) {
      var btn = el.querySelector('#btn-' + s.id);
      if (btn) {
        btn.addEventListener('click', function() {
          CT.executeScenario(s, el);
        });
      }
    });

    // Load products into create-order product select
    CT._loadProductSelect(el);
  }
};

/**
 * Populate the create-order product select with real product data.
 */
CT._loadProductSelect = async function(container) {
  var selectEl = container.querySelector('#field-create-order-product');
  if (!selectEl) return;
  try {
    var products = await CT.api.products();
    if (products && products.length > 0) {
      selectEl.innerHTML = '';
      products.forEach(function(p) {
        var opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name + ' — ' + CT.html.formatKMF(p.price_kmf);
        selectEl.appendChild(opt);
      });
    } else {
      selectEl.innerHTML = '<option value="">Aucun produit (injectez les données test)</option>';
    }
  } catch (e) {
    selectEl.innerHTML = '<option value="">Erreur chargement produits</option>';
  }
};
