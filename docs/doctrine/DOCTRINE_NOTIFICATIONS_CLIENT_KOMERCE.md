# Doctrine des notifications client Komerce

> **Version** : 2026-08 — information essentielle dans l'application, canal WhatsApp utilitaire strictement borné.

## Principe

Une notification client n'est ni un journal d'activité, ni une copie de chaque changement de statut.

Elle signale une information qui demande une action ou dont l'absence ferait perdre quelque chose au client. La vérité détaillée reste dans la feature concernée, notamment l'onglet Commandes.

## Jalons de commande autorisés

```text
orders.status -> preparation  => « Votre commande est en préparation »
orders.status -> shipped      => « Votre commande a été expédiée »
orders.status -> available    => « Votre colis est disponible »
```

Chaque jalon n'est créé qu'une fois. Le jalon suivant résout automatiquement le précédent s'il n'a pas encore été acquitté. `in_transit` prolonge le message « expédiée » sans créer un quatrième message.

Les statuts reçu, confirmé et commandé ne créent pas de notification in-app. Ils restent visibles dans le suivi de commande.

`preparation` et `shipped` sont importants mais informatifs. `available` est urgent : la commande reste mise en évidence jusqu'au retrait.

## Événements exceptionnels

Le moteur accepte le contrat `order.exception.*`, mais aucun déclencheur générique n'est inventé. Chaque exception doit être branchée depuis une vérité métier confirmée et fournir :

- un titre compréhensible ;
- l'information strictement nécessaire ;
- l'action attendue dans l'onglet Commandes ;
- une clé idempotente stable.

Une exception sans action ou simple détail technique ne devient pas une notification client.

## Invariants

- Une notification est créée uniquement après un événement métier confirmé.
- L'émission est idempotente par utilisateur, événement et entité.
- La lecture et l'acquittement exigent une session et filtrent le propriétaire.
- Acquitter masque le bandeau mais ne modifie jamais le statut de la commande.
- Une commande `available` reste mise en évidence jusqu'au retrait, même si le bandeau est acquitté.
- Le retrait, l'annulation ou le remboursement résout les jalons de commande encore ouverts.
- Une émission manquée est réconciliée depuis la vérité du statut commande à la prochaine lecture authentifiée.
- L'absence de session masque silencieusement le bandeau et ne déclenche pas un parcours OTP.
- Sans notification réelle, aucun conteneur de bandeau n'est monté et le header conserve sa géométrie canonique.
- Avec un message réel, le bandeau flotte sous la navigation sur desktop comme mobile sans réserver d'espace dans le header ou le hero ; il disparaît après acquittement.
- L'application visible rafraîchit au plus une fois par minute ; ce polling ne crée aucun nouvel événement.
- Aucun document ni lien documentaire n'est envoyé par WhatsApp.
- Le message WhatsApp existant « colis disponible » peut contenir un unique lien cartographique calculé depuis le nom et l'adresse publics du relais. Ce lien n'ajoute aucun message, ne révèle aucune donnée client et ne bloque jamais la transition métier.
- Les animations respectent `prefers-reduced-motion`.

## Hors périmètre

- remplacement ou contournement de l'OTP ;
- push navigateur ou natif ;
- nouvelle campagne email, SMS ou WhatsApp, et toute duplication du jalon « disponible » ;
- centre bavard listant tous les mouvements ;
- compteur artificiel destiné à augmenter l'engagement.

L'OTP reste un sujet d'authentification séparé. Une évolution ultérieure pourra réduire sa fréquence par session durable ou passkey, sans affaiblir la preuve d'identité.
