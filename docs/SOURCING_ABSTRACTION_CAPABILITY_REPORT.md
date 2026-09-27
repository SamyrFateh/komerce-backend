# Rapport de capacité — Abstraction Sourcing

**Version : 2026-09-25**  
**Statut de l'abstraction : ACCEPTED — core générique validé**  
**But :** fournir une fiche de capacité lisible avant l'intégration d'une nouvelle source fournisseur ou avant le peuplement du catalogue.

## 1. Rôle de l'abstraction

L'abstraction Sourcing transforme une source externe hétérogène en identités fournisseur et canoniques déterministes, sans laisser le fournisseur dicter le modèle métier Komerce.

Chaîne canonique :

`Source → Capture → Observation → Evidence → Resolution → Canonical Product → Canonical Offer → Canonical Unit → sourcing_candidate → draft catalogue inactif → product_sku → Supplier Order Identity → Purchasing readiness / HARD_STOP`

En termes simples, Sourcing doit répondre à deux questions :

1. **Qu'est-ce que cette chose ?** — produit, offre et variante exacte.
2. **Peut-on préparer un achat sans ambiguïté ?** — identité fournisseur exacte et Supplier Order Identity.

Il ne choisit pas le hub, ne choisit pas le fournisseur à acheter maintenant, ne publie pas le produit et ne déclenche pas une commande fournisseur.

## 2. Vocabulaire de statut

| Statut | Signification |
| --- | --- |
| `VALIDATED` | capacité générique prouvée et réutilisable sans logique provider dans le core |
| `PROVIDER_GATE` | le core sait traiter la capacité, mais chaque provider/compte doit apporter sa propre preuve réelle |
| `OUT_OF_SCOPE` | responsabilité volontairement détenue par un autre domaine |
| `BLOCKED_BY_DESIGN` | opération volontairement impossible depuis Sourcing |

## 3. Capacités validées

| Capacité | Statut | Ce que Komerce sait faire | Preuve / frontière |
| --- | --- | --- | --- |
| Accepter plusieurs types de sources | `VALIDATED` | API, fichiers, saisie manuelle et futurs adapters convergent vers les mêmes grains métier | `sourcing_sources`, adapters, doctrine multi-source |
| Normaliser un produit fournisseur | `VALIDATED` | projeter les données fournisseur vers `Normalized Supplier Product V2` tout en conservant le brut et la provenance | `services/suppliers/normalized-product.js`, connecteurs CJ/AliExpress/etc. |
| Conserver une histoire immuable | `VALIDATED` | enregistrer Capture + Observation + Evidence horodatées sans écraser la source précédente | shadow ingestion + tables Sourcing |
| Séparer Product / Offer / Unit | `VALIDATED` | distinguer identité du produit, vérité commerciale de l'offre et variante fournisseur exacte | Golden Sourcing E2E |
| Résoudre une identité multi-source | `VALIDATED` | lier des observations à une identité canonique uniquement sur preuves déterministes ; les ambiguïtés sont bloquées | ResolutionDecision / ResolutionBinding |
| Namespacer les références | `VALIDATED` | empêcher deux références textuellement identiques de fournisseurs/comptes différents d'être confondues | refs canoniques par Source |
| Préserver UNKNOWN | `VALIDATED` | une donnée absente reste inconnue ; elle ne devient ni zéro, ni false, ni PASS | doctrine Sourcing / Catalog Intake |
| Alimenter la Raffinerie | `VALIDATED` | produire un `sourcing_candidate` traçable à partir d'une source réelle sans publication automatique | `catalog-import-orchestrator` |
| Promouvoir vers un draft catalogue | `VALIDATED` | créer un produit inactif et ses SKU/médias avec identité fournisseur conservée | promotion catalogue + Golden E2E |
| Résoudre une variante achetable exacte | `VALIDATED` | retrouver la Canonical Unit et le `product_sku` exact sans matching approximatif | Canonical Unit + exact SKU proofs |
| Porter une Supplier Order Identity | `VALIDATED` | transporter une identité opaque `{provider, version, payload}` détenue par l'adapter provider | `supplier_order_identity` |
| Préparer Purchasing | `VALIDATED` | atteindre un gate de readiness déterministe ; ambiguïté ou identité manquante = blocage explicite | Canonical Unit purchasing gate |
| Onboarder un nouveau provider sans modifier le core | `VALIDATED` | un nouvel adapter peut s'intégrer s'il respecte les contrats génériques | doctrine Golden multi-source |
| Prouver les capacités réelles d'un provider | `PROVIDER_GATE` | documenter `documented / authorized / implemented / proved` au bon compte et environnement | capacité à prouver provider par provider |

## 4. Ce que Sourcing ne fait volontairement pas

| Sujet | Statut | Owner |
| --- | --- | --- |
| Choisir où acheter maintenant entre plusieurs offres | `OUT_OF_SCOPE` | Selection / Purchasing |
| Choisir ou optimiser un hub | `OUT_OF_SCOPE` | Logistics / Hub |
| Décider Dubaï, France, Tanzanie ou autre hub | `OUT_OF_SCOPE` | Logistics / Hub |
| Calculer le prix de vente Market | `OUT_OF_SCOPE` | Economic Engine / Market |
| Publier le produit dans la Boutique | `OUT_OF_SCOPE` | Catalog / Market Delegation |
| Modifier une commande client déjà engagée | `BLOCKED_BY_DESIGN` | Orders |
| Exécuter `placeOrder` chez un fournisseur | `BLOCKED_BY_DESIGN` dans le Golden | Purchasing |
| Inventer un SKU, un stock ou une identité manquante | `BLOCKED_BY_DESIGN` | — |

## 5. Contrat minimal d'intégration d'un nouveau fournisseur

Un fournisseur est **Sourcing-ready** lorsque les points suivants sont vrais :

- identité de source stable et namespace explicite ;
- lecture d'au moins une référence réelle ou sandbox autorisée ;
- mapping vers `Normalized Supplier Product V2` ;
- `supplier_product_id` stable ;
- variantes exactes conservées quand elles existent ;
- prix, devise, stock et logistique non disponibles conservés comme UNKNOWN ;
- références Product / Offer / Unit observables au bon grain ;
- provenance et payload source auditables ;
- aucune branche provider-native ajoutée dans le core Sourcing ;
- Supplier Order Identity fournie quand le provider sait identifier une unité commandable ;
- toute ambiguïté aboutit à un blocage, jamais à une approximation.

## 6. Tests réels déjà représentatifs

- **AliExpress** : stress-test réel du pipeline, catalogue volumique, V2, variantes, prix/stock, Raffinerie et promotion draft.
- **CJdropshipping** : lecture réelle de produits, variantes, prix, catégories, stock détaillé par VID/entrepôt et passage par le même orchestrateur/Raffinerie.
- **Manual** : prouve qu'une source sans API reste compatible avec le modèle Sourcing, mais sans fabriquer de Supplier Order Identity.
- **Golden Sourcing E2E** : prouve la continuité multi-source jusqu'à l'identité exacte et le gate Purchasing sans achat.

Ces providers sont des preuves minimales, **pas une whitelist**.

## 7. Critères de refus d'intégration

Une intégration doit être refusée si elle exige l'un des comportements suivants :

- écrire directement dans `products` depuis le connecteur ;
- faire dépendre le core Sourcing d'un champ natif spécifique au provider ;
- deviner une variante à partir d'un titre ou d'un SKU ressemblant ;
- traiter un stock absent comme zéro ;
- fusionner deux namespaces parce que leurs références ont le même texte ;
- publier automatiquement après ingestion ;
- faire exécuter une commande fournisseur depuis un worker de découverte catalogue.

## 8. Verdict d'acceptation

### Verdict

`SOURCING_CORE_ABSTRACTION = ACCEPTED`

L'abstraction Sourcing est considérée **fermée pour le core**. Elle peut servir de socle au peuplement réel du catalogue et aux E2E utilisateurs.

À partir de maintenant, l'intégration d'un nouveau fournisseur ne doit pas rouvrir l'architecture Sourcing : elle doit seulement satisfaire le contrat ci-dessus et fournir ses preuves provider spécifiques.

Les sujets de stock réellement commandable, préflight, achat, hub et routing restent des validations d'intégration des domaines Purchasing/Logistics ; ils ne remettent pas en cause l'abstraction Sourcing.