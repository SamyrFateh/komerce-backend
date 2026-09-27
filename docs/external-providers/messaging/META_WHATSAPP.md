# Meta WhatsApp Cloud API — fiche de caractérisation initiale

## Périmètre et source officielle

- Provider : `meta-whatsapp`; consommateurs : notifications et auth-identity.
- Contrat externe documenté : Meta WhatsApp Cloud API, requête officielle **Get Phone Number By ID**, GET `https://graph.facebook.com/{Version}/{Phone-Number-ID}` avec Bearer token, renvoyant notamment `id` et `verified_name` : https://www.postman.com/meta/whatsapp-business-platform/request/li0unxe/get-phone-number-by-id .
- Code métier Komerce actuel : `services/whatsapp-meta.js` (envoi de template par POST `/messages` avec `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID` et version Graph par défaut `v23.0`).
- La campagne de preuve ne réutilise **ni le token ni le numéro du runtime** : secrets GitHub séparés `KOMERCE_META_PROOF_READ_TOKEN` et `KOMERCE_META_PROOF_PHONE_NUMBER_ID`.
- Compte/profil : l'environnement réel du compte ciblé par la clé de preuve. Il ne s'agit **pas d'une Sandbox démontrée**.

## Conversation exacte : lecture de métadonnées du numéro

| Phase | Contrat |
|---|---|
| EXPECTS | Confirmer que le compte autorisé expose la métadonnée d'**un seul numéro WhatsApp identifié**. |
| REQUIRES | Consentement manuel `allow_meta_account_read=true`, token de lecture distinct, ID numérique exact, version Graph valide, autorisations réelles du compte à vérifier. |
| SENDS | Un unique GET `/{version}/{phone_id}?fields=id,verified_name` en HTTPS avec Bearer token. |
| RECEIVES | Réponse HTTP 200 avec `id` exact et `verified_name` non vide. |
| CONFIRMS | Concordance stricte de l'ID retourné avec l'ID demandé ; jamais un succès sur le seul HTTP 200. |
| EXPOSES | Seulement `operation`, `environment=LIVE_ACCOUNT_READ_ONLY`, statut et codes bornés P0/P1 ; aucune donnée de compte, numéro ou nom dans le JSON de preuve. |

## État de preuve et limites

- **DOC ONLY pour cette opération** tant qu'aucune exécution réelle de la sonde sur un compte dédié n'est documentée. L'inventaire `governance/external-provider-registry.json` conserve `highest_proof=UNQUALIFIED` : un test hors réseau ne promeut pas la qualification fournisseur.
- Un PASS ultérieur prouverait uniquement **l'accès à la métadonnée exacte du numéro et les droits de lecture** sur le compte et la version testés.
- Il ne prouverait **ni l'enregistrement effectif du numéro, ni le droit d'envoyer des messages, ni l'OTP, ni l'acceptation du template, ni la réception/livraison/lecture du message, ni la configuration du webhook**.
- Si permission, identifiant, version, contenu exact ou consentement manque, le résultat est BLOCKED et l'API n'est pas appelée en l'absence de consentement.
- Aucun POST `/messages`, aucun SMS/WhatsApp sortant, aucun client destinataire, aucune opération DB et aucune donnée de production modifiée.

## Exécution manuelle

Après fusion du workflow GitHub Actions `external-provider-contract-batch.yml` sur `main`, prévoir un credential de lecture distinct et, **uniquement si l'opérateur autorise la consultation de ce compte réel**, choisir `mode=sandbox-read` (nom historique du mode de campagne), `providers=meta-whatsapp`, `allow_meta_account_read=true`. L'option est `false` par défaut ; aucune sonde Meta n'est déclenchée automatiquement par une PR, un cron ou la tâche de suivi.

Une preuve positive n'élève pas la qualification des opérations d'envoi et de réception ; celles-ci réclament leurs contrats et leurs preuves propres.
