# Doctrine du Catalogue Komerce

> **Version** : 1.1 — 2026-09-04
> **Statut** : document fondamental — remplace l'approche « chantier CRUD » ; complète SOURCING_ENGINE.md, DOCTRINE_DENSITE_VALEUR.md et la doctrine de confiance
> **Code porteur existant** : `services/suppliers/connectors/*` (LOT D), `services/supplier-catalog-scanner.js`, `services/sourcing-analysis.js`, `routes/products.js`
> **Contrainte fondatrice** : équipe informatique d'UNE personne — l'automatisation réduit la charge, mais ne remplace ni la maîtrise éditoriale ni la validation humaine

---

## 1. Phrase de vérité

> **Le catalogue ne se saisit pas à l'aveugle, il se raffine. La donnée fournisseur
> entre telle quelle et reste immuable. Komerce la normalise, prépare un contenu
> client en français par une voie autorisée — source native FR, rédaction/traduction
> humaine ou assistance IA — puis l'humain valide la première publication. L'IA
> améliore quand elle est utile ; elle n'est jamais un prérequis de publication.**

Le CRUD vide n'est pas le modèle principal : le catalogue part d'une source, même
lorsque cette source est saisie via le connecteur `manual`. En revanche, l'admin
peut **rédiger, traduire et corriger** le contenu client avant publication. Cette
édition ne doit jamais altérer la vérité fournisseur conservée dans les champs
source et le `raw_payload`.

Budget d'effort cible : garder la préparation et la validation aussi légères que
possible. Une fiche déjà propre en français ne doit déclencher aucun appel IA
inutile. Une fiche étrangère ou médiocre peut être préparée manuellement ou avec
une assistance IA, puis validée humainement.

## 2. La raffinerie — six étages, une décision humaine de publication

```txt
 ①connecteur → ②normalisation → ③éligibilité → ④pricing/rails → ⑤préparation FR → ⑥APPROBATION → publié
   source brute     cat. Komerce,   « ce que        sourcing_         native FR /         décision
   multi-langue     KMF, poids,     Komerce peut    decision,         manuel / IA          humaine
                    volume          recevoir »      densité, marge    facultative          initiale
```

Chaque étage enrichit, aucun ne bloque silencieusement : un produit écarté porte
toujours sa raison (`excluded_reason`), visible dans la file admin — même principe
que le scanner LOT D (« il filtre, explique et priorise »).

La préparation éditoriale n'est pas synonyme d'appel IA. Le pipeline doit pouvoir
fonctionner complètement sans fournisseur LLM lorsque le contenu français est
déjà conforme ou préparé humainement.

## 3. Étage ③ — Éligibilité : ce que Komerce peut recevoir

Filtre en deux couches, AVANT toute préparation éditoriale coûteuse (on ne traduit
pas ce qu'on n'embarquera jamais) :

| Couche | Contenu | Exemples | Effet |
|---|---|---|---|
| **Interdits absolus** | Douane Comores + loi | armes et imitations, produits illicites, contrefaçons évidentes | `excluded` définitif, non ré-évaluable |
| **Restreints conditionnels** | Contraintes transport/segment | batteries lithium (aérien interdit → maritime seulement), aérosols/liquides pressurisés, périssables, valeur unitaire > plafond assurance | `restricted` : embarquement contraint (rail forcé maritime, etc.), raison affichée |

Support : table `catalog_exclusions` (motif, couche, mots-clés + catégories de
matching, base légale en note) — **jamais en dur dans le code** (I-08).
Le matching se fait sur la donnée source, dans sa langue d'origine, avant
préparation du contenu client. La liste démarre courte et honnête (les certitudes),
s'enrichit à chaque refus douane réel — le réel calibre, comme partout.

## 4. Étage ⑤ — Préparation éditoriale française

La langue du catalogue client est le **français**. La langue et le contenu de la
donnée source sont conservés à vie (`name_source`, `description_source`,
`source_locale`, `raw_payload`) pour la traçabilité, les litiges fournisseur et
les retraitements futurs.

Trois voies sont autorisées :

1. **Source native FR** — si le titre et la description sont déjà conformes,
   Komerce peut les conserver sans transformation. `content_source='connector_raw'`
   est publiable uniquement si `source_locale` est français et que tous les autres
   garde-fous de publication sont satisfaits.
2. **Préparation humaine** — l'admin peut traduire, rédiger ou corriger le contenu
   client avant validation. Pour une source étrangère brute, une préparation
   éditoriale complète fait passer la présentation client à
   `content_source='manual'`, tandis que `name_source`, `description_source` et
   `source_locale` restent inchangés. Les corrections champ par champ restent
   tracées dans `catalog_field_overrides`.
3. **Assistance IA facultative** — une IA peut proposer traduction, reformulation,
   catégorie, attributs ou précautions. Le résultat est tracé
   `content_source='ai_enriched'`, avec `enrichment_version`, confiance et
   `needs_review` selon les règles du service.

Une source étrangère brute (`connector_raw` non française) **ne peut jamais être
publiée telle quelle**. Elle doit d'abord passer par la voie humaine ou IA.

L'absence de crédit, de clé API ou l'indisponibilité d'un fournisseur IA ne doit
jamais bloquer une fiche native FR ou une fiche préparée manuellement.

Garde-fous communs :
- **Glossaire métier en DB** (`catalog_glossary`) : référence terminologique pour
  les traductions humaines comme pour l'IA ;
- **Marquage d'origine** : `content_source` (`ai_enriched` / `manual` /
  `connector_raw`) décrit la provenance de la présentation client ;
- **Overrides** : les corrections humaines d'une fiche issue du pipeline restent
  tracées champ par champ, y compris après passage à `manual` ;
- `enrichment_version` et `enrichment_confidence` ne sont requis que pour la voie
  `ai_enriched` ;
- les champs source et le `raw_payload` sont immuables du point de vue éditorial.

## 5. Règle de rejouabilité — la source reste la vérité

**Toute fiche doit pouvoir être reconstruite en repartant de sa donnée source et
de ses décisions éditoriales tracées.**

La préparation initiale humaine peut produire une présentation client `manual`.
Les corrections se posent en **overrides tracés** champ par champ, réappliqués
après un nouveau raffinage. Une réimportation ou un éventuel ré-enrichissement IA
ne doit jamais effacer une décision humaine existante sans action explicite.

Corollaire : le CRUD admin existant devient un éditeur de contenu préparé et
d'overrides — même formulaire, mais avec une sémantique de traçabilité stricte.

## 6. La validation humaine — autorité de première publication

L'approbation (étage ⑥) reste l'autorité de publication :

- **Nouvelle référence** : toujours approuvée humainement après lecture de la
  fiche FR, quelle que soit l'origine de la présentation (`connector_raw` FR,
  `manual` ou `ai_enriched`). C'est le `quality_validated` existant — validation
  de la RÉFÉRENCE.
- **Mise à jour d'une fiche déjà approuvée** : peut être auto-publiée si le
  changement est borné et couvert par les règles existantes ; les changements
  éditoriaux significatifs ou incertains restent en review.
- Rien ne passe `lifecycle_status='active'` une première fois sans l'approbation
  prévue par le garde de publication.
- Une IA peut proposer ; elle ne possède jamais l'autorité de publication.

## 7. Ce que la doctrine interdit

- Ne jamais publier une source étrangère brute sous `connector_raw`.
- Ne jamais publier un contenu IA non passé par l'approbation initiale.
- Ne jamais modifier `name_source`, `description_source`, `source_locale` ou le
  `raw_payload` pour faire passer une traduction comme vérité fournisseur.
- Ne jamais traduire ou enrichir avant d'avoir filtré l'éligibilité lorsque ce
  travail est coûteux.
- Ne jamais éditer une fiche pipeline sans provenance/override traçable.
- Ne jamais coder une exclusion douane en dur (table + business_rules).
- Ne jamais imposer une clé ou un crédit IA à une fiche FR déjà conforme ou à une
  fiche préparée humainement.
- Ne jamais dépasser le cap catalogue (`catalog_cap_mvp`) par automatisation : la
  raffinerie propose, le cap arbitre — un produit qui entre en pousse un autre
  vers la sortie (classement par densité de valeur, V-2).

## 8. L'IA sous gouvernance — assistance optionnelle

L'enrichissement IA reste un composant gouverné lorsqu'il est utilisé : prompt
versionné dans le dépôt, sortie contrainte par schéma, échecs tracés, coût par
produit suivi. Un changement de prompt = une PR = les gates.

Mais le composant IA est **optionnel et remplaçable**. Komerce doit rester capable
d'importer, préparer, valider et publier un catalogue sans dépendre d'OpenAI,
Anthropic ou de tout autre fournisseur LLM.

L'utilisation ponctuelle d'un assistant externe pour aider l'opérateur à préparer
un lot de fiches n'introduit pas de dépendance runtime : une fois relu et intégré
au workflow éditorial, ce contenu relève de la voie humaine `manual`.

## 9. Clés business_rules

| Clé | Défaut | Rôle |
|---|---|---|
| `CATALOG_ENRICH_CONFIDENCE_MIN` | 0.8 | Seulement voie IA : sous ce score, `needs_review` |
| `CATALOG_AUTOPUBLISH_PRICE_DELTA_PCT` | 10 | Variation de prix au-delà : review humaine |
| `CATALOG_CAP_MVP` | 120 (existante) | Le cap arbitre, la raffinerie propose |
| `CATALOG_MAX_VALUE_KMF` | à calibrer | Plafond valeur unitaire (couche restreints, assurance) |

## 10. Séquencement

| Lot | Contenu | Dépendance |
|---|---|---|
| K-1 | Colonnes source + marquage : `name_source`, `description_source`, `source_locale`, `content_source`, `enrichment_version`, table `catalog_glossary`, table `catalog_exclusions` | aucune |
| K-2 | Étage ③ dans le scanner : matching exclusions sur donnée source, décisions `excluded`/`restricted` avec raison | K-1 |
| K-3 | Préparation éditoriale FR : voie native FR + voie manuelle ; service IA conservé comme assistance facultative | K-1 |
| K-4 | File d'approbation admin : fiche préparée → approve / reject / edit / override en 1 écran ; provenance et overrides tracés | K-3 |
| K-5 | Auto-publication bornée des mises à jour + retraitement en masse optionnel selon la provenance du contenu | K-4 + terrain |

**Principe final** : la qualité et la traçabilité sont obligatoires ; le moyen
utilisé pour obtenir le contenu français ne l'est pas. La source reste la vérité,
l'humain garde l'autorité de publication, et l'IA reste un accélérateur facultatif.
