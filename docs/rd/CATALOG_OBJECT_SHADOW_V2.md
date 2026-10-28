# Komerce — classification V2 en shadow : plan rapide vers les E2E

Branche : research/catalog-object-family-shadow-v2, basée sur la PR #3078.
Aucun effet sur products, douane, marchés, prix, publication ou commandes.
Le code V1 demeure intégralement inchangé.

## Contrats réellement exécutables

Le mode prepare contrôle le SHA256 exact des 498 identités sources CJ et
recoupe l'identité REF / fournisseur / titre / chemin avec la preuve PostgreSQL
V1. Il exporte :
- identity-input.jsonl (empreinte source par produit, entrée d'extraction) ;
- blind-calibration.csv et blind-holdout.csv (sans verdict, labels vides) ;
- prepare-report.json (498, V1, groupes exacts, répartition, aucun score inventé).

La partition est stable et les titres normalisés identiques restent dans la
même strate. Ces fichiers ne contiennent **aucune annotation humaine**.

Une extraction IA opt-in est possible via un batch limité : identité
canonique FR, citation exacte du titre d'origine, rôle, public, accessoire,
ambiguïté. Cache keyed par (modèle, prompt-version, input_hash). Le chemin
fournisseur n'est que du contexte. Refus d'une preuve non présente dans le
titre et rejet des données obsolètes. Le mode CI est sans clé ni API.

L'analyse shadow regroupe par (objet, public, rôle, accessoire_de).
Le registre de décisions est vide par défaut. Seules des règles APPROVED,
avec auteur, version, fournisseur observé, et désaccord V1 explicitement
arbitré le cas échéant, peuvent produire un placement **shadow** ;
aucune catégorie en base n'est modifiée.

## Exécuter

Depuis le dépôt, récupérer d'abord les deux artefacts CI authentiques :

mkdir -p baseline v1
gh run download 40518230098 -R SamyrFateh/komerce-backend -n cj-balanced-e2e-500 -D baseline
gh run download 40607392815 -R SamyrFateh/komerce-backend -n cj-498-p1-real-pg-e2e-40607392815 -D v1

Puis :

node scripts/cj-object-shadow-v2.js prepare baseline/classification-evidence.json v1/all-498-decisions.json artifacts/object-shadow

L'extracteur IA est **facultatif et explicitement activé** pour une expérience
limitée (clé non enregistrée dans le dépôt, modèle choisi par l'opérateur).
Dans cet exemple le maximum est 20 produits, par lots de 5 :

SHADOW_ALLOW_API=YES ANTHROPIC_API_KEY=... SHADOW_IDENTITY_MODEL=... \
node scripts/cj-object-extract-batch.js \
artifacts/object-shadow/identity-input.jsonl \
artifacts/object-shadow/identity-extractions.jsonl 20 5

Le modèle et le prix ne sont pas supposés. Les usages en tokens sont émis,
pas de prétention à un coût exact avant tarification. Le cache est
resumable ; pas de clés dans les logs. Si la réponse LLM est invalide,
les extraits rejetés ne sont pas appliqués.

Après extraction, sans règle humaine :

node scripts/cj-object-shadow-v2.js evaluate \
baseline/classification-evidence.json v1/all-498-decisions.json \
artifacts/object-shadow \
artifacts/object-shadow/identity-extractions.jsonl

Résultats : family-cards.json, shadow-assignments.json, shadow-invalid.json,
shadow-report.json. Le nombre de familles n'est connu **qu'après**
l'extraction réelle ; le calcul à partir des titres complets n'est pas une
estimation du nombre de types d'objets.

## Registre de règles humaines (exemple de structure seulement)
[
  {"key":"sac a dos|enfant|principal|-",
   "status":"APPROVED","category":"Mode & Beauté","subcategory":null,
   "reviewed_by":"identifiant-operateur","version":"1",
   "observed_suppliers":["CJdropshipping"],"v1_disagreement_reviewed":true}
]

Une règle approuvée ne constitue pas une preuve de précision globale. Les
cartes regroupent exemples typiques et atypiques identifiés par preuves
manquantes ou désaccord. Les décisions ne sont jamais propagées sans
couverture exacte de la clé.

## Critères de sortie R&D et passage aux E2E

1. Rejeu source 498 prouvé + tests adversariaux verts ;
2. Extraction de contrôle sur ~20 titres, puis extension bornée aux 498,
   avec taux de rejet réel et coût tokens mesuré ;
3. Revue aveugle indépendante, sans regarder les sorties V1/V2 ;
4. Nombre de types et familles réellement distincts, minutes humaines,
   précision parent/feuille et intervalle statistique par strate ;
5. Test hors fournisseur, propagation/rollback, et ensuite E2E réels.

Ne pas proclamer 90 % de couverture correcte, 95 % de précision ou
50 % de temps économisé avant cette comparaison. La V1 reste le
contrôle métier certifié en attendant.
