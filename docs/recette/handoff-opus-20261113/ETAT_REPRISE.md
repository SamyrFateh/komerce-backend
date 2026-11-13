# Reprise Opus : certification pré-E2E G6 (état au 13/11/2026 à 10h40)

Point de départ pour tout agent qui reprend après une coupure. Fil de coordination : issue **#3927**. Matrice commune : PR draft **#3944**, branche `docs/g6-matrix-v2`.

## Décisions du propriétaire en vigueur
- **Double exécution indépendante** : GPT et Opus jouent les mêmes 46 scénarios, sur KM, CM et CG, avec le multi-sourcing CJ + AliExpress + Hub central, la même version applicative et les mêmes assertions. Les données sont distinctes : cohorte GPT-G6 d'un côté, CLAUDE-PAR de l'autre. Un PASS chez l'un et un FAIL chez l'autre est une ANOMALIE.
- **Validation** : Chromium + HTTP + PostgreSQL en lecture seule. **Aucun E2E G6 sans le « GO E2E » explicite du propriétaire, qui n'est pas encore donné.**
- **Stock local W3** : seul le responsable pays déclare et expose. Le stock est un pool par marché, avec le relais tracé dans l'audit.
- **Catalogue pays** : URL publiques `/KM`, `/CM` et `/CG` (#3980, fusionné).
- **Revue visuelle des images par agent** : `AUTOMATED_STAGING` seulement, jamais `HUMAN`. Les fiches FR sont rédigées par l'agent et saisies via `override`.
- **Arbitrages A1 à A8, A2-bis et A2-ter** : #3927, commentaire 6828953843.

## Cohorte CLAUDE-PAR (staging)
- **Comptes** : `claude-par-*` (KM et rôles globaux) et `claude-par-{cm,cg}-*`. Les identifiants sont chiffrés hors dépôt, dans le scratchpad Opus (`claude-par-keys/creds*.json`). Ils ne sont jamais committés. En cas de perte, il faut reprovisionner via les workflows de la branche `cert/claude-par-accounts`.
- **Relais** : `CLAUDE-PAR Relais KM`, `CLAUDE-PAR Relais CM`, `CLAUDE-PAR Relais CG`.
- **Catalogue** (#3927, commentaires 6846833004, 6848752785 et 6848772663) :

| Produit | Source | Mode |
|---|---|---|
| KPR-000144 | CJ | import |
| KPR-000164 | AliExpress | import |
| KPR-000163 | Hub central, manuel | import |
| KPR-000124 | AliExpress | stock local (6) |
| KPR-000162 | Hub central, manuel | stock local (5) |

  KPR-000141 est désactivé.
- **Marqueurs** : `CLAUDE-PAR-20261111` et `CLAUDE-PAR-20261113`.

## Lots de code
| Lot | PR | État |
|---|---|---|
| L1 à L7, #3951, W1 à W3 | fusionnés | sur le staging |
| R1 : code de retrait régénérable par le client | branche `fix/3900-R1` | preflight en cours, pas encore poussé |
| R2 : anti-bruteforce par agent et relais | #3985 | draft, preflight vert |
| R3 : preuve de retrait dans « Mon Komerce » | #3984 | draft, preflight vert |
| R4 : interrupteur « Saisie manuelle » à la réception Hub | #3981 | Required vert |
| R5 : total à 0 KMF et récap des produits manuels | #3982 | Required vert |
| R6 : file « Encaisser » et réception relais supérieure à l'expédié | #3983 | à revérifier |

**Fusion groupée** : une fois tout vert, fusionner R1 à R6 quand aucun run `staging`, `chromium` ou `g6` n'est actif. `main` bouge souvent : utiliser `scripts/merge-w3.sh` comme modèle de boucle (update-branch, régénération des projections en conflit, merge, contrôle `merged=true`).

## Défauts consignés, non corrigés
- **Catalogue** (#3927) :
  - D1 : `import-now` CJ répond 500 alors que l'import réussit ;
  - D2 : `option_values` null contre `{}` ;
  - D3 : un produit reste invisible sans `product_suppliers` ;
  - D4 : aucun marqueur sur les candidats ;
  - D5 : import manuel sans `stock_available`, et le réimport repasse en WATCH ;
  - D6 : plafond de 120 produits actifs ;
  - D7 : revue visuelle impossible en WATCH, avec doublons à la promotion ;
  - D8 : la réactivation exige un `price_kmf` global supérieur à 0.
- **Passe #3900** (#3900, commentaire 6848393664) : D4, le dossier douane qui présélectionne les colis du marché, est déjà corrigé par #3887 et doit être revérifié.

## Prochaines étapes
1. R1 poussé, puis fusion groupée de R1 à R6. Relire `/health/version` après déploiement.
2. **Seconde passe #3900**, brief `briefs/BRIEF_3900_PASSE_MANUELLE.md`, limitée aux points ouverts :
   - réception Hub en MANUAL (R4) ;
   - code régénéré par le client (R1) ;
   - 429 après 5 échecs (R2) ;
   - preuve de retrait client (R3) ;
   - retrait partiel multi-colis ;
   - timeout après commit et panne réseau ;
   - commande import à 3 sources (KPR-000144 + 000164 + 000163) ;
   - revérification de KC692IV (récap des produits manuels, « Encaisser »).
3. Si tout est PASS : demander au propriétaire le **GO E2E G6**, puis jouer les 46 scénarios sur KM, puis CM et CG. Les fixtures de cas limites à prévoir : prix inactif, exposition coupée, stock à 0, produit à au moins 2 variantes.

## Contenu de ce dossier
- `briefs/` : tous les briefs Opus et Sonnet, et les plans.
- `scripts/` : helpers Chromium (`parcours-km`, `catalogue-ms`, `par3900`), boucles de fusion, consigne d’alignement GPT (`scripts/ALIGNEMENT_GPT_E2E.md`). Aucun secret ; les scripts lisent les identifiants depuis le scratchpad local.
