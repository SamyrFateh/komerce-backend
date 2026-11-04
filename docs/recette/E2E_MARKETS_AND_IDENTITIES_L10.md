# L10 — Matrice de certification E2E des marchés et comptes (03/11/2026)

> Préparation de scénarios, **pas** preuve d'activation ou création de comptes.
> Les commandes, comptes, habilitations et opérations doivent être créés via les API canoniques uniquement.
> Aucune donnée transactionnelle injectée en SQL. Aucun secret de test versionné.

| Marché | Devise | Parcours obligatoires | Points discriminants / vérifications |
|---|---|---|---|
| KM | KMF | Import, achat manuel Hub, partiel, local, mixte, cash relais, remboursement | Routage îles, hub central, preuve physique, remises et garde cash |
| CM | XAF | Import complet, partiel, paiement autorisé, responsable marché | Contrôles de marché et prix, isolation stricte vis-à-vis de CG malgré la même devise |
| CG | XAF | Import complet, partiel, paiement autorisé, responsable marché | Absence de mélange catalogue, PO, flux et soldes avec CM |
| DJ | DJF | Activation canonique, publication, import, paiement autorisé, livraison, journal | PROVISIONING → ACTIVE seulement après readiness ; parité EUR, transporteur, relais et provider configurés |
| YT | EUR | Commande import et circuit spécifique, prix, livraison et journal | Régime de douane / transport à vérifier dans les règles configurées ; EUR natif, pas de conversion inventée |

## Identités nécessaires pour Chromium

- `admin` : gouvernance des cinq marchés, provisioning DJ et affectations ; vérifier le refus pour les autres profils.
- `agent_hub` : achats et logistique de tous les marchés, sans délégations commerciales par marché.
- `market_operator` : un compte limité à KM, un compte multimarche CM+CG, et un compte limité à YT et/ou DJ après activation ; vérifier refus hors scope et séparation CM/CG.
- `agent_relais` : relais KM-A autorisé ; relais KM-B et relais autre marché pour les refus 403.
- `agent_transitaire` : transitions physiques strictement limitées aux routes et états autorisés.
- `finance` : lectures/journal contrôlés, aucune autorité implicite sur le cash physique.

Ces identités doivent être créées/activées par le mécanisme d'invitation canonique. Les jetons à usage unique et les mots de passe ne doivent jamais figurer dans les commits, PR, logs ni captures.

## DJ — activation uniquement par API canonique

1. Vérifier l'identité Staging via `scripts/recette/target-guard.js`.
2. Examiner `GET /api/admin/markets/DJ/control-plane` avec un compte admin.
3. Corriger chaque gap par les writers existants (référent central, mandat/équipe, plafonds, parité, provider, politique cash, relais, attestation de livrabilité).
4. Exiger `readiness.ready_for_activation === true`.
5. Seulement ensuite, utiliser `POST /api/admin/markets/DJ/lifecycle` avec `{"status":"ACTIVE"}`.
6. Relire le control-plane et prouver `market.lifecycle_status === ACTIVE`, `market.is_active === true`, puis les permissions et la boutique.

Runner : `scripts/recette/dj-canonical-activation.js` est **read-only par défaut**.
Il exige un administrateur authentifié, le fingerprint Staging et deux validations explicites (`--apply` et `KOMERCE_DJ_ACTIVATE=1`) pour déclencher la route existante.
Il ne crée ni readiness fictive ni modification directe de `markets`.

## Gate de certification

Pour chaque marché : produit source → publication → commande client → paiement sandbox/cash autorisé → besoin d'achat → PO → Hub → transitaire/douane → relais → remise → journal Finance/Comptabilité.
Les scénarios LOCAL_STOCK ne traversent jamais fictivement Hub ou douane.
Une même devise (CM/CG) n'autorise aucune fuite inter-marchés.
Le circuit de Mayotte doit être contrôlé sur ses règles réelles, sans supposer qu'il reproduit KM.
Toute dépendance absente reste BLOCKED, jamais PASS.
