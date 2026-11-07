# Komerce — Doctrine de couture des informations utiles (V1)

Date : 2026-11-07. Périmètre : commande client → achat/PO → Hub → expédition/transitaire → relais → retrait, y compris circuit local sans Hub.

## Finalité

Un fait métier certain n'est saisi qu'une fois et communiqué aux acteurs qui doivent savoir ou agir. Une notification n'est pas une copie du journal d'activité. Aucun rôle ne gagne de droits métier par le seul fait de recevoir une information.

**Trois niveaux à ne pas confondre**
1. **Fait et preuve** : source canonique (incident, commande, expédition, réception, facture). Identifiant, auteur, date, impact, justificatif, propriétaire de résolution.
2. **Projection ciblée** : console de l'acteur concerné (Hub, responsable marché, relais, transitaire, client) ; seules les informations nécessaires et autorisées sont visibles.
3. **Alerte proactive** : événement significatif, confirmé, non déjà notifié, avec conséquence et prochaine étape. Ne pas promettre un délai non confirmé.

La projection ne recrée ni incident, ni commande, ni statut de transport. Acquitter une alerte ne ferme jamais un incident.

## Quand informer

| Fait vérifié | Responsable de résolution | Relais destinataire | Client | Canal souhaitable |
|---|---|---|---|---|
| Article fournisseur indisponible, rupture confirmée | Purchasing / responsable marché | Informer si la commande est destinée au relais | Informer dès que la conséquence est établie | Console + in-app, externe utilitaire si certifié |
| Réception Hub partielle, article cassé / manquant | Hub/Logistique | Prévenir le relais affecté | Avertir si livraison retardée ou partielle | Dossier incident + projection + alerte |
| Scan incohérent, corrigé sans impact | Logistique | Ne montrer que si une action relais est nécessaire | Ne pas notifier | Journal interne |
| Départ, arrivée ou ETA mis à jour par le transitaire | Transitaire (preuve) | Voir la date utile et son degré de confirmation | Notifier seulement en cas de changement matériel du délai annoncé | Dossier expédition, chronologie ; alerte sélective |
| Expédition bloquée ou absence prolongée d'information | Transitaire + Hub selon responsabilité | Informer si remise menacée | Informer dès qu'un impact réel est confirmé | Demande ciblée + escalade |
| Réception au relais avec écart de quantité | Relais/Logistique | Fait visible immédiatement, opération à traiter | Informer sur articles réellement concernés | Attestation + incident + alerte |
| Remboursement effectivement confirmé | Finance/Orders | Pas de détails financiers inutiles | Confirmation + justificatif privé | Mon Komerce, alerte informative |
| Retrait intégral attesté | Relais | Clore l'action de remise | Mise à jour du suivi | Preuve de remise |

**Critère client** : avertir rapidement si disponibilité, composition, délai promis, montant, lieu de retrait ou action demandée change substantiellement. Un problème technique sans conséquence n'est pas une notification client.

**Critère relais** : tout fait confirmé qui affecte ce que le relais doit attendre, réceptionner, remettre, expliquer au bénéficiaire ou escalader apparaît dans sa file « Incidents à connaître ». La visibilité est liée au relais de la commande, y compris avant expédition ; le relais n'a pas l'autorité de résoudre un incident Hub/Purchasing.

## Sécurité, cohérence et cycle de vie

- Scoping serveur obligatoire : relais attribué, marché délégué, et à terme transitaire associé à l'expédition. Un ID fourni par le client ne confère aucun droit.
- Les informations de production ne doivent pas inclure les commandes de simulation ; la recette utilise un contexte distinct.
- La projection peut joindre `incidents` (source logistique) et `order_incidents` (signalements locaux), mais ne crée aucune troisième table de vérité.
- Une relation `order_item_id` prime sur un `order_id` seulement si l'appartenance est vérifiée ; incident ambigu multi-commandes : classer pour contrôle humain plutôt qu'exposer au mauvais relais.
- Statuts ouverts ou en investigation : file active. Résolution attestée ou clôture : historique lisible, action retirée. Ne pas supprimer les preuves.
- Aucune notification à partir d'un simple champ `notify_client=true` sans envoi traçable confirmé. Stocker tentatives, résultats, erreurs, relance et idempotence par fait + destinataire + phase.
- L'absence d'adresse, de téléphone ou d'envoi provider ne bloque jamais la transaction métier : signal interne, reprise contrôlée, pas de double message.
- Information de retard : ETA `confirmée`, `estimée` ou `inconnue`. Ne jamais annoncer une date inventée.

## État vérifié dans le code

- `services/client-notification-service.js` : `order.exception.*` est prévu ; le branchement automatique depuis les incidents métier reste à certifier.
- `services/relay-dashboard-queries.js` : deux sources d'incidents existaient sans projection unifiée. Le relais ne doit pas dépendre uniquement de `order_incidents`.
- `services/international-shipment-journey.js` : transitaire peut confirmer `forwarder_received`, `in_transit`, `arrived`, et actualiser référence de suivi, conteneur, connaissement et ETA avec preuve et historique.
- `routes/transitaire-api.js` : API transitaire historique au niveau colis, distincte du parcours canonique `international_shipments`. Ne pas créer une seconde machine de statut.
- `routes/admin-shipping-customs-workspace.js` : accès agent_transitaire déjà possible, mais la projection d'un partenaire externe doit être limitée à SES expéditions. Ne pas exposer le cockpit administratif entier.

## Mini-espace transitaire : second lot, pas un nouveau transport

**MVP partenaire** : connexion individuelle et permission limitée à ses dossiers ; liste des expéditions qui lui sont confiées ; état, ETA et référence de suivi ; formulaire « Actualiser le suivi » (réception/départ/arrivée, nouvelle ETA, commentaire bref et justificatif) ; réponse à une demande d'information initiée par Komerce.

**Relance sortante Komerce** : créer une demande d'actualisation sur le dossier lorsque l'ETA est dépassée ou qu'aucune nouvelle information n'est reçue depuis le seuil contractuel. Réponse/absence de réponse visibles dans le dossier. Relance bornée, escalade vers le Hub sans inventer de statut ni d'ETA. Aucun accès factures, montants clients, achats ou administration.

Les faits acceptés sont journalisés dans `international_shipment_events` et reflétés dans la chronologie existante. La transmission d'une demande ou d'une réponse est distincte du franchissement d'un jalon physique.

## Recette guidée à ajouter

1. Achat indisponible avant PO confirmé : information fournisseur factuelle, commande et article corrects ; aucune fausse annonce « expédié ».
2. Réception Hub partielle puis correction : relais concerné averti, client averti uniquement si impact réel ; jamais d'accès à une autre commande.
3. Réception relais 4/5 articles : attestation conservée, incident canonique visible dans les deux espaces opérationnels sans duplication ; la preuve de remise ne concerne que le livré.
4. Incident technique corrigé sans conséquence : aucun message client et aucun faux blocage relais.
5. Transitaire met à jour ETA avec justificatif : chronologie unique, relais voit l'information utile ; si retard significatif, alerte client cohérente.
6. Komerce demande une mise à jour transitaire ; réponse reçue ou expirée, escalade tracée.
7. Répéter deux fois même événement : ni doublon de dossier ni doublon d'alerte client.
8. Multimarché, multi-relais, colis contenant plusieurs commandes : isolation strictement vérifiée.
9. Échec WhatsApp : journal d'erreur et reprise non bloquante ; document privé non joint au message.
10. Résolution prouvée : le relais voit la clôture, le client reçoit la suite si et seulement si l'incident avait été communiqué.

## Ordre de livraison

**V1 :** couture de lecture Relais (incident opérationnel → relais concerné), tests unitaires et recette réelle.

**V2 :** émetteur client depuis des événements métier validés (détection + résolution), canaux et preuve d'envoi, sans spam.

**V3 :** mini-espace transitaire sécurisé et demandes de suivi/ETA, réutilisant le moteur `international_shipment_journey`.

Aucun lot n'est GO sur la seule présence du code. Vérifier PostgreSQL, permissions réelles, UI desktop, preuves de bout en bout sur staging et non-régression des parcours local/import.
