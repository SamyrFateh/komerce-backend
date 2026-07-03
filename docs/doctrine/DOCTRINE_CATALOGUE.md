# Doctrine du Catalogue Komerce

> **Version** : 1.0 — 2026-07-03
> **Statut** : document fondamental — remplace l'approche « chantier CRUD » ; complète SOURCING_ENGINE.md, DOCTRINE_DENSITE_VALEUR.md et la doctrine de confiance
> **Code porteur existant** : `services/suppliers/connectors/*` (LOT D), `services/supplier-catalog-scanner.js`, `services/sourcing-analysis.js`, `routes/products.js`
> **Contrainte fondatrice** : équipe informatique d'UNE personne — tout ce qui n'est pas automatisé n'existera pas

---

## 1. Phrase de vérité

> **Le catalogue ne se saisit pas, il se raffine. La donnée naît en anglais
> chez un fournisseur de Dubaï, traverse une raffinerie automatique, et en
> sort en français, éligible, prête à approuver. L'humain ne rédige jamais :
> il approuve ou rejette.**

Le CRUD n'est pas le modèle, c'est **l'exception** — l'outil de correction
ponctuelle sur une fiche déjà raffinée. Le jour où l'admin ouvre un
formulaire vide pour créer un produit, la doctrine a échoué.

Budget d'effort cible : **< 2 minutes humaines par produit publié** (lire la
fiche générée, approuver). Au cap de 120 références : le catalogue entier se
reconstruit en ~4 heures d'attention humaine — c'est la définition
opérationnelle de « sans effort » pour une équipe d'une personne.

## 2. La raffinerie — six étages, un seul point humain

```txt
 ①connecteur → ②normalisation → ③éligibilité → ④pricing/rails → ⑤enrichissement FR → ⑥APPROBATION → publié
   (existe)       (existe)        (à créer)       (existe)          (à créer)          (1 clic)
   EN, multi-     cat. Komerce,   « ce que        sourcing_         traduction +       le SEUL point
   source         KMF, poids,     Komerce peut    decision,         adaptation IA      humain du
                  volume          recevoir »      densité, marge                       pipeline
```

Chaque étage enrichit, aucun ne bloque silencieusement : un produit écarté
porte toujours sa raison (`excluded_reason`), visible dans la file admin —
même principe que le scanner LOT D (« il filtre, explique et priorise »).

## 3. Étage ③ — Éligibilité : ce que Komerce peut recevoir

Filtre en deux couches, AVANT tout enrichissement (on ne traduit pas ce
qu'on n'embarquera jamais) :

| Couche | Contenu | Exemples | Effet |
|---|---|---|---|
| **Interdits absolus** | Douane Comores + loi | armes et imitations, produits illicites, contrefaçons évidentes | `excluded` définitif, non ré-évaluable |
| **Restreints conditionnels** | Contraintes transport/segment | batteries lithium (aérien interdit → maritime seulement), aérosols/liquides pressurisés, périssables, valeur unitaire > plafond assurance | `restricted` : embarquement contraint (rail forcé maritime, etc.), raison affichée |

Support : table `catalog_exclusions` (motif, couche, mots-clés + catégories
de matching, base légale en note) — **jamais en dur dans le code** (I-08).
Le matching par mots-clés EN se fait sur la donnée source, avant traduction.
La liste démarre courte et honnête (les certitudes), s'enrichit à chaque
refus douane réel — le réel calibre, comme partout.

## 4. Étage ⑤ — Enrichissement français : traduire est un métier, pas un dictionnaire

La langue du catalogue publié est le **français**. La langue de la donnée
source est conservée à vie (`name_source`, `description_source`,
`source_locale`) — pour retraduire en masse, et pour les litiges fournisseur
(la commande à Dubaï se passe en anglais).

L'enrichissement IA produit, en un appel par produit :
- **titre FR** court, orienté client (pas une traduction littérale du titre
  SEO fournisseur bourré de mots-clés) ;
- **description FR** adaptée : unités converties (inches→cm, oz→g),
  tailles expliquées (UK/EU), ton Komerce, mention des précautions
  (`fragility` proposée si le texte source l'évoque) ;
- **catégorie boutique** proposée (mapping existant du scanner, confirmé) ;
- **score de confiance** : sous un seuil, la fiche est marquée
  `needs_review` avec les passages douteux surlignés.

Garde-fous :
- **Glossaire métier en DB** (`catalog_glossary`) : les termes qui se
  traduisent d'UNE façon (ou pas du tout — noms de marques, termes
  religieux/culturels sensibles) — injecté dans chaque appel. Le glossaire
  est la mémoire des corrections : chaque retouche admin récurrente devient
  une entrée, et l'erreur ne se reproduit plus.
- **Marquage d'origine** : `content_source` (`ai_enriched` / `manual` /
  `connector_raw`) + `enrichment_version` sur chaque fiche. On sait toujours
  qui a écrit quoi, et on peut re-raffiner en masse quand le prompt
  s'améliore — sans écraser les retouches humaines (voir §5).

## 5. Règle de rejouabilité — le pipeline est la source, jamais la fiche

**Toute fiche doit pouvoir être régénérée depuis sa donnée source.** Les
retouches manuelles ne modifient pas la fiche générée : elles se posent en
**overrides tracés** (champ par champ), réappliqués après chaque
re-raffinage. C'est ce qui rend possible, pour une personne seule :
retraduire 120 fiches en un job quand le prompt v2 sort, sans perdre six
mois de corrections ponctuelles.

Corollaire : le CRUD admin existant devient l'éditeur d'overrides — même
formulaire, sémantique nouvelle.

## 6. La validation humaine — un seul point, dégressif comme au hub

L'approbation (étage ⑥) suit la même logique que le contrôle qualité Dubaï :

- **Nouvelle référence** : toujours approuvée humainement (lecture fiche FR,
  1 clic approve/reject/retouche). C'est le `quality_validated` existant —
  la validation de la RÉFÉRENCE.
- **Mise à jour d'une fiche déjà approuvée** (prix fournisseur, stock,
  re-raffinage) : auto-publiée si le score de confiance est haut et le
  changement borné (prix dans ±X %), sinon file de review. L'attention
  humaine se concentre où le risque vit, et **diminue à mesure que la
  confiance se prouve** — le solo-dev ne relit pas 120 fiches par mois.
- Rien ne passe `lifecycle_status='active'` sans être passé par ⑥ au moins
  une fois. L'IA propose tout, ne publie jamais seule une nouveauté.

## 7. Ce que la doctrine interdit

- Ne jamais créer un produit par formulaire vide (le connecteur `manual`
  EST le formulaire — il entre par l'étage ①, comme les autres).
- Ne jamais publier de contenu IA non passé par l'approbation initiale.
- Ne jamais traduire avant d'avoir filtré l'éligibilité (coût inutile).
- Ne jamais éditer une fiche sans override tracé (l'édition sauvage casse
  la rejouabilité — c'est le bug de prod du solo-dev dans six mois).
- Ne jamais coder une exclusion douane en dur (table + business_rules).
- Ne jamais perdre la donnée source anglaise (litiges + retraduction).
- Ne jamais dépasser le cap catalogue (`catalog_cap_mvp`) par automatisation :
  la raffinerie propose, le cap arbitre — un produit qui entre en pousse un
  autre vers la sortie (classement par densité de valeur, V-2).

## 8. L'IA sous gouvernance — même régime que le code

L'enrichissement IA est un composant comme un autre : prompt versionné dans
le dépôt (pas dans une console), sortie contrainte (JSON schéma validé),
échecs tracés, coût par produit suivi. Un changement de prompt = une PR =
les gates. La gouvernance « poussée dans ses retranchements » ne s'arrête
pas au SQL : **le prompt est du code**.

## 9. Clés business_rules

| Clé | Défaut | Rôle |
|---|---|---|
| `CATALOG_ENRICH_CONFIDENCE_MIN` | 0.8 | Sous ce score : `needs_review` au lieu d'auto-flux |
| `CATALOG_AUTOPUBLISH_PRICE_DELTA_PCT` | 10 | Variation de prix au-delà : review humaine |
| `CATALOG_CAP_MVP` | 120 (existante) | Le cap arbitre, la raffinerie propose |
| `CATALOG_MAX_VALUE_KMF` | à calibrer | Plafond valeur unitaire (couche restreints, assurance) |

## 10. Séquencement

| Lot | Contenu | Dépendance |
|---|---|---|
| K-1 | Colonnes source + marquage : `name_source`, `description_source`, `source_locale`, `content_source`, `enrichment_version`, table `catalog_glossary`, table `catalog_exclusions` (+ seeds interdits absolus douane Comores) | aucune — migration légère pattern 095 |
| K-2 | Étage ③ dans le scanner : matching exclusions sur donnée source EN, décisions `excluded`/`restricted` avec raison | K-1 |
| K-3 | Service d'enrichissement FR (appel IA, JSON contraint, glossaire injecté, score de confiance, prompt versionné dans le dépôt) | K-1 |
| K-4 | File d'approbation admin : fiche générée → approve / reject / override en 1 écran ; overrides tracés champ par champ | K-3 |
| K-5 | Auto-publication bornée des mises à jour (confiance + delta prix) + job de re-raffinage en masse | K-4 + 1 mois de terrain |

**Note solo-dev** : K-1 à K-4 sont chacun de la taille des lots V/Q livrés
cette semaine — un lot par session, la raffinerie complète en quatre
sessions. K-5 attend d'avoir vu vivre la file.
