# Komerce — Refund Execution Authority (RC-5 / RC-9)

**Statut : FONDATION NON ACTIVÉE.** Ce document est le contrat de conception pour les remboursements Stripe et PayPal ; aucun comportement financier existant n'est remplacé par la migration 317.

## Frontière d'autorité

1. Le paiement source (capture, devise et montant) doit être rapproché de la commande et du `fx_snapshot` figé, **sans taux du jour**. Une commande d'un marché KMF, XAF ou DJF conserve son marché et ses montants de transaction ; le prestataire de remboursement externe est en EUR, comme la capture.
2. Le writer `refunds` doit d'abord réserver une **intention durable** en PostgreSQL sur une transaction courte : `refund_execution_intents` contient commande, marché, prestataire, capture, événement stable, montant EUR et statut `reserved`.
3. `reserveRefundIntent` verrouille la commande (`FOR UPDATE`), refuse toute entrée historique `refunds` non rapprochée, vérifie les plafonds cumulés, réserve puis COMMIT. L'API retourne une clé prestataire déterministe issue de l'UUID persistant (`kmr-ref-<uuid>`), jamais issue de `Date.now()`.
4. `claimRefundIntent` effectue une deuxième transaction courte `reserved → processing`. Elle COMMIT **avant** tout appel Stripe/PayPal. Un rejeu de l'événement ne redéclenche pas le PSP.
5. Après le call PSP, **ne pas** écrire directement `refunded` : une étape de rapprochement (encore non implémentée) doit lier le résultat du fournisseur à l'intention, garantir la preuve de réussite et mettre à jour `refunds` + statut de commande avec la bonne machine d'état. Pour un montant partiel, la commande ne doit pas être clôturée financièrement comme totalement remboursée.

## Pannes / sécurité

- Crash après `reserved` : aucune sortie PSP prouvée ; intervention/reprise contrôlée avec preuve de non-exécution.
- Crash après `processing`, timeout PSP, réponse inconnue : **aucun retry automatique**. D'abord vérifier le prestataire par identifiants de capture/requête.
- Capture incorrecte, paiement non confirmé, changement de payload avec même événement, historique `refunds` existant, autre intention non résolue, total EUR dépassé : refus.
- L'index unique partiel en DB empêche deux intentions `reserved/processing/unknown` sur une commande, y compris en concurrence entre pods.
- La clé d'idempotence PSP dépend de l'**intention précise**, pas simplement de la commande/capture : elle est réutilisée sur les vérifications du même événement, jamais pour un remboursement partiel ultérieur légitime.
- Les PSP simulés ne prouvent pas un remboursement réellement réussi. Aucun test ne fait de call Stripe/PayPal réel.

## Vérification de résultat provider — étape de préparation (lecture seule)

`services/refund-evidence-verifier.js` n'exécute **aucun remboursement** et n'écrit **aucun statut**. Il lit une référence de remboursement déjà connue via Stripe `refunds.retrieve` ou PayPal `getRefund`, puis confronte son identifiant, la capture associée, le montant EUR et l'état du prestataire à l'intention persistée.

- Stripe `succeeded` ou PayPal `COMPLETED` n'est confirmé que si la preuve porte sur la **même capture** et **le même montant en EUR**.
- Preuve sans lien de capture, HTTP indisponible, référence ou statut non reconnu : `UNKNOWN`. Ne jamais confondre cela avec un remboursement confirmé ou échoué.
- Capture, devise ou montant contradictoires : refus explicite et journal d'incident à prévoir lors de l'orchestration.
- PayPal ne garantit pas que chaque réponse de remboursement expose `supplementary_data.related_ids.capture_id`. **En son absence, refus de certification** ; il faudra compléter par une preuve fiable côté capture et non assouplir la condition.
- Le vérificateur ne change pas `refund_execution_intents`, `refunds`, `orders` ou les dashboards. Une étape de settlement indépendante, atomique et testée est encore nécessaire avant toute mise en service.

## Activation — conditions bloquantes

Cette première PR **ajoute une table et un service non branché**, avec tests de fonctions et tests DB sur tables TEMP ; elle ne corrige pas RC-5 ou RC-9 en production. L'activation doit attendre des PR distinctes qui :

1. Inventorient **tous** les auteurs d'opérations externes (cancel.js, admin-order-refund, refund-service fallback, PayPal et shared-cart). Aucun second writer PSP hors autorité.
2. Rapprochent les remboursements `refunds` existants, y compris partiels et états ambigus, sans reset/purge ni backfill aveugle. Le contrôle historique reste bloquant en attendant.
3. Implementent la réconciliation provider avec statut `unknown` et webhooks/relectures authentifiés ; aucun `refunded` sans cumul effectif de remboursement intégral.
4. Prouvent sur PostgreSQL jetable deux sessions concurrentes, crash avant/après PSP, retour API ambigu, rejet de capture/marché, montants partiels, rejeu exact/mismatch, quatre marchés et snapshots FX.
5. Exécutent les parcours HTTP autorisés, les vues Finance/Commandes et une acceptation métier séparée du PASS CI.

**Aucun RESET, aucune purge et aucun remboursement financier réel.** Ne jamais annoncer un GO financier sur la seule présence de ce ledger.
