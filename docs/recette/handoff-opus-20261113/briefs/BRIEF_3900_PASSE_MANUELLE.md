# Brief Sonnet ÉCO : passe de certification #3900 en mode MANUAL, KM (GO du propriétaire, étapes 1 à 3)

Base : `/home/claude/BRIEF_SONNET_P0_3900.md`. Lis les §1 (coexistence), §2 (méthode), §3 (P0-1, remise sans scanner), §4 (P0-2, mode manuel sur la chaîne) et §7. Le présent brief les **actualise**.

## Ce qui change depuis ce brief
- **Code à jour**, rien à coder. Sur le staging (vérifie `/health/version` au début et à la fin) sont fusionnés : #3902 (code de retrait de 8 caractères), #3923 (provenance SCAN/MANUAL), L1 (verrouillage après 3 mauvais codes, 15 minutes), L2 (une preuve de retrait par remise, ancrée sur `scans.id`), W3 (stock local).
- **Commande neuve Claude en KM, multi-sources** (critère du propriétaire) :
  - au moins 3 sources dans la même commande, prises parmi KPR-000144 ou KPR-000141 (CJ), KPR-000124 (AliExpress) et KPR-000162 ou KPR-000163 (manuels, Fournisseur central Hub) ;
  - cela donne une PO par fournisseur, dont une PO manuelle `central_hub` avec justificatif et vendeur réel structuré (L5), puis la consolidation au Hub.
- **Client** : un compte client neuf, avec un numéro de téléphone **fictif hors allowlist** (zéro envoi réel), créé par le parcours boutique réel.
- **Comptes et relais** : `…/scratchpad/claude-par-keys/creds.json` (rôles KM et globaux) ; relais `CLAUDE-PAR Relais KM`. Marqueur `CLAUDE-PAR-20261113`.
- **Chaque geste physique se fait en MANUAL dans l'UI**, avec une justification :
  - réception fournisseur au Hub ;
  - sac ;
  - sac → KOM-BOX ;
  - remise au transitaire, transit et douane ;
  - réception au relais ;
  - remise au client par le code de 8 caractères.

  La provenance stockée est ensuite relue (`MANUAL`/`manual_confirmation`, jamais `SCAN`) par un workflow PostgreSQL **en lecture seule** sur ta branche, sur le modèle de `economic-engine-staging-readonly-census.yml`.
- **Cas de refus du §3** à prouver, dont le verrouillage L1 : 3 mauvais codes → 429, puis le bon code refusé pendant 15 minutes. Fais ce test sur une **seconde** commande, ou en dernier sur un colis restant, pour ne pas bloquer la remise principale.
- **Preuve documentaire L2** : une preuve de retrait par colis remis, visible par le client dans « Mon Komerce ».
- **Retour et SAV après remise** : reprise au relais, puis décision de compensation wallet en KMF par l'admin (L6), puis reçu wallet. Montre-le si le temps le permet ; sinon, note-le comme reste à faire.

## Interdits et limites
- **Pas d'E2E G6 au-delà de cette passe** : le GO du propriétaire couvre les étapes 1 à 3 seulement.
- Aucune fusion, aucun code applicatif. Un défaut nouveau donne lieu à un rapport à Opus avec sa cause exacte, sans correctif.
- Ne touche à aucun objet qui n'est pas CLAUDE-PAR. GPT fusionne souvent, ce qui redéploie le staging : relis `/health/version` et reprends seulement le geste interrompu.
- Budget : 150 minutes.
- Pousse au fil de l'eau sur `cert/claude-par-3900`.
- Ne lis ni n'affiche aucun secret. `gh api` REST seulement. N'écris jamais `@nom` en clair.

## Rendu
- Commente #3900 avec la matrice `Étape | Manuel (UI) | HTTP | PostgreSQL | Chromium | Verdict`, plus la commande, les PO, le SHA, les liens de runs et d'artefacts, et les vidéos.
- Ne clôture #3900 que si **tout** est PASS sur preuves réelles.
- Rapport final court à Opus.
- Commentaires terminés par :
  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  https://claude.ai/code/session_01SwgRpiat6KjVtGnaB4GKZi
