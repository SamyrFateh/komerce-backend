# Doctrine — Onboarding des fournisseurs externes

Date: 2026-10-01  
Status: **CANONICAL**

## 1. Phrase de vérité

> **Étudier → Décrire → Connecter → Prouver → Certifier → Activer.**

Un opérateur ne doit jamais deviner quel secret demander à un partenaire. Komerce ne doit jamais découvrir les prérequis élémentaires d'un fournisseur pendant un Golden E2E.

La vérité amont est le contrat réel du fournisseur : documentation officielle, confirmation explicite du fournisseur ou preuve runtime bornée. L'IA peut accélérer la lecture, la synthèse et la formalisation ; elle n'est jamais l'autorité du contrat.

## 2. Chaîne canonique

```text
Documentation / confirmation fournisseur
              ↓
Étude API externe
              ↓
External Provider Contract
Conversation + KNOWN/DERIVED/UNKNOWN + P0..P4
              ↓
Human Onboarding Contract
prérequis + où/quoi créer + quoi obtenir + quoi ne pas demander
              ↓
Adapter / connecteur provider-specific
              ↓
Credential Authority ou OAuth
              ↓
Test réel de connexion
              ↓
Premier passage réel
              ↓
Certification runtime
              ↓
Activation opérateur explicite
```

Les deux premières étapes sont normalement réalisables **sans credential du partenaire**. Une documentation privée peut imposer un compte développeur ou un accès fournisseur, mais ce cas doit être déclaré comme prérequis d'étude ; il ne justifie jamais une collecte aveugle de secrets.

## 3. Deux cycles distincts

### Provider / intégration

Répond à : « savons-nous comment intégrer ce fournisseur ? »

```text
À ÉTUDIER
→ CONTRAT DÉFINI
→ CONNECTEUR À RÉALISER
→ CONNECTEUR PRÊT
```

L'étude d'une API est faite une fois par contrat provider/environnement pertinent. Elle n'est pas répétée pour chaque compte partenaire.

### Source / compte connecté

Répond à : « ce compte fournisseur précis est-il exploitable par Komerce ? »

```text
À CONFIGURER
→ CONNEXION À TESTER
→ À CERTIFIER
→ PRÊTE
→ ACTIVE
```

Une nouvelle source ne transforme jamais la documentation du provider en vérité runtime. Le test de connexion puis le premier passage réel apportent les preuves du compte réellement configuré.

## 4. Human Onboarding Contract

Le registre transverse `governance/external-provider-registry.json` est l'autorité de cette projection.

Un contrat d'onboarding défini contient au minimum :

```text
status
authority
evidence_url
credential_owner
prerequisites[]
setup_steps[]
operator_must_obtain[]
operator_must_not_request[]
completion
```

### authority

Valeurs autorisées :

- `provider_documentation` — documentation officielle du fournisseur ;
- `provider_confirmation` — confirmation explicite fournisseur/partenaire conservée comme preuve.

Une inférence IA seule n'est jamais une valeur d'autorité.

### credential_owner

Décrit **qui possède l'identité technique**, pas qui tape le formulaire :

- `partner_account`
- `integration_application`
- `komerce_platform_application`
- `provider_managed`
- `none`

Cette distinction empêche notamment de demander au partenaire un secret d'infrastructure Komerce.

## 5. Invariants d'onboarding

1. Un connecteur automatisable ne peut pas être proposé à la création si son contrat d'onboarding n'est pas défini.
2. Pour une auth source `api_key` ou `client_credentials`, les clés de `operator_must_obtain` doivent correspondre exactement aux champs du contrat auth public.
3. Pour OAuth, l'opérateur ne saisit pas de token utilisateur : le partenaire autorise l'application et Komerce gère la session côté serveur.
4. `operator_must_not_request` interdit explicitement les secrets inutiles ou dangereux à collecter.
5. Aucun secret, token, valeur credential ou nom de variable d'environnement n'est exposé dans le contrat public.
6. La présence du contrat d'onboarding ne vaut pas connexion, P1, certification runtime ni activation.
7. Une modification du modèle d'authentification fournisseur déclenche une requalification du contrat d'onboarding.
8. Un fournisseur « Autre » reste **À ÉTUDIER / CONNECTEUR REQUIS** : aucun secret ne doit être demandé tant que son contrat n'existe pas.

## 6. Rôle de l'IA

L'IA est un accélérateur de travail :

```text
lire la documentation
→ relever auth / scopes / endpoints / limites
→ proposer le contrat
→ pointer les zones UNKNOWN
→ aider à écrire l'adapter et les tests
```

Mais la promotion vers un contrat Komerce exige une provenance provider. Une affirmation non sourcée reste UNKNOWN.

## 7. Articulation avec les preuves provider

Cette doctrine complète, sans la remplacer :

`docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md`

Le contrat d'onboarding répond à la question humaine « que dois-je préparer ou demander ? ». Les preuves P0..P4 répondent à la question technique « qu'avons-nous réellement établi et jusqu'où ? ».

## 8. Definition of Done d'un nouveau fournisseur automatisable

Avant que « Ajouter » soit proposé dans Sources :

- le provider est inscrit dans l'inventaire externe ;
- son contrat réel a été étudié suffisamment pour l'opération visée ;
- l'authentification et son propriétaire sont définis ;
- l'onboarding humain est défini avec provenance fournisseur ;
- les champs demandés correspondent exactement au contrat auth ;
- le connecteur sait effectuer un test de connexion sûr ;
- les capacités non prouvées restent explicitement fermées.

Ensuite seulement viennent les credentials/OAuth du compte, le test réel, le premier passage, la certification et l'activation.
