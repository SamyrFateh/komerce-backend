# Audit de trajectoire — Back Office Canonical vs Legacy

Date : 2026-09-28  
Périmètre : navigation, couverture fonctionnelle, cutover, compréhension globale du Back Office.

## 1. Verdict

La trajectoire Canonical est **bonne sur l'architecture** mais **trop agressive sur la compression de l'expérience**.

Le problème n'est pas d'avoir créé 4 dashboards + workspaces + Entity 360. Cette séparation reste saine :

- Dashboard = comprendre ;
- Workspace = agir ;
- Entity 360 = expliquer ;
- Action Center = traiter les signaux.

Le problème est qu'en passant de ~30 surfaces Legacy à 7 entrées N1, on a aussi réduit la **représentation mentale du système**. Le runtime est plus propre, mais l'utilisateur voit moins bien tout ce que Komerce sait faire.

Conclusion : **ne pas revenir à 30 applications**, mais restaurer une navigation riche qui expose les capacités réelles sans casser l'architecture Canonical.

## 2. Constat historique

Le Legacy 1 exposait 30 routes SPA réelles. Les principales familles étaient :

- Pilotage / Santé / Control Tower ;
- Sales / Clients / Shared carts ;
- Orders / Logistics / Hub / Inventory / Transitaire / Customs ;
- Products / Categories / Catalog approval ;
- Sourcing / Scanner / Suppliers ;
- Pricing / Pricing workshop / Strategy / Economic flow / Simulator ;
- Economic / Costing / Pilotage financier / Invoices / Accounting ;
- Problems / Alerts ;
- Settings.

La doctrine Canonical a volontairement réduit cet ensemble à :

- 4 dashboards : Pilotage, Commerce, Opérations, Finance ;
- 6 workspaces : Hub-Relais, Expéditions-Douane, Catalogue, Sourcing, Pricing, Finance-Comptabilité ;
- 3 Entity 360 ;
- 1 Action Center.

Cette réduction était conçue comme une **consolidation de surfaces**, pas comme une suppression de capacités.

## 3. État actuel réel

### 3.1 Navigation visible

Le N1 actuel ne montre que :

1. Dashboard
2. Atelier économique
3. Catalogue
4. Commandes
5. Marchés
6. Opérations
7. Finance

Paramètres est relégué en utilitaire.

Cette structure respecte la doctrine V3, mais elle sous-expose fortement les capacités concrètes.

### 3.2 Capacités encore présentes mais enfouies

Plusieurs capacités existent encore dans Canonical mais ne sont visibles qu'en N2, en drill, ou via URL directe :

- Commerce
- Suivi des commandes
- Clients / Client 360
- Order 360
- Product 360
- Hub / Relais
- Expéditions & Douane
- Sourcing
- Comptabilité
- Action Center

Cela produit une impression trompeuse : le Back Office semble posséder 7 fonctions alors que le système en possède beaucoup plus.

### 3.3 Capacités Legacy toujours réellement nécessaires

Le routeur HTML actuel laisse encore explicitement Legacy 1 actif pour :

- `/admin/customs`
- `/admin/suppliers`
- `/admin/sales`
- `/admin/transitaire`
- `/admin/sante`
- `/admin/shared-carts`
- `/admin/simulator`

Ces routes sont la preuve que le cutover n'est pas encore complètement terminé.

## 4. Matrice de couverture

| Besoin historique | État | Lecture d'audit |
|---|---|---|
| Pilotage | Canonical | Bien absorbé |
| Santé transverse | Legacy encore accessible | Besoin de vérifier que Pilotage restitue vraiment la compréhension transverse |
| Control Tower | Redirigé Pilotage | Structurellement cohérent |
| Sales | Legacy | Gap de couverture encore réel |
| Clients | Canonical + Client 360 | Couvert mais trop caché dans Commandes |
| Commandes | Canonical | Couvert |
| Retards | Opérations / Action Center | Couvert mais moins directement découvrable |
| Alerts / Problems | Action Center | Bonne consolidation |
| Hub / Relais | Workspace Canonical | Bien absorbé |
| Inventory | Workspace Canonical | Bien absorbé |
| Transitaire | Legacy | Gap réel |
| Douane | Legacy + workspace additif | Cutover incomplet |
| Products / Categories / Approval | Catalogue Workspace | Bien absorbé |
| Sourcing / Scanner | Sourcing Workspace | Bien absorbé |
| Suppliers | Legacy | Gap réel : partenaires multi-familles non absorbés |
| Pricing / Strategy / Economic flow | Pricing Workspace | Bien consolidé |
| Simulator | Legacy | Gap UX/fonctionnel selon usage staging |
| Costing | Redirigé Finance | Doit être revalidé comme couverture complète |
| Economic | Redirigé Pricing | Doit être revalidé comme couverture complète |
| Pilotage financier | Redirigé Finance | Doit être revalidé comme couverture complète |
| Invoices / Accounting | Accounting Workspace | Bien absorbé |
| Shared carts | Legacy | Doctrine dit Client 360 / Commerce, mais surface Legacy encore active |
| Settings | Canonical | Couvert |
| Reset / Seed | Backend présent, hors nav | À exposer staging uniquement |

## 5. Point de vigilance majeur : le cutover a dépassé la documentation

Le contrat `DASHBOARD_CUTOVER_2.md` indique encore que :

- Costing détaillé ;
- Economic ;
- Pilotage financier

devaient rester Legacy tant que leur couverture n'était pas prouvée.

Mais le routeur actuel redirige déjà :

- `/admin/costing` → `/admin/finance`
- `/admin/economic` → `/admin/workspaces/pricing`
- `/admin/pilotage-fin` → `/admin/finance`

Le code mentionne des lots `4S / 4T`, mais aucune preuve documentaire correspondante n'a été retrouvée dans l'audit.

Ce n'est pas nécessairement une erreur de produit, mais c'est une **dette de preuve** : soit ces absorptions ont été réellement validées et la documentation doit être remise à niveau, soit le cutover a couru devant la démonstration de couverture.

## 6. Problème de compréhension globale

La doctrine V3 répond très bien à :

> « Dans quel domaine suis-je ? »

Mais moins bien à :

> « Qu'est-ce que le Back Office Komerce sait faire ? »

C'est le cœur du problème actuel.

Un opérateur ne doit pas avoir besoin de connaître :
- les N2 cachés ;
- les drills ;
- les URLs historiques ;
- la doctrine de parentage ;

pour savoir qu'il existe un module Douane, Litiges, Clients, Sourcing, Comptabilité ou Hub.

L'architecture informationnelle actuelle est donc **correcte pour le parentage**, mais **trop pauvre pour la découvrabilité**.

## 7. Recommandation cible

Conserver le modèle Canonical, mais faire évoluer la sidebar vers une représentation métier plus riche.

### Pilotage
- Dashboard
- Activité
- Ventes
- Retards
- Prévisions
- Action Center

### Commerce
- Commandes
- Clients
- Litiges
- Remboursements
- Wallet

### Catalogue
- Produits
- Catégories
- Sourcing
- Fournisseurs

### Opérations
- Hub / Relais
- Inventaire
- Expéditions
- Douane
- Logistique

### Finance
- Vue Finance
- Comptabilité
- Atelier économique
- Coûts

### Marchés
- Accès pays
- Autonomie marché
- Catalogue pays
- Équipe / réseau selon capacités réelles

### Configuration
- Paramètres
- Reset / Seed uniquement en staging

Important : ces entrées ne doivent **pas** recréer 30 runtimes. Elles peuvent cibler :
- une surface Canonical existante ;
- un N2 ;
- une vue locale ;
- un Entity 360 ;
- ou temporairement une surface Legacy encore non absorbée.

La sidebar redevient donc une **carte des capacités**, pas une projection directe du nombre de runtimes.

## 8. Règle de décision pour la suite

Pour chaque ancienne capacité :

1. Le besoin existe-t-il encore ?
2. La vérité métier est-elle déjà Canonical ?
3. La surface actuelle permet-elle de la comprendre ou de l'exécuter complètement ?
4. Est-elle visible dans la navigation ?
5. Si elle est absorbée, la couverture est-elle prouvée ?
6. Si elle ne l'est pas, Legacy reste explicitement visible jusqu'au remplacement.

Aucune capacité ne doit disparaître simplement parce qu'elle a été fusionnée techniquement.

## 9. Staging : Reset / Seed

Le backend expose toujours `POST /api/admin/reset`.

Le routeur backend protège déjà ce comportement :
- réservé admin ;
- bloqué en production par le garde environnement ;
- prévu pour dev/staging.

Il est donc cohérent de réintroduire une entrée **Reset / Seed** dans la zone Configuration sur staging, à condition que sa visibilité UI soit elle aussi explicitement conditionnée par l'environnement et qu'elle ne puisse pas apparaître en production.

## 10. Décision recommandée

Ne pas annuler Canonical.

Ne pas restaurer le Legacy comme architecture.

**Corriger le point où la consolidation technique est devenue une compression de compréhension.**

La bonne cible est :

> Canonical pour l'architecture, Legacy pour la lisibilité opérationnelle et la richesse de navigation.

Avant toute nouvelle suppression Legacy, produire une matrice de couverture exécutable pour les 30 besoins historiques, avec quatre statuts seulement :

- COVERED
- COVERED_BUT_HIDDEN
- PARTIAL
- LEGACY_REQUIRED

La purge Legacy ne devient autorisée que lorsque aucun besoin n'est PARTIAL ou LEGACY_REQUIRED.
