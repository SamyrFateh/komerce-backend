KOMERCE — ChatGPT : alignement sur l'état pré-E2E G6 (13/11). Mode ÉCO. HOLD maintenu.

Contexte à lire : issue #3927, commentaires 6839509826 (contrôle de cohérence d'Opus) et suivants, et PR draft #3944 (matrice commune v2, à jour du 13/11).

1. État acquis (ne pas refaire)
- Les lots L1 à L7, ainsi que #3951 (PDF du bon fournisseur), sont fusionnés.
- Le staging sert le `main` courant.
- Écarts de code en cours chez Opus/Sonnet, avec une PR par lot et une fusion groupée coordonnée par Opus :
  - W1 : dépense du wallet dans la devise du marché (XAF pour CM et CG, équivalent `*_kmf` via `currency_parities`) ;
  - W2 : garde de non-envoi WhatsApp Meta du panier partagé hors production ;
  - W3 : writer canonique et écran de **réception de stock local** au relais (`POST /api/markets/:code/local-stock/receipts`, seul le responsable pays du marché, admin compris refusé, justificatif, idempotent). Aucun writer HTTP ni UI n'existait jusqu'ici.
- Ne crée aucun stock local par script ni par SQL. Utilise le writer W3 une fois fusionné.

2. Nouvelles règles du propriétaire, à appliquer à ta cohorte
- **Le multi-sourcing est un critère de test obligatoire** de chaque E2E import (M01, M03, M04, M05) : au moins 3 sources distinctes dans la même commande (vrais fournisseurs distincts et/ou Fournisseur central Hub), une PO mono-marché par fournisseur, consolidation Hub. C01 et C02 seuls ne suffisent pas à certifier.
- **Le catalogue CM et CG se peuple par le vrai parcours** : sourcing → catalogue → prix `LOCAL_ACTIVE` décidé par le responsable pays → exposition `ENABLED` → stock local W3. Il comprend de **vrais produits fournisseurs** et **quelques produits manuels** du Fournisseur central Hub, sans aucune insertion directe. Minimum par marché : au moins 4 produits vendables chez au moins 3 sources, dont au moins 1 manuel. Visibilité publique requise : image https, unité vendable, revue visuelle FR, aucun blocage de vente.
- Opus peuple sa propre cohorte (marqueur `CLAUDE-PAR-20261113`, relais `CLAUDE-PAR Relais KM/CM/CG`, comptes `claude-par-*`). **Ta cohorte reste séparée** : tes comptes E2E, tes relais, tes produits et ton marqueur. Ne réutilise, ne modifie et n'expose aucun objet CLAUDE-PAR. Opus fera de même avec tes objets. Le catalogue fournisseur de base reste commun, en lecture seule.
- **Notifications** : les clients de test utilisent des numéros **hors** de `AUTHKEY_ALLOWED_PHONES` (la liste ne contient que de vrais numéros du propriétaire). Le panier partagé est exclu de la campagne tant que W2 n'est pas fusionné.

3. Ce que nous attendons de toi maintenant (lecture seule, pas d'exécution)
a. Revue croisée de la matrice #3944 : IDs, variantes, oracles, `catalog_prerequisites`, critère multi-sourcing. Corrige sur la même branche `docs/g6-matrix-v2`, sans PR concurrente, puis commente #3927.
b. Ton plan de cohorte : comptes, relais, produits et sources visés par marché, sans recouvrement avec CLAUDE-PAR.
c. Confirme que tu ne fusionnes rien et ne lances aucun run staging pendant la fusion de W1 à W3. Chaque fusion redéploie le staging.

4. Séquence commune
Fusion de W1 à W3 → peuplement des catalogues multi-sources (les deux cohortes, en parallèle et sans recouvrement) → passe #3900 en mode MANUAL → matrice #3944 validée et fusionnée → « GO tests métiers » explicite du propriétaire → E2E G6, suivis d'un comparatif par ID.

Règles : aucun test, workflow staging, fusion ni déploiement sans le GO explicite du propriétaire. `gh api` REST seulement. Aucun secret affiché.
