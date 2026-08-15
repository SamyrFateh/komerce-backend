# Doctrine des notifications client Komerce

> **Version** : 2026-08 — information essentielle dans l'application, sans transport WhatsApp métier.

## Principe

Une notification client n'est ni un journal d'activité, ni une copie de chaque changement de statut.

Elle signale une information qui demande une action ou dont l'absence ferait perdre quelque chose au client. La vérité détaillée reste dans la feature concernée, notamment l'onglet Commandes.

## Premier événement autorisé

```text
orders.status -> available
  => « Votre colis est disponible »
  => action « Voir la commande »
  => acquittement explicite « J'ai compris »
```

Les statuts reçu, confirmé, préparation, expédié et en transit ne créent pas de notification in-app dans ce premier périmètre. Ils restent visibles dans le suivi de commande.

## Invariants

- Une notification est créée uniquement après un événement métier confirmé.
- L'émission est idempotente par utilisateur, événement et entité.
- La lecture et l'acquittement exigent une session et filtrent le propriétaire.
- Acquitter masque le bandeau mais ne modifie jamais le statut de la commande.
- Une commande `available` reste mise en évidence jusqu'au retrait, même si le bandeau est acquitté.
- Le retrait, l'annulation ou le remboursement résout une notification de retrait encore ouverte.
- Une émission manquée est réconciliée depuis la vérité `orders.status = 'available'` à la prochaine lecture authentifiée.
- L'absence de session masque silencieusement le bandeau et ne déclenche pas un parcours OTP.
- L'application visible rafraîchit au plus une fois par minute ; ce polling ne crée aucun nouvel événement.
- Aucun document, lien documentaire ou notification métier n'est envoyé par WhatsApp.
- Les animations respectent `prefers-reduced-motion`.

## Hors périmètre

- remplacement ou contournement de l'OTP ;
- push navigateur ou natif ;
- email, SMS et WhatsApp métier ;
- centre bavard listant tous les mouvements ;
- compteur artificiel destiné à augmenter l'engagement.

L'OTP reste un sujet d'authentification séparé. Une évolution ultérieure pourra réduire sa fréquence par session durable ou passkey, sans affaiblir la preuve d'identité.
