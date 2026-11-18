# G6 — Passage au moteur dynamique : contrat d'intégration et critères GO

**Statut : NOT_PROVEN — staging uniquement.** Ce lot crée le séquenceur exécutable `scripts/recette/canonical/dynamic-runner.js`, **sans connecter** de nouvelles identités Chromium, une base PostgreSQL ni les artefacts réels. Aucun succès E2E réel ne peut être déduit de ses tests unitaires.

## Contrat

`executeBoundJourney({fromStage,toStage,context,checkpoints,adapters})` utilise le registre des **15** étapes et `planBoundResume`. Les paramètres de contexte lient une **nouvelle commande M01 KM** à son `order_id`, à sa référence, à son `staging_sha` et à son empreinte PostgreSQL. L'ancien ordre `KL1WGP6` et ses numéros de runs ne sont ni fixtures ni valeurs par défaut de ce moteur.

Cinq adaptateurs **obligatoires**, à développer et connecter au workflow owner-only : `attestRuntime`, `authenticateCheckpoint`, `executeStage`, `verifyStageProof`, `persistEvidence`. Leur code doit provenir du dépôt et de l'environnement GitHub Actions autorisé ; **ne jamais charger une fonction depuis un artefact téléchargé, une issue, une commande ou une réponse HTTP**. Les deux attestations doivent utiliser des observations indépendantes de PostgreSQL et Chromium. `persistEvidence` doit écrire atomiquement la preuve avec son SHA-256 et confirmer son stockage avant l'étape suivante.

`executeStage` devra réutiliser **les vrais écrans Chromium** pour chaque rôle, sans API de remplacement des gestes métier. Les secrets doivent rester dans GitHub Actions ; aucun fournisseur externe, PSP réel ou production n'est autorisé.

## Prérequis bloquants avant une nouvelle exécution M01

1. Retirer les `run_id`, UUID, références d'expédition et `KL1WGP6` figés **des adaptateurs legacy**. Ils sont conservés pour l'intégrité des preuves historiques, mais **ne doivent jamais être invoqués pour la nouvelle commande**.
2. Connecter les cinq adaptateurs du nouveau runner au **workflow owner-only**, avec contrôles stricts `GITHUB_ACTOR`, SHA déployé Railway, identité PostgreSQL, cohorte staging et sessions Chromium par rôle.
3. Faire attester chaque checkpoint de reprise depuis **un artefact GitHub Actions exact** (run ID + artifact ID + digest contrôlé) et un readback PostgreSQL/Chromium correspondant. Le `planBoundResume` est seulement un contrôle structurel, jamais une attestation indépendante.
4. Émettre pour chaque stage : preuve Chromium, capture sans données personnelles, oracle PostgreSQL, résultat de l'étape, empreinte SHA-256, références de commande et d'expédition, propriétaire du rôle.
5. Faire traverser **une commande fraîche** du client au retrait avec les 15 étapes, sans jamais réutiliser l'ordre historique. Le verdict reste `NOT_PROVEN` jusqu'à une **certification indépendante finale**.
6. Ensuite seulement : revue d'Opus, correction des écarts et décision GO. **Ne pas exécuter la campagne des 46 scénarios avant le GO explicite du propriétaire.**

## Sécurité

Le nouveau moteur refuse les adaptateurs absents, les identités étrangères, le contexte production, les checkpoints manquants, les attestations non indépendantes, les effets de paiement/fournisseur externe et les preuves qui ne sont pas durablement enregistrées. Le registre de 15 étapes, les validateurs de provenance et le runner historique sont conservés. Cette PR ne permet aucun accès staging à elle seule.

**À ne pas confondre :** `15/15 contrats disponibles` ≠ `15/15 étapes certifiées sur une nouvelle commande`.
