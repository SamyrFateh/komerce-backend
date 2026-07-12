# Doctrine d'Ingestion du Catalogue Komerce

> **Version** : 1.1 — 2026-07-12
> **Statut** : document fondamental — complète `DOCTRINE_CATALOGUE.md` et `DOCTRINE_PRODUCT_DETAIL_CONTRACT.md` en verrouillant la porte d'entrée
> **Code porteur** : `services/suppliers/normalized-product.js`, `schemas/catalog/normalized-supplier-product.v*.schema.json`, `services/suppliers/connectors/*`, `services/suppliers/catalog-import-orchestrator.js`, `services/supplier-catalog-scanner.js`
> **Contrainte fondatrice** : le fondateur n'arbitre que le haut niveau. Il ne relit jamais une donnée fournisseur. Tout ce qui exige de « réfléchir produit par produit » est un échec de cette doctrine.

---

## 1. Phrase de vérité

> **Le catalogue n'a pas besoin d'être intelligent. Il doit être incapable d'avaler de la donnée sale sans le dire. La raffinerie ne reçoit jamais une donnée « probablement propre » : elle reçoit une donnée contractuellement propre, ou rien — et quand c'est « rien », la raison est écrite, comptée et visible.**

Corollaire PDC :

> **Une source riche ne doit jamais être aplatie puis reconstruite plus tard par heuristique. Une source pauvre reste pauvre honnêtement.**

Entre la boutique et les sources fournisseurs, l'intelligence est silencieuse mais jamais muette. Silencieuse : elle ne demande rien à l'humain. Jamais muette : chaque donnée écartée, estimée ou douteuse laisse une trace lisible et, au-delà d'un seuil, une alerte.

---

## 2. Les deux moteurs non négociables

| Moteur | Rôle | Exigence non négociable |
|---|---|---|
| **Moteur économique** | prix, marges, rails, densité de valeur | gouverné par pricing-engine et doctrines économiques |
| **Moteur catalogue** | ingestion → raffinerie → publication | **fiabilité**, **lisibilité**, **alerting**, **performance**, **préservation des faits source connus** |

Cette doctrine gouverne le second moteur, côté entrée.

---

## 3. Contrat pivot versionné

Tous les connecteurs produisent un `NormalizedSupplierProduct` validé par `services/suppliers/normalized-product.js`.

### V1 — source plate compatible

Schéma :

```text
schemas/catalog/normalized-supplier-product.v1.schema.json
```

V1 reste le contrat des sources historiques plates : nom, référence fournisseur, prix/devise, image principale, description, stock agrégé éventuel, délai, poids et dimensions.

L'absence de `schema_version` signifie **V1** pour compatibilité. Cela ne signifie jamais « détecter automatiquement la richesse et faire au mieux ».

### V2 — source riche explicitement préservée

Schéma :

```text
schemas/catalog/normalized-supplier-product.v2.schema.json
```

V2 ajoute, lorsque la source les connaît déjà :

```text
media[]
option_axes[]
sellable_units[]
source_locale
```

- `media[]` porte URL, rôle (`PRODUCT`, `SCENE`, `DETAIL`, `SIZE_GUIDE`, `OTHER`) et associations d'options connues ;
- `option_axes[]` décrit les axes et leurs valeurs source ;
- `sellable_units[]` décrit les unités réellement vendables connues du fournisseur : référence fournisseur, combinaison complète, stock source, prix source éventuel et références média.

**V2 doit déclarer `schema_version: "2"`.** Une structure riche injectée dans V1 est rejetée ; elle n'est pas promue silencieusement par le validateur.

Le connecteur manuel peut choisir V2 lorsqu'une saisie riche est explicitement fournie sans version. Un connecteur API futur doit choisir sa version consciemment dans son mapping.

---

## 4. Invariants référentiels V2

Le schéma JSON valide la forme. `normalized-product.js` valide en plus les coutures référentielles :

1. une clé d'axe n'est déclarée qu'une fois ;
2. une unité vendable référence uniquement des axes et valeurs déclarés ;
3. si des axes existent, chaque `sellable_unit` porte une combinaison complète ;
4. deux unités ne portent pas le même `supplier_sku` ;
5. deux unités ne représentent pas la même combinaison d'options ;
6. une `media_ref` pointe vers un `supplier_media_id` connu ;
7. un média peut être associé à un sous-ensemble d'axes, mais jamais à une valeur inconnue.

Ces règles **valident ce que le fournisseur affirme**. Elles ne créent aucune combinaison manquante.

Exemple : si les axes déclarent `Couleur = Marron, Beige` et `Taille = M, L`, mais que la source ne fournit que `Marron+M` et `Marron+L`, Komerce conserve exactement ces deux unités. Il n'invente pas `Beige+M` ni `Beige+L`.

---

## 5. Le brut et le normalisé sont deux preuves distinctes

`raw_payload` reste la donnée fournisseur intégrale et inchangée. C'est la matière première de rejouabilité et de litige.

Pour V2, `sourcing_candidates.normalized_source_contract` conserve séparément le snapshot du contrat normalisé validé, sans dupliquer `raw_payload`.

```text
raw_payload
= ce que le fournisseur a dit

normalized_source_contract
= comment le connecteur l'a traduit dans le contrat Komerce V2
```

Cette séparation est non négociable :

- ne jamais polluer `raw_payload` avec des clés internes `_komerce_*` ;
- ne jamais utiliser `scan_result` pour stocker les médias ou unités vendables source ;
- ne jamais considérer `normalized_source_contract` comme la vérité de stock catalogue.

Le snapshot V2 est une **preuve de mapping d'entrée**. PDC-2 décidera explicitement comment promouvoir ces faits vers `PRODUCT / MEDIA / OPTION_AXES / SKU`.

Les contrats V1 gardent `normalized_source_contract = NULL` : aucune richesse n'est fabriquée a posteriori.

---

## 6. Les invariants d'ingestion (ING-I)

Toute PR touchant l'ingestion se juge contre ces invariants. Ils sont vérifiés par `npm run gate:catalog-contract` et les tests du contrat versionné.

- **ING-I1 — Contrat, pas convention.** Tout objet sortant d'un connecteur valide un schéma versionné supporté. `additionalProperties:false`, bornes réalistes, `raw_payload` requis et `currency` requise. Un connecteur qui contourne le contrat n'existe pas.
- **ING-I2 — Jamais inventer, jamais deviner en silence.** Aucune valeur par défaut fabriquée (devise, prix, stock, combinaison SKU). Une donnée manquante est un rejet motivé ou une estimation marquée qui dégrade la décision en aval.
- **ING-I3 — Le brut ne se perd jamais.** `raw_payload` est la donnée source intégrale et persistée. Les champs inconnus restent disponibles pour rejouer l'éligibilité ou le mapping.
- **ING-I3B — Le mapping riche ne se perd jamais.** Pour un contrat V2 validé, `normalized_source_contract` préserve le mapping média/axes/unités produit par le connecteur. Le scanner ne l'aplatit pas et ne le reconstruit pas.
- **ING-I4 — Le sale déclenche, il ne s'accumule pas.** Chaque ligne rejetée porte sa raison. Au-delà de `CATALOG_IMPORT_MAX_INVALID_PCT`, l'import entier est refusé.
- **ING-I5 — Une exclusion absolue est terminale partout.** Aucun clic ni ré-import ne transforme un candidat `rejected`/`EXCLUDED` en produit.
- **ING-I6 — Pas de décision sourcing sur du vide.** Prix d'achat manquant → `WATCH` forcé avec raison explicite. Jamais `TEST` sur un coût zéro.
- **ING-I7 — Les tests attaquent, ils ne documentent pas.** Chaque incident fournisseur réel devient une fixture. Les tests V2 attaquent aussi les références média, les axes et les combinaisons dupliquées/incomplètes.
- **ING-I8 — La frontière publique reste whitelistée.** Aucun endpoint Boutique ne sort une ligne brute ou `normalized_source_contract`. Toute nouvelle donnée publique passe par une projection catalogue explicite.

---

## 7. Rôles — qui fait quoi

| Acteur | Fait | Ne fait jamais |
|---|---|---|
| **Connecteurs** | encaissent la source et sortent V1/V2 valide ou un rejet motivé ; préservent les structures riches connues | inventer une valeur, compléter une matrice SKU, associer une image à une couleur par heuristique |
| **Validateur pivot** | choisit le schéma déclaré, valide forme et références V2 | promouvoir silencieusement V1 vers V2, corriger une combinaison |
| **Scanner / raffinerie** | enrichit, estime en le marquant, décide avec des raisons lisibles | aplatir `media/option_axes/sellable_units`, travailler sur une donnée non contractuelle |
| **Orchestrateur import** | persiste le brut et le snapshot normalisé V2 séparément | faire du snapshot source le catalogue canonique ou la vérité de stock |
| **Gate CI** | rejoue le corpus sale et les invariants V2 | être contournable ou informative |
| **Fondateur** | arbitre les seuils, approuve/rejette des fiches finies, lit les alertes agrégées | relire une ligne fournisseur, reconstruire une variante produit par produit |

---

## 8. Clés business_rules

| Clé | Défaut | Rôle |
|---|---|---|
| `CATALOG_IMPORT_MAX_INVALID_PCT` | 30 | Au-delà : import entier refusé |
| `CATALOG_MAX_WEIGHT_KG` | 500 | Borne haute contrat |
| `CATALOG_MAX_UNIT_PRICE_KMF` | à calibrer | Borne haute prix unitaire |
| `CATALOG_NAME_MAX_LEN` | 300 | Borne titre |

Les seuils sont l'espace d'arbitrage du fondateur. Le code applique, ne choisit pas.

---

## 9. Ce que cette doctrine interdit

- Ajouter un défaut silencieux (`|| 'AED'`, `|| 0`, `|| 'autre'` sans marquage) dans un connecteur ou le scanner.
- Faire passer `invalid` d'un statut bloquant à informatif.
- Merger un connecteur sans schéma versionné et corpus de tests.
- Réduire le corpus de fixtures.
- Exposer un champ de cuisine ou `normalized_source_contract` sans projection publique explicite.
- Permettre l'import d'un candidat terminal `rejected`.
- Aplatir `sellable_units[]` en stocks indépendants de couleur et de taille.
- Générer le produit cartésien des axes et l'appeler « unités fournisseur ».
- Déduire l'association d'un média depuis son nom de fichier, sa position ou sa couleur dominante.
- Modifier `raw_payload` pour y injecter la représentation normalisée interne.

---

## 10. Définition de « terminé » pour PDC-1

PDC-1 est terminé quand :

1. V1 reste accepté sans changement de comportement ;
2. V2 valide une source riche structurée ;
3. axes dupliqués, combinaison incomplète/inconnue, SKU/combo dupliqué et media_ref inconnue sont rejetés avec une raison lisible ;
4. le connecteur manuel préserve une structure riche sans inventer les unités absentes ;
5. un produit V2 traverse l'import jusqu'à `sourcing_candidates.normalized_source_contract` ;
6. `raw_payload` reste séparé et intégral ;
7. un produit V1 persiste `normalized_source_contract = NULL` ;
8. aucun endpoint public ni stock catalogue n'est modifié par ce lot.

La promotion de ces faits dans le catalogue canonique appartient à **PDC-2**.
