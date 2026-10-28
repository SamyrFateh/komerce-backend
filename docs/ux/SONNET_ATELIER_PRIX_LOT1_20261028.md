# KOMERCE — contrat d'implémentation Sonnet : Atelier des prix UX (lot 1)

> **Statut : arbitrages UX décidés le 28/10/2026, prête pour implémentation sur branche dédiée.**
> Référence GitHub : issue conception #3115 ; issue d'exécution Sonnet (lien à ajouter).
> Branche : `feat/pricing-ux-sonnet-lot1-20261028`, issue de PR #3113. Ne pas toucher à `main`, Railway, secrets ou données réelles.
> Maquette Opus : `https://claude.ai/artifact/MKcJFXumo6ARYUNA4v7Qfw#atelier` (privée tant qu'elle n'est pas partagée ; ne pas la prétendre consultée si inaccessible). Ce contrat est autosuffisant.

## 1. Arbitrages fermes

| F | Décision | Exigence d'implémentation |
|---|---|---|
| F1 | Trois entrées principales `Vue économique`, `Produits à décider`, `Modèle de coûts`. | Onglets N2 dans l'autorité Pricing, pas trois nouveaux endpoints génériques. |
| F2 | Arrivée automatique du produit Catalogue éligible dans la liste économique. | Vérifier la projection `buildWorkspace` et l'état `catalog_approved` (qui n'est pas en soi une preuve historique d'approbation). Ne pas créer de faux statut `demande d'examen`. Si la projection ne suffit pas, tracer un `BACKEND_GAP` et une sous-tâche dédiée ; ne pas inférer un état à partir du CSS ou du navigateur. |
| F3 | Stratégie / observations concurrentielles intégrées au dossier produit. | Lire et éditer via services/permissions existants, observations datées/sourcées, pas de double saisie ni de regroupement arbitraire global/local. |
| F4 | Le geste final d'activation d'un prix **local** appartient visuellement au Catalogue pays. | Dossier Atelier peut ouvrir la décision locale en conservant `product_ref` + Market ID. La route Pricing canonique est propriétaire de l'activation. Un seul geste final `LOCAL_ACTIVE` qui enclenche l'exposition ; pas de double bouton de publication. |
| F5 | Prix sous seuil sûr **refusé par défaut**. | Respecter le gate serveur existant, qui autorise explicitement certains cas `contributive_low_buffer` sur un marché suffisamment couvert. Ne jamais transformer en autorisation frontend. Pour les prix **globaux**, `pricing-apply` accepte actuellement `survival_price_kmf` du client : c'est un garde incomplet ; sans contrôle autoritatif serveur recalculé, ne pas annoncer un blocage strict certifié. Séparer UI et correction backend prouvée. |
| F6 | Simulation intégrée au dossier de décision. | Non persistante tant que pas de confirmation. Les conséquences sont calculées par le moteur serveur, non par JS. |
| F7 | Information non fournie dans le résumé Opus. | Ne pas inventer ; demander la référence si elle affecte le code. Ce point n'empêche pas F1/F3/F6. |
| F8 | Capacité de l'auto-colis : plafond temporaire de 30 **unités** (`SUM quantity`). | Hors lot Pricing. Documenter séparation entre unités et poids/volume, ne pas fractionner implicitement ; issue #3099 pour correction backend. |
| F9 | Remboursements : ne pas proposer une seconde sortie économique si un remboursement est engagé/réalisé. | Hors lot Pricing. Une protection UI ne remplace pas verrou/intention durable, idempotence PSP et registre ; issue #3106 P0 candidat, aucune action de remboursement sans garde serveur. |

## 2. Référence visuelle : Sourcing / Raffinerie / Catalogue

- Conserver le shell Canonical (sidebar N1, onglets N2, actions locales N3), le bleu existant, la pleine largeur, la hiérarchie typographique, les boutons lisibles et le responsive 1440/390.
- Une liste de travail **centrale** avec une action prioritaire contextualisée par ligne, autres opérations en menu discret ; jamais six boutons identiques par produit.
- Écrans de décision : informations sources à gauche, proposition et conséquences à droite, confirmation humaine explicite, historique et retour à l'objet, sans modale `prompt()` successive.
- Écran de KPI sans action d'écriture : 2 à 4 KPI qui décident réellement de ce qui doit être examiné ; source/fraîcheur visibles ; pas de KPI ornemental.
- Utiliser `—` ou `Indisponible` pour donnée manquante ; ne pas afficher `0`, `100 %`, `profit` ou `marché ouvert` par défaut.

## 3. Wireframes fonctionnels — figures conceptuelles, valeurs non réelles

### E1 — Vue économique : pilotage (lecture seule)

```text
┌ ATELIER DES PRIX ─── Marché global / marché autorisé ─── fraîcheur ───┐
│ [ Vue économique ] [ Produits à décider ] [ Modèle de coûts ]          │
├───────────────────────────────────────────────────────────────────────┤
│ [Contribution reconnue] [Couverture réelle ou NON DÉCISIONNELLE]       │
│ [Coûts incomplets]   [Références nécessitant arbitrage]                │
├───────────────────────────────────────────────────────────────────────┤
│ PRIORITÉS ÉCONOMIQUES                                                 │
│ ! Coûts manquants : ouvrir la ligne du modèle propriétaire            │
│ ! Prix sous plancher : [Examiner les produits concernés]               │
│ ! Couverture non décisionnelle : [Voir raison du gate]                │
└───────────────────────────────────────────────────────────────────────┘
```

Pas de formulaire de saisie sur cette vue, pas de recomputation client des KPI.

### E2 — Produits à décider : poste de travail

```text
┌ PRODUITS À DÉCIDER ─ recherche / état / filtre marché autorisé ────────┐
│ Produit / référence | Prix courant | Coût connu? | Seuil serveur       │
│ Cause / état        | Proposition   | Action principale             │
├───────────────────────────────────────────────────────────────────────┤
│ KPR-… Produit A     | —            | MANQUANT     | indisponible     │
│ → Coût source absent / décision bloquée   [Compléter les coûts] [···] │
├───────────────────────────────────────────────────────────────────────┤
│ KPR-… Produit B     | serveur      | présent      | moteur connu     │
│ → Arbitrage économique requis          [Examiner & simuler] [···]     │
└───────────────────────────────────────────────────────────────────────┘
```

Produit approuvé sans prix : entrée automatique UNIQUEMENT si le serveur peut prouver les deux états. Si non, afficher clairement `Projection manquante` et créer un ticket backend séparé.

### E3 — Dossier de décision produit (drill-down depuis E2)

```text
┌ KPR-… · Produit · marché explicitement choisi · [Retour à la file] ───┐
│ SOURCES / VÉRITÉS (read-only)        │ DÉCISION                        │
│ - achat, transport, coûts connus    │ - plancher / conseillé moteur   │
│ - manquants + effet sur la fiabilité│ - prix projeté / impact serveur │
│ - observations concurrence sourcées │ - champs de scénario            │
│ - historique de prix               │ [Recalculer / simuler]           │
│                                     │ [Enregistrer brouillon si prévu]│
│                                     │ [Confirmer la décision globale]│
├───────────────────────────────────────────────────────────────────────┤
│ Résultat : appliqué / bloqué + motif serveur, trace, dernière modif.  │
│ Suite : [Retour Catalogue global] [Décision pays autorisée]            │
└───────────────────────────────────────────────────────────────────────┘
```

Une simulation ne déclenche jamais l'application d'un prix. Si manque d'autorité, afficher la raison et la sortie métier pertinente. Pas de prix local sans Market ID effectif.

### E4 — Modèle de coûts : poste de gestion réservé

```text
┌ MODÈLE DE COÛTS ─ central / marché explicite ──────────────────────────┐
│ [Variable] [Fixe direct] [Fixe mutualisé] [Exceptionnel] [À qualifier]│
│ Composant | Nature | Périmètre | Valeur moteur | Source/héritage | État│
│ Coût A    | variable | direct  | connue        | global         | actif
│ → [Corriger] (si capacité serveur) [Désactiver] [Revenir au global]     │
└───────────────────────────────────────────────────────────────────────┘
```

Ne pas inventer de nature économique depuis `family` ; conserver nature et périmètre séparés. Opérations d'édition par les guards actuels `pricing.cost_component.update`, `pricing.cost_component.reset`, etc.

## 4. Parcours utilisateurs obligatoires

1. `Catalogue global (produit finalisé)` → `Atelier > Produits à décider` (même `product_ref`) → `Dossier` → `Simuler` → `Examiner` → `Confirmer prix global` (si autorisé) → retour contexte Catalogue.
2. `Dossier produit` → `Prix pays pour KM` **uniquement si membership active** → simulation/price draft local (`pricing.decide`) → activation-preview (`pricing.read`) → `Catalogue pays` action finale (`pricing.activate` + `catalog.expose`) → exposition commerciale projetée par serveur.
3. `Coût manquant` → `Modèle de coûts` (même clé/marché) → correction autorisée → recalcul serveur → retour au dossier, sans feindre un prix déterminable avant correction.
4. `Marché non habilité` → message explicite, pas de CTA d'action cliquable. Jamais de fallback CG implicite.
5. `Prix sous seuil` → blocage clair, **sauf** autorisation spécifique explicite du gate serveur selon le modèle existant ; pas de changement silencieux des politiques.
6. `Simulation` → aucune écriture de prix, aucun changement d'exposition ; `Confirmer` distinct, feedback après vérité serveur.

## 5. Sources et responsabilités vérifiées

| UI / action | Autorité existante | Contraintes |
|---|---|---|
| Vue économique globale | `services/pricing-workspace.js#buildWorkspace`, `economic-engine` | KPI seulement si présents et comparables. |
| File produits | `buildWorkspace` + `services/catalog-registry.js` | Ne pas confondre `catalog_approved` calculé avec approbation historique : prouver le filtre. |
| Simulation globale | `POST /api/admin/workspaces/pricing/simulate` | Read of engine ; pas de mutation commerciale. |
| Application prix global | `POST /api/admin/workspaces/pricing/products/:productRef/apply-price` | `services/pricing-apply.js` : garde client `survival_price_kmf` insuffisant ; ne pas prétendre certification strict floor. |
| Observations globales | `POST /api/admin/workspaces/pricing/competitors` | Source, date, périmètre, autorité existante. |
| Modèle coûts | Pricing workspace / cost-components, overrides marché | Conservation propriétaire des règles et héritages. |
| Prix local brouillon | `POST /api/admin/workspaces/pricing/market/:marketCode/products/:productRef/local-price` | `pricing.decide`, Market ID explicite. |
| Activation locale + exposition | `POST /api/admin/workspaces/pricing/market/:marketCode/products/:productRef/local-price/activate` | `pricing.activate` + `catalog.expose`, opération marché ; **un geste final unique**. |
| Gate local prix faible | `services/market-local-price-activation-service.js` | `contributive_low_buffer` permis seulement si `ALLOW_NEW_UNDER_CDR_POSITION` ; prix destructif toujours refusé. |

## 6. Ordre et périmètre pour Sonnet

### Lot A — à coder immédiatement sur cette branche (UX sans réécriture métier)

- Réorganiser le workspace Pricing dans les trois entrées F1 (conserver les routes et les gardes).
- Mettre en avant le travail prioritaire, une action par ligne, maintenir `product_ref`, `market`, `return_to`, filtres.
- Placer la simulation et les observations dans le dossier produit et réduire les duplications de KPI, panneaux et formulaires.
- Afficher les messages de droit/gate/erreur/absence de coût directement avec prochaine action, responsive 1440/390.
- Pour le prix pays : rendre la destination Catalogue pays explicite et montrer le geste final dans son owner UI sans déplacer/dupliquer le handler de Pricing ; respecter `LOCAL_ACTIVE` + exposure synchronisées par route existante.

### Lot B — sous-tâches backend justifiées (NE PAS camoufler dans l'UX)

- F2 : seulement si aucune projection serveur ne fournit les états requis. Proposer requête/owner, contrat et tests avant backend.
- F5 global : ne pas considérer le contrôle `survival_price_kmf` envoyé du client comme garde autoritatif. Si modification indispensable, écrire d'abord les tests nominaux, négatifs et de compatibilité de prix ; faire valider la portée de la règle en note de PR séparée.
- F8 #3099 et F9 #3106 : **hors lot Atelier** ; aucun fix implicite.

## 7. Fichiers probables (inspecter avant modification)

- `public/dashboards/canonical/js/pricing-workspace.js`
- `public/dashboards/canonical/js/pricing-workspace-decision.js`
- `public/dashboards/canonical/js/pricing-product-focus.js`
- `public/dashboards/canonical/js/pricing-economic-cockpit.js`
- `public/dashboards/canonical/js/pricing-workspace-presentation.js`
- CSS Pricing dédiés et `public/dashboards/canonical/index.html` (versionnage de cache)
- `routes/admin-pricing-workspace.js` (seulement si contrat serveur réellement nécessaire)
- `services/pricing-apply.js`, `services/pricing-workspace.js` (à lire ; changements uniquement avec preuve métier et tests).

## 8. Vérifications avant de demander la recette utilisateur

- Tests unitaires ciblés, tests DOM des décisions/permissions, Chromium isolé 1440 px + 390 px, sans données réelles.
- Vérifier vrais champs sources, URL d'entrée/retour, hiérarchie visuelle, états `loading/empty/blocked/error`, overflow mobile, CTA cachés quand non autorisés.
- Tester que `Simuler` n'a pas d'effet commercial, que l'activation nécessite tous les guards, et qu'aucun prix sous plancher n'est autorisé uniquement par le frontend.
- Livrer capture 1440/390, matrice des parcours implémentés et différences avec Opus. Aucun déploiement Railway, fusion `main`, modification de données ou lancement de la recette utilisateur sans demande explicite.

**Critère d'acceptation pour la recette ultérieure :** un utilisateur voit en moins de quelques secondes l'information prioritaire, une action possible, la preuve qui la justifie, la conséquence après confirmation et sa prochaine destination. Une page HTTP 200 ou un test DOM vert ne vaut pas validation métier.