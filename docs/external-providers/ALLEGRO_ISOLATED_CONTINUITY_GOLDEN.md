# Golden de continuité — une offre Allegro Sandbox, isolation stricte

**Statut : procédure exécutable uniquement après secrets Sandbox dédiés et décision explicite de lancer le job manuel. Pas de preuve fournisseur live présumée à la création du workflow.**

## Portée exacte
Le workflow manuel `.github/workflows/allegro-isolated-continuity-golden.yml` (branche **main** seulement) crée un PostgreSQL 16 éphémère `komerce_sourcing_proof`, restaure le snapshot **schéma seul** et exécute les migrations/seed CI. Il n'accède à **aucune base Railway**, n'importe aucune donnée client et ne crée aucun service Railway. L'unique sortie métier externe est un appel **GET exact** à une offre du **vendeur Sandbox authentifié**, effectué deux fois. Le client OAuth renouvelle éventuellement son jeton et écrit sa version chiffrée **uniquement dans cette base éphémère** ; aucun achat, publication, annulation, paiement ou modification de l'offre fournisseur n'est lancé.

Le premier contrôle du script vérifie que la source fictive locale `api:allegro` avec **le même** `autopilot_enabled=false` empêche l'appel réseau. La source est ensuite mise à ON **uniquement dans la base CI jetable**, la première lecture réelle constitue une baseline V2 de candidat, et la seconde lecture exacte passe dans la sonde de continuité existante. Les champs de prix, devise, stock et état d'unité sont comparés ; seuls les faits observés sont affichés. Les données brutes fournisseur et les secrets ne sont pas journalisés. Il s'agit d'une preuve de connecteur, de comparaison et de contrôle de l'interrupteur **sur fixture isolée** ; elle ne prouve ni le toggle réel de production ni une surveillance cron en service.

## Préparation unique de sécurité

Dans **GitHub → dépôt → Settings → Secrets and variables → Actions**, configurer uniquement pour ce Golden les trois secrets nommés :

- `KOMERCE_ALLEGRO_PROOF_CLIENT_ID`
- `KOMERCE_ALLEGRO_PROOF_CLIENT_SECRET`
- `KOMERCE_ALLEGRO_PROOF_REFRESH_TOKEN`

Les trois valeurs doivent appartenir à une **application/compte vendeur Allegro Sandbox de preuve, distinct(e) du compte partagé avec Railway**. Ne jamais copier un refresh token de production, ni celui du compte Sandbox déjà utilisé par le sourcing Railway : l'authentification OAuth Allegro peut le **faire tourner dès la première lecture**, ce qui peut interrompre les autres intégrations. Le workflow utilise une clé AES temporaire aléatoire pour chiffrer le token rafraîchi dans sa seule base éphémère ; **après le job, le refresh token d'entrée peut être périmé et une nouvelle autorisation Sandbox sera nécessaire pour relancer**. Il n'est pas persistant dans GitHub Secrets. Aucun secret ne doit être envoyé dans un commentaire, un ticket, la console ou à l'assistant.

## Lancer manuellement

Après validation et merge de la PR, ouvrir **Actions → Allegro exact continuity Golden (manual staging only) → Run workflow**, choisir la branche `main`, renseigner un seul `offer_id` numérique d'une **offre du vendeur du compte dédié** et lancer. Si les secrets manquent, le job échoue **avant** l'appel fournisseur. Le job bloque les URL de base distante, le mode production et tout paramètre de recherche large ; il ne demande pas d'autorisation d'achat. Le bouton Sourcing ON/OFF global Komerce n'est jamais modifié.

Lire le résultat JSON final : `baseline_exact_read`, `second_exact_read`, `comparison` (`CHANGED` / `UNCHANGED` / `UNKNOWN`), modifications comparables par offre/unité, `stock_three_to_zero_proved` (true **uniquement** si un changement réel 3→0 a été observé). La présence de `UNCHANGED` prouve deux lectures exactes comparables, **pas** un changement de stock ou une réservation. Pour tester 3→0 en réel, faire évoluer explicitement le stock de **l'offre de test Sandbox dédiée** dans une séquence séparée, en respectant le contrat fournisseur ; aucun changement d'offre n'est lancé par ce workflow.

**Après preuve :** rapprocher les références Offer/Unit canoniques et la fraîcheur du catalogue réel en staging. Ne pas brancher ce job sur un cron ni activer une mise à jour du stock boutique à partir du seul résultat JSON. Le bouton métier reste unique : ON = découverte + continuité ; OFF = suspension de ces deux activités, indépendamment du traitement des commandes déjà engagées.
