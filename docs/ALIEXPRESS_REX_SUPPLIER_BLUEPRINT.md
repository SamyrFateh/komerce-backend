# AliExpress REX — Supplier Integration Blueprint

**Statut : référence staging — septembre 2026**  
**But : capitaliser le chantier AliExpress pour industrialiser l’onboarding de futurs fournisseurs produits sans copier les détails spécifiques AliExpress.**

---

## 1. Pourquoi ce document existe

AliExpress a servi de stress test réel du pipeline fournisseur Komerce : source externe authentifiée, catalogue volumique, données hétérogènes, variantes/SKU, images, prix, stock, attributs imparfaits, limites d’API, reprise après interruption, normalisation, Raffinerie, promotion canonique et préparation du futur fulfillment.

Le REX à retenir n’est pas « comment intégrer AliExpress », mais :

> **comment Komerce doit intégrer n’importe quel fournisseur produit sans laisser la source dicter le modèle interne, le pricing Market, le lifecycle catalogue ou le processus d’achat.**

Ce document complète `docs/ALIEXPRESS_BUSINESS_READINESS.md`, `docs/SUPPLIERS_CONNECTORS.md` et les doctrines catalogue/ingestion existantes.

---

## 2. Principe canonique fournisseur

Le chemin cible est :

`Supplier source → connector/adapter → Normalized Supplier Product V2 → catalog-import-orchestrator → eligibility → Raffinerie → sourcing_candidate → décision → promoteCandidate → inactive draft → décision Market → exposition → commande client → Purchase Order fournisseur → fulfillment`

Règles :

1. **Le fournisseur n’écrit jamais directement dans `products`.**
2. **Le fournisseur ne décide jamais du prix Market.**
3. **Le fournisseur ne décide jamais de l’exposition Boutique.**
4. **La vérité source est conservée pour audit, mais elle n’est pas la vérité métier Komerce.**
5. **Le contrat V2 est la frontière entre monde fournisseur et monde Komerce.**
6. **La Raffinerie doit être fournisseur-agnostique.**
7. **Les scripts d’acquisition/discovery peuvent être fournisseur-spécifiques.**
8. **La promotion catalogue produit uniquement des drafts inactifs.**
9. **L’achat fournisseur est un domaine séparé du sourcing/catalogue.**
10. **Aucun achat réel ne doit être déclenché par un worker catalogue.**

---

## 3. Ce qu’AliExpress a réellement prouvé

### 3.1 Connexion source réelle

Le chantier a validé une source fournisseur réelle via AliExpress Open Platform, avec authentification, signature, session/OAuth, appels live, recherche produit et détail produit.

Leçon généralisable :

- le connecteur est responsable de l’authentification, de la syntaxe API et du mapping source ;
- le reste de Komerce ne doit pas connaître les détails du fournisseur.

### 3.2 Normalized Supplier Product V2 comme frontière stable

Les données fournisseur doivent être projetées vers un contrat commun qui conserve notamment :

- identifiant produit fournisseur ;
- identifiants SKU fournisseur ;
- nom/description source ;
- prix et devise source ;
- URL source ;
- médias ;
- variantes/options ;
- stock produit/SKU ;
- poids/dimensions ;
- propriétés/specifications ;
- données logistiques disponibles ;
- payload brut/provenance pour audit.

Le contrat V2 doit représenter ce que le fournisseur sait, pas les contraintes accidentelles d’une table Komerce.

### 3.3 La Raffinerie doit distinguer vérité marché et test économique

Un nouveau produit fournisseur peut avoir :

- un coût fournisseur connu ;
- un coût logistique estimé ;
- une capacité économique théorique ;
- mais **aucune vérité de prix Market encore décidée**.

Donc :

- `market_health = unknown` peut être légitime ;
- un test économique sain peut autoriser `TEST` ;
- il ne doit pas inventer une demande client ou un prix marché ;
- `PRIORITY` ne doit pas être produit simplement parce qu’un test économique est favorable.

Leçon : **économie interne et vérité marché sont deux axes distincts.**

### 3.4 Les données fournisseur imparfaites doivent être projetées, pas détruites

AliExpress a révélé deux cas importants :

- clés d’attribut dupliquées ;
- clés d’attribut nulles alors que label/value sont valides.

La solution canonique a été de projeter vers une clé DB déterministe et unique, sans :

- supprimer la donnée source ;
- fusionner silencieusement deux attributs ;
- durcir le contrat V2 juste pour satisfaire une contrainte de persistance.

Leçon : **les contraintes du modèle cible se résolvent dans la projection, pas en falsifiant la source.**

### 3.5 L’IA éditoriale n’est pas un prérequis de la Raffinerie

La promotion AliExpress fonctionne en `source_only` :

- le produit est promu en draft ;
- la donnée source est conservée ;
- aucune dépendance Anthropic/OpenAI n’est requise pour le chemin sourcing → Raffinerie → draft ;
- la préparation éditoriale/humaine/IA reste une étape séparée avant publication.

Leçon : **la robustesse catalogue ne doit jamais dépendre d’un fournisseur LLM.**

### 3.6 Checkpoints + idempotence sont obligatoires

Le sourcing volumique réel subit :

- limites de fréquence ;
- appels lents ;
- interruptions de déploiement ;
- relances ;
- pages/keywords épuisés ;
- relecture des mêmes IDs.

Wave 2 a été interrompue puis a repris grâce au checkpoint sans repartir de zéro.

Leçon : tout connecteur volumique doit avoir :

- checkpoint de progression ;
- déduplication par identifiant fournisseur ;
- verrou contre exécution concurrente ;
- reprise sûre ;
- métriques `starting`, `added`, `final`, `paused_reason`.

### 3.7 Discovery fournisseur ≠ Raffinerie

Wave 2 a montré qu’un plan de recherche peut s’épuiser avant la cible alors que la Raffinerie fonctionne parfaitement.

Résultat observé Wave 2 initiale :

- 405 produits passés dans la Raffinerie ;
- 405 contrats V2 ;
- 391 `TEST` ;
- 8 `WATCH` ;
- 6 `EXCLUDED` ;
- aucune promotion automatique ;
- arrêt par `search-plan-exhausted`, pas par erreur de Raffinerie.

Leçon : **un faible rendement discovery est un problème connecteur/source, pas une raison de modifier les règles Raffinerie.**

---

## 4. REX opérationnel — erreurs rencontrées et règle à conserver

### 4.1 Mauvaise catégorisation par défaut

Symptôme : des produits hétérogènes tombaient artificiellement dans une catégorie générique/phones.

Correction : donner priorité à la provenance sémantique de discovery puis au mapping canonique, et produire `WATCH` si la catégorie Komerce n’est pas résolue.

Règle : **inconnu vaut WATCH, jamais catégorie inventée.**

### 4.2 Fret mal alloué

Symptôme : coût fret démesuré car un coût par m³ était traité comme un coût forfaitaire.

Correction : appliquer explicitement la base d’allocation physique avant conversion/agrégation.

Règle : **la nature du coût et sa base d’allocation doivent être explicites.**

### 4.3 WATCH deadlock sur prix Market inconnu

Symptôme : tous les nouveaux produits restaient WATCH parce qu’ils n’avaient pas encore de prix de marché réel.

Correction : séparer santé Market inconnue et test économique fournisseur.

Règle : **ne pas exiger une vérité Market avant le moment où le Market doit réellement décider.**

### 4.4 Drift entre contrat V2 et mapper DB

Symptôme : le contrat canonique était correct mais la projection de promotion attendait d’anciens noms de champs.

Correction : aligner le mapper sur le V2 canonique et conserver seulement des fallbacks compatibles.

Règle : **le schéma canonique dirige la projection, pas l’inverse.**

### 4.5 Duplicate/null specification keys

Symptôme : échec de promotion sur attributs dupliqués ou clé absente.

Correction : projection déterministe des clés DB, suffixage stable, fallback basé sur label.

Règle : **aucune perte silencieuse de propriétés fournisseur.**

### 4.6 Dépendance LLM involontaire

Symptôme : promotion réussie mais warnings `ANTHROPIC_API_KEY` et statut enrichment failed.

Correction : mode explicite `source_only` pour la promotion technique.

Règle : **l’éditorial n’est pas une dépendance transactionnelle du catalogue.**

### 4.7 Batch partiellement committé

Symptôme : un batch de promotion a échoué après plusieurs candidats déjà committés.

Conclusion : la transaction est par candidat, pas par batch.

Règle :

- le batch doit être resumable ;
- un audit indépendant doit toujours suivre un échec ;
- ne jamais supposer rollback global ;
- ne jamais supprimer les lignes déjà promues proprement.

---

## 5. Modèle de maturité fournisseur à réutiliser

### N0 — Source Connected

Prouver :

- authentification ;
- appel source réel ;
- lecture de plusieurs références ;
- absence de mock/scraping caché ;
- gestion des erreurs et limites.

### N1 — Contract Ready

Prouver :

- mapping vers V2 ;
- variantes/SKU préservés ;
- prix + devise source préservés ;
- stock préservé ;
- média principal exploitable ;
- payload/provenance auditables.

### N2 — Refinery Ready

Prouver :

- ingestion via orchestrateur canonique ;
- catégorie Komerce déterministe ou WATCH ;
- coût économique calculable ;
- décisions TEST/WATCH/EXCLUDED cohérentes ;
- aucune écriture directe catalogue.

### N3 — Catalog Draft Ready

Prouver :

- `promoteCandidate()` ;
- produit inactif ;
- variantes/SKU/médias persistés ;
- aucune activation/exposition silencieuse ;
- replay/idempotence maîtrisés.

### N4 — Market Ready

Prouver :

- décision prix Market explicite ;
- stock/localisation/exposition conformes ;
- carte Boutique correcte ;
- publication/approval respectés.

### N5 — Supplier-Mapped

Prouver :

- produit Komerce → produit fournisseur ;
- SKU Komerce → SKU fournisseur ;
- coût et devise source traçables ;
- URL/source disponibles ;
- aucune ligne vendue sans fournisseur résolvable.

### N6 — Fulfillment Ready

Prouver :

- une commande Komerce crée une Purchase Order fournisseur exploitable ;
- quantité/SKU/adresse/coût/devise sont complets ;
- aucun opérateur n’a besoin de rechercher manuellement quel article acheter ;
- fallback manuel possible sans ambiguïté.

### N7 — Supplier API Purchase Ready

Prouver, sans nécessairement effectuer le paiement réel :

- les permissions réelles de l’API d’achat fournisseur sont connues ;
- le payload d’achat est construit à partir de la PO canonique ;
- freight/availability/price sont rafraîchis juste avant l’achat ;
- le fournisseur accepte le payload ou retourne une précommande/commande non payée exploitable lorsque l’API le permet ;
- un identifiant fournisseur peut être corrélé à la PO ;
- aucune double commande n’est possible sur retry ;
- l’étape suivante explicite est le paiement/engagement financier.

### N8 — Auto-Order Ready

Prouver :

- engagement financier réellement contrôlé ;
- idempotence bout en bout ;
- suivi order detail ;
- tracking ;
- gestion timeout/ambiguïté ;
- kill switch ;
- fallback manuel.

---

## 6. Prochain objectif AliExpress : E2E jusqu’à la frontière paiement

Le prochain chantier ne doit pas s’arrêter à « le produit est dans la Boutique ».

Objectif : prendre **un produit AliExpress réel contrôlé** et traverser tout le système jusqu’au point où l’achat fournisseur est prêt, mais **sans déclencher de paiement réel**.

Scénario cible :

1. produit AliExpress source réel ;
2. V2 + Raffinerie ;
3. draft canonique ;
4. prix Market staging décidé ;
5. exposition contrôlée ;
6. ajout panier ;
7. checkout staging ;
8. commande Komerce ;
9. résolution fournisseur produit/SKU ;
10. création Purchase Order ;
11. refresh fournisseur immédiat prix/stock/fret si disponible ;
12. construction du payload API d’achat fournisseur ;
13. appel non financier / préflight / création non payée uniquement si l’API et les permissions réelles le permettent ;
14. corrélation PO ↔ référence fournisseur ;
15. arrêt explicite au gate `PAYMENT_REQUIRED` / `FINANCIAL_COMMITMENT_BLOCKED`.

Le test doit être déclaré échoué si :

- un SKU fournisseur est introuvable ;
- une devise est convertie silencieusement ;
- l’adresse est reconstruite à la main ;
- le coût fournisseur n’est plus frais ;
- l’API réellement accordée diffère de ce que le code suppose ;
- une relance peut créer deux achats ;
- une étape financière peut se déclencher sans gate explicite.

---

## 7. Doctrine du gate pré-paiement

Le futur test E2E doit posséder un garde-fou fort :

- staging uniquement ;
- fournisseur explicitement autorisé ;
- PO explicitement sélectionnée ;
- montant maximum borné ;
- aucune carte/compte de paiement fournisseur utilisable par défaut ;
- aucune transition financière automatique ;
- payload final journalisé sans secret ;
- résultat fournisseur conservé ;
- arrêt avant engagement financier ;
- validation humaine obligatoire pour tout futur passage au paiement réel.

Le but est de prouver l’interfaçage technique d’achat, pas de dépenser.

---

## 8. Ce qui doit être générique vs spécifique fournisseur

### Générique Komerce

- V2 ;
- orchestrateur d’import ;
- eligibility ;
- Raffinerie ;
- candidate lifecycle ;
- promotion draft ;
- Market pricing/exposure ;
- supplier mapping ;
- Purchase Order ;
- idempotence achat ;
- observabilité ;
- audit ;
- gates financiers.

### Spécifique fournisseur

- authentification ;
- discovery ;
- pagination/rate limit ;
- mapping source → V2 ;
- méthodes freight ;
- méthodes create/order detail/tracking ;
- format adresse ;
- contraintes paiement ;
- statuts source ;
- règles de throttling/retry propres au fournisseur.

Cette séparation est le principal résultat architectural du chantier AliExpress.

---

## 9. Checklist d’onboarding d’un nouveau fournisseur produit

Avant de considérer un nouveau fournisseur « intégré », répondre oui à toutes les questions :

- Peut-on lire une référence réelle ?
- Peut-on lire le détail d’un SKU réel ?
- Prix et devise source sont-ils explicites ?
- Stock produit/SKU est-il explicite ou qualifié comme inconnu ?
- Peut-on produire un V2 valide sans logique spéciale dans la Raffinerie ?
- Le produit passe-t-il l’orchestrateur canonique ?
- La catégorie non résolue produit-elle WATCH plutôt qu’une catégorie inventée ?
- Peut-on promouvoir en draft sans publication ?
- Peut-on résoudre produit et SKU vers le fournisseur après promotion ?
- Peut-on produire une PO complète ?
- Peut-on rafraîchir prix/stock avant achat ?
- Les permissions API achat sont-elles réellement prouvées ?
- L’idempotence est-elle définie avant tout appel create-order ?
- Existe-t-il un arrêt explicite avant paiement/engagement financier ?
- Existe-t-il un fallback manuel exploitable ?

Si une réponse est non, le niveau de maturité correspondant n’est pas atteint.

---

## 10. Indicateurs à conserver pour les futurs stress tests

Pour chaque wave fournisseur :

- IDs déjà connus avant run ;
- nouveaux IDs trouvés ;
- produits clean ;
- V2 valides ;
- décisions TEST / PRIORITY / WATCH / EXCLUDED ;
- catégories résolues/non résolues ;
- erreurs source ;
- erreurs normalisation ;
- erreurs Raffinerie ;
- erreurs promotion ;
- déjà promus ;
- drafts créés ;
- actifs ;
- exposés ;
- wrong lifecycle ;
- temps/pages consommés ;
- rate limits ;
- raison d’arrêt ;
- couverture supplier mapping ;
- couverture SKU mapping ;
- fraîcheur prix/stock ;
- PO générées ;
- appels achat préflight ;
- blocages pré-paiement.

Le benchmark fournisseur doit être reproductible et comparable d’un connecteur à l’autre.

---

## 11. Conclusion

AliExpress n’est pas une exception à préserver dans le cœur Komerce. C’est le fournisseur qui a servi à casser suffisamment le pipeline pour révéler ses vraies frontières.

Le modèle à retenir est :

> **La source fournit des faits. Le contrat V2 les stabilise. La Raffinerie juge la qualité/viabilité. Le Market décide de vendre et à quel prix. Le purchasing transforme une commande client en intention d’achat fournisseur. Le connecteur achat exécute cette intention sous gates explicites.**

Lorsque ce découpage tient sur AliExpress, il devient le blueprint d’intégration pour les autres fournisseurs produits.