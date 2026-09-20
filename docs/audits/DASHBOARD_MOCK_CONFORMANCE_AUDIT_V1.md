# Audit de conformité — Dashboards Komerce vs mocks validés V1

> Mission : intégration de la doctrine de pilotage ("un coup d'œil → attention → action") dans les modèles existants, sans refonte.
> Référence : `docs/visual-references/dashboards/` (11 PNG originaux), `docs/contract/DASHBOARD_MOCK_TRACE_V1.md`, `docs/doctrine/DASHBOARD_DECISION_VISUAL_DOCTRINE_V1.md`.
> Méthode : vérifié en conditions réelles (navigateur headless, session admin avec autorité globale explicitement accordée — `dashboard_global_access_grants` et `sourcing_global_access_grants`, absentes par défaut même pour un compte `role=admin`), jamais par lecture de code seule quand une vérification live était possible.
> **Avertissement d'exhaustivité** : Catalogue pays et Commandes (bloqué par un bug, cf. plus bas) n'ont pas été vérifiés en conditions réelles — ne pas présumer leur conformité.

---

## A. Audit de conformité par modèle

| # | Mock | Route réelle | Statut | Écarts confirmés |
|---|---|---|---|---|
| 01 | Pilotage | `/admin/pilotage` | 🟠 Partiel | Niveau 2 non conforme : les cartes du bandeau décision pointent vers `#pilotage-alerts`, une ancre locale générique, pas une liste filtrée de l'indicateur cliqué. Plusieurs cartes (Critiques/Points d'attention) partagent la même ancre. `action-center.js` ne lit aucun paramètre de sévérité dans l'URL — même en corrigeant le lien, la destination ne filtrerait rien. KPI (5) et structure générale conformes au mock. |
| 02 | Commerce | `/admin/commerce` | 🟡 Écart métrique | KPI réels : CA encaissé, Commandes créées, Panier moyen, Marge consolidée, Commandes perdues. Mock : CA, Panier moyen, **Taux de conversion**, Commandes perdues, **Produits actifs vendus**. Deux métriques du mock absentes, remplacées par deux autres non prévues. N2 réel (Vue d'ensemble/Commandes/Clients) ne correspond pas à la déclaration `navigation-policy-v3.js` (Commerce/Suivi des commandes) — signe qu'un autre mécanisme fait autorité sans que ce soit documenté clairement. |
| 03 | Atelier économique | `/admin/workspaces/pricing` | 🟢 Conforme (corrigé) | **Correction du constat initial** : l'entrée précédente de cette ligne se fiait au mock seul, sans jamais avoir chargé la page réelle — erreur de méthode corrigée en cours de route. Diagnostic réel : la page forçait toujours un marché spécifique (`requireMarket: true`, seul parmi les 8 surfaces Canonical à le faire), rendant le mode Global — et donc tout son contenu niveau SKU — totalement inatteignable (corrigé, PR #1660). Une fois le mode Global atteignable, découvert que le bandeau de décision (`globalDecisionItems`), les KPI (`globalMetricItems`) et la table priorisée des SKUs avec drill-down Product 360 (`globalProductItems`) existaient déjà, entièrement codés, dans `pricing-workspace-decision.js` — jamais construits pour cette passe, seulement débloqués. Vérifié avec de vraies données seedées (produit volontairement sous son plancher de prix) : le bandeau détecte correctement "Prix sous plancher serveur : 1", la table liste les 3 SKUs avec plancher/prix conseillé/actuel, chaque lien "Product 360 →" mène à une vraie page (200 confirmé). |
| 04 | Catalogue pays | *(N2 sous Marchés)* | ⚪ Non vérifié | Accessible via l'onglet "Catalogue pays" de la page Marchés/Autonomie — pas encore chargé et comparé au mock dans cette passe. |
| 05 | Commandes | `/admin/orders` | 🔴 Cassé | La page redirige silencieusement vers la boutique publique (aucune erreur visible, aucun log console). Cause non encore diagnostiquée. Impossible de vérifier la conformité tant que ce n'est pas corrigé. |
| 06 | Marchés (vue admin globale) | `/dashboards/canonical/access.html` | 🟢 Conforme | KPI, bandeau décision, équipe du marché, readiness — tous présents et alignés sur le mock. |
| 07 | Opérations — vue d'ensemble | `/admin/operations` | 🟡 Sur-densifié | **8 indicateurs affichés** (Commandes aujourd'hui, Paiements en attente, Colis préparation, Colis en transit, Disponibles relais, Retards critiques, Complétude scans, Taux collecte relais) contre 5 dans le mock et la limite de 4-6 en synthèse immédiate évoquée par la doctrine. Certains libellés du mock (Dossiers douane ouverts, Taux de service réseau) absents, remplacés par d'autres non prévus. |
| 08 | Hub / Relais | `/admin/workspaces/operations` | 🔴 Écart structurel | Aucun bandeau de situation, aucun indicateur de synthèse — uniquement des files d'exécution ("À traiter maintenant"). Le mock montre un vrai niveau 1 (KPI + bandeau décision + alertes + actions prioritaires). Possible qu'il s'agisse d'un choix voulu (page d'exécution, pas de pilotage) mais aucune justification documentée trouvée. |
| 09 | Expéditions & Douane | `/admin/workspaces/shipping-customs` | 🔴 Écart structurel | Même constat que Hub/Relais : file d'exécution pure, aucun niveau 1 (bandeau, KPI, alertes) visible. |
| 10 | Sourcing | `/admin/workspaces/sourcing` | 🔴 Non conforme | **Écart le plus grave de l'audit.** La page réelle est un tableau de bord d'intégrité technique du pipeline de données (statuts BROKEN/BROKEN/BROKEN, codes de test `golden:required_source_missing:*`, table d'autorité d'architecture Product→CANONICAL_PRODUCT, table de disposition KEEP/DEPRECATE/REMOVE_LATER) — aucune métrique métier d'achat (stock, fournisseurs, délais, coûts) nulle part. Le mock montre un pilotage achats complet (demandes urgentes, fournisseurs en retard, couverture stock, pipeline approvisionnement, performance fournisseurs). Contenu technique interne exposé à la place du contenu métier attendu — viole le principe 8 des critères d'acceptation ("les informations techniques ne sont pas imposées à l'utilisateur métier"). |
| 11 | Finance | `/admin/finance` | 🟢 Conforme | KPI (7, légèrement au-dessus de la fourchette 4-6 mais tous pertinents), bandeau, vérité du costing — structure fidèle au mock. Non vérifié : conformité niveau 2. |

**Synthèse** : 3 conformes, 1 écart métrique mineur, 1 sur-densification, 1 non vérifié, 1 cassé, 3 écarts structurels graves (dont Sourcing, le plus sérieux).

---

## B. Constats transverses (doctrine, hors correspondance mock-par-mock)

1. **Aucune duplication d'indicateur constatée entre dashboards** — chaque KPI observé (CA encaissé, Marge consolidée, etc.) garde une source et une formulation cohérentes là où il apparaît sur plusieurs écrans (Pilotage/Commerce/Finance). Pas de recalcul contradictoire détecté.
2. **Niveau 2 (détail exact) non vérifiable systématiquement** — seul Pilotage a été vérifié en détail pour ce critère précis ; confirmé non conforme (ancre générique partagée, pas de filtre par sévérité côté Action Center). Les autres dashboards conformes en niveau 1 n'ont pas encore été vérifiés au niveau 2.
3. **Autorité d'accès non évidente pour l'auditeur lui-même** — un compte `role=admin` fraîchement créé (via l'outil de secours `reset-admin.js`) n'a par défaut accès à *aucun* dashboard (`dashboard_global_access_grants`) ni à Sourcing (`sourcing_global_access_grants`) sans une ligne de grant explicite. C'est une bonne pratique de sécurité (autorité jamais implicite au rôle), mais ça signifie qu'un audit ou un onboarding admin mené sans connaître ce mécanisme conclurait à tort que "tout est cassé".

---

## C. Composants communs — adaptations nécessaires (à affiner en Étape 2 de la méthode)

- **Action Center** (`public/dashboards/canonical/js/action-center.js`) : ajouter la lecture d'un paramètre `severity` (et potentiellement `signal_ref`/`view`) dans l'URL pour pré-filtrer la liste à l'ouverture — prérequis technique avant de pouvoir corriger un seul lien de drill-down correctement.
- **Cartes de décision** (`pilotage-decision.js` et équivalents) : chaque `href` doit pointer vers une destination réellement filtrée (`#pilotage-alerts?severity=critical` ou équivalent), jamais une ancre générique partagée entre plusieurs cartes.
- **Gabarit "niveau 1" pour Hub/Relais et Expéditions & Douane** : à décider avec le porteur produit — soit documenter explicitement que ce sont des pages d'exécution pure (hors doctrine niveau 1), soit leur ajouter le bandeau + KPI du mock en réutilisant les primitives déjà existantes (`MetricStrip`, `AlertPanel`).
- **Écran Sourcing** : nécessite une vraie discussion produit avant toute implémentation — soit construire l'écran métier du mock (qui n'existe pas aujourd'hui, à côté du contenu technique existant, qui a probablement sa propre valeur pour l'équipe ingénierie mais ne devrait pas être la seule chose visible sous "Sourcing"), soit déplacer le contenu technique ailleurs (un espace dédié qualité/gouvernance) et construire l'écran métier à sa place.

---

## Prochaines étapes proposées (méthode de la mission, Étape 3)

Commencer par **Pilotage** comme référence fonctionnelle (la mission le demande explicitement), en corrigeant le niveau 2 : lecture du paramètre de sévérité dans Action Center, puis liens de drill-down distincts par carte. Chaîne complète à valider : indicateur → détail exact → action métier → retour.

Sourcing reste le chantier le plus lourd (écran métier à construire quasiment de zéro) et mérite une décision produit avant tout travail d'implémentation.
