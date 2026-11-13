# Brief Sonnet ÉCO : seconde passe #3900, KM (GO du propriétaire)

Base : `/home/claude/BRIEF_3900_PASSE_MANUELLE.md`, avec les mêmes règles, comptes, garde-fous et rendu. Passe 1 : #3900, commentaire 6848393664. Cette seconde passe ne couvre **que** les points restés ouverts.

## Pré-condition, à vérifier avant de commencer
Les PR #3981 à #3986 (R1 à R6) doivent être **fusionnées** : `gh api repos/SamyrFateh/komerce-backend/pulls/3986 --jq .merged` vaut `true`. Le staging (`/health/version`) doit servir le SHA de `main` qui contient #3986. Tant que ce n'est pas le cas, attends (relis toutes les 5 minutes, au plus 90 minutes), puis rapporte.

## Boutique
URL par pays : `/KM`, `/CM`, `/CG` (#3980). Le client part de `/KM`. Il a un numéro fictif hors allowlist ; l'OTP de test est `424242`.

## Points à prouver (Chromium, HTTP et PostgreSQL en lecture seule)
1. **Commande import à 3 sources** : KPR-000144 (CJ), KPR-000164 (AliExpress) et KPR-000163 (Hub central manuel). Attendus : 3 PO mono-fournisseur, et pour la PO `central_hub`, le vendeur réel et le justificatif.
2. **R4, réception fournisseur Hub** : avec l'interrupteur « Saisie manuelle » activé et une justification, la provenance stockée est `MANUAL`/`manual_confirmation`. L'interrupteur désactivé donne `SCAN`.
3. Sac, KOM-BOX, transitaire, transit et douane en MANUAL, comme dans la passe 1 ; une vérification rapide suffit.
4. **R6, réception relais** : une quantité supérieure à l'expédié est refusée à l'écran et côté serveur (409 `RELAY_RECEIPT_EXCEEDS_SHIPPED`).
5. **R1, code de retrait côté client** : dans « Mon Komerce », le client clique sur « générer un nouveau code ». L'ancien code est refusé, le nouveau est accepté au retrait. Le quota de 5 générations par 24 h donne 429. Un autre client reçoit 403.
6. **R2, anti-bruteforce** : à faire sur une **seconde** commande ou un colis dédié. 5 codes inconnus en 15 minutes donnent 429 pour l'agent, même avec le bon code ensuite. Un autre agent du relais n'est pas bloqué, s'il en existe un dans la cohorte ; sinon, NOT_PROVEN motivé. Vérifie aussi l'alerte de sécurité.
7. **R3, preuve de retrait** : elle est visible et téléchargeable dans « Mon Komerce ». Un autre client reçoit 404.
8. **Retrait partiel multi-colis** : retrait d'un colis, puis rotation du secret, puis retrait du second.
9. **Timeout après commit** (`route.fetch()` puis `route.abort()`) sur la remise : le rejeu se réconcilie sans double retrait et sans faux succès. **Panne réseau** sur un geste Hub : même méthode.
10. **R5** : « Mon Komerce » affiche le bon total (non nul), et le récapitulatif du checkout montre le nom et l'image des produits manuels, sur la nouvelle commande comme sur **KC692IV**.
11. **R6, encaissement** : relais live n'affiche plus « Encaisser » pour une commande déjà encaissée (KC692IV).
12. **SAV après remise** (L6), si le budget le permet : retour au relais, compensation wallet en KMF décidée par l'admin, reçu wallet.

## Rendu
Commente #3900 avec la matrice complète, passe 1 et passe 2 fusionnées. Ne **clôture** #3900 que si tout est PASS sur preuves réelles. Mets à jour la section « Prochaines étapes » de `docs/recette/handoff-opus-20261113/ETAT_REPRISE.md` sur la branche `handoff/opus-pre-e2e-20261113` (worktree `/home/claude/wt-handoff`), puis pousse. Budget : 150 minutes. Rapport final court.
