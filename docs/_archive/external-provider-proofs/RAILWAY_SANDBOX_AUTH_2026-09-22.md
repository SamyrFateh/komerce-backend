# Preuve opérateur — PayPal et MTN MoMo, authentification Sandbox depuis Railway

**Date d'exécution déclarée par le rapport :** 2026-09-22T19:43:04.112Z (21:43:04, Europe/Paris).  
**Source :** sortie JSON expurgée de la sonde `komerce-preuve-railway-sandbox-v3`, lancée par l'opérateur via `railway ssh` dans le service `komerce-backend` de son environnement Railway nommé `production`. Les credentials PayPal et MTN préexistants y sont déclarés par l'opérateur comme étant ceux de leurs **Sandbox** respectives ; le nom de l'environnement Railway ne qualifie pas l'environnement externe.  
**Chaîne de conservation :** la sortie JSON a été copiée dans la conversation par l'opérateur, puis transcrite ici dans GitHub. Ni fichier de preuve signé, ni archive brute, ni journaux fournisseurs n'ont été déposés dans ce commit. Les lignes exactes du terminal ont été rapportées par l'opérateur ; leur résultat externe n'a pas été revérifié indépendamment par l'auteur de cette fiche.

## Résultat expurgé transmis par l'opérateur

```json
{
  "schema_version": 1,
  "scope": "existing_railway_variables_sandbox_authentication_only",
  "generated_at": "2026-09-22T19:43:04.112Z",
  "summary": {
    "total": 2,
    "pass": 2,
    "blocked": 0
  },
  "providers": [
    {
      "provider": "paypal",
      "environment": "SANDBOX",
      "status": "PASS",
      "reason_code": "PAYPAL_SANDBOX_OAUTH_AND_WEBHOOK_GET_PROVED"
    },
    {
      "provider": "mtn-momo-cg",
      "environment": "SANDBOX",
      "status": "PASS",
      "reason_code": "MTN_SANDBOX_COLLECTION_OAUTH_PROVED"
    }
  ]
}
```

## Qualification rigoureusement bornée

| Fournisseur / opération | Observation déclarée | Niveau opérationnel correspondant | Non démontré |
|---|---|---|---|
| PayPal Sandbox — `PAYPAL_SANDBOX_OAUTH_AND_WEBHOOK_GET_PROVED` | Le script signale authentification OAuth acceptée et lecture du webhook configuré réussie. | Contrôle P0/P1 **sur cette opération uniquement**, selon le rapport opérateur. | Livraison/réception d'un événement webhook, création et capture de paiement, remboursement, adapter métier, réconciliation, production. |
| MTN Collections Sandbox — `MTN_SANDBOX_COLLECTION_OAUTH_PROVED` | Le script signale obtention d'un jeton Collections Sandbox. | Contrôle P0/P1 **sur l'authentification uniquement**, selon le rapport opérateur. | `RequestToPay`, état de transaction, callback, montant et devise, approbation wallet, encaissement, adapter métier, production. |

Aucun identifiant, jeton, numéro de téléphone, contenu webhook ou réponse brute de fournisseur n'est reproduit. Les deux `PASS` de cette **exécution Railway** ne modifient pas rétroactivement le rapport de la [campagne GitHub Actions 35753825169](https://github.com/SamyrFateh/komerce-backend/actions/runs/35753825169), dont les variables de preuve distinctes n'étaient pas disponibles et dont le bilan était `0 PASS`. Il n'y a ni achat ni paiement dans l'opération décrite.

**Règle d'exploitation :** ne pas extrapoler ce constat à `provider.highest_proof=P1` global, à une preuve actuelle de validité des credentials, ni à une autorisation de déclencher des paiements. La qualification doit rester attachée à l'opération, à l'environnement, à l'heure et à la provenance. Une future preuve de transaction exige ses propres contrôles de prérequis, une confirmation distincte de l'acceptation et un nouveau rapport expurgé.

## Prochain contrat à caractériser

1. PayPal : documenter le contrat réel de livraison / vérification de webhook et le read-back de statut de commande **avant** tout test de création/capture.
2. MTN : documenter le contrat complet `RequestToPay` Sandbox (préconditions, identifiant externe, code d'acceptation 202, interrogation d'état, montant/devise de transport, callback et idempotence) **avant** toute initiation de transaction de test.
3. Ne lancer aucun Golden E2E de paiement sur le simple fondement de ces résultats d'authentification.
