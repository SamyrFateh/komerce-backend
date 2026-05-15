# Plan de lancement opérationnel Komerce

> **Statut** : document complémentaire opérationnel  
> **Dernière consolidation** : 15 mai 2026  
> **Source** : `Plan_Lancement_v3.md` du 30 mars 2026, réorganisé en plan maintenable.  
> **But** : garder la méthode de lancement sans faire passer les hypothèses de mars 2026 pour vérité technique actuelle.

---

## 1. Principe directeur

> Lancer vite, petit, et apprendre.

Dix vraies commandes observées valent mieux qu'une audience théorique. Le lancement Komerce doit valider le circuit réel : client, paiement, sourcing, hub, transport, douane, relais, collecte, support et marge.

---

## 2. Objectif pilote

| Objectif | Cible |
|---|---|
| Commandes test | 10 commandes pilotes complètes |
| Lancement contrôlé | 20 premières commandes réelles avant communication large |
| Objectif M3 historique | 50 commandes/mois |
| Relais pilote | 1 relais actif à Mutsamudu ou zone pilote équivalente |
| Doctrine | Apprendre avant de scaler |

---

## 3. Bloquants avant première commande réelle

| ID | Bloquant | Pourquoi c'est bloquant |
|---|---|---|
| **B1** | Structure juridique et bancaire praticable | Encaisser, contractualiser, facturer. |
| **B2** | Paiement en ligne ou alternative validée | Permettre la diaspora et sécuriser la validation. |
| **B3** | Hub Dubai opérationnel | Contrôle qualité, emballage, étiquetage, scan avant expédition. |
| **B4** | Fournisseur généraliste testé | Avoir un catalogue réel et des prix vérifiés. |
| **B5** | Groupeur maritime confirmé | Expédier réellement vers les Comores. |
| **B6** | Relais pilote formé | Encaissement cash, remise, scan, preuve de collecte. |
| **B7** | Tarifs/prix intégrés au moteur économique | Éviter de vendre à perte dès le pilote. |
| **B8** | CGV, confidentialité, support | Sécuriser la relation client. |

---

## 4. Phases opérationnelles

### Phase 1 — Fondations

Valider : structure, solution paiement, domaine/PWA, CGV, support, notifications, premier jeu de règles pricing.

### Phase 2 — Acteurs opérationnels

Mettre en place : hub Dubai, fournisseur généraliste, groupeur maritime, relais pilote, procédures de scan et remise.

### Phase 3 — Catalogue initial

Petit catalogue réel, contrôlé et transportable. Critères : demande probable, faible risque, marge protégée, qualité vérifiable au hub, prix final compréhensible.

### Phase 4 — Commandes pilotes

| Ref | Scénario | Objectif de test |
|---|---|---|
| T1 | Commande locale simple | Flux minimal. |
| T2 | Commande multi-articles | Groupage et cohérence panier. |
| T3 | Commande diaspora | Paiement distant. |
| T4 | Panier partagé | Payeur/destinataire distincts. |
| T5 | Produit cérémonie | Urgence et exigence qualité. |
| T6 | Groupe/famille | Contribution ou coordination. |
| T7 | Anomalie hub | Produit non conforme détecté avant expédition. |
| T8 | Annulation avant achat | Statut, stock, wallet/remboursement. |
| T9 | Litige produit | Support, preuve, compensation. |
| T10 | Cycle complet | De commande à collecte + retour client. |

---

## 5. Critères de validation avant lancement public

| Domaine | Critère |
|---|---|
| Technique | Commandes test complétées sans erreur critique. |
| Hub | Checklist respectée sur 100 % des colis test. |
| Logistique | Premier colis arrivé au relais dans un délai acceptable. |
| Paiement | Paiement en ligne et/ou cash validé selon flux cible. |
| Notifications | Messages critiques reçus par les bons destinataires. |
| Relais | Agent formé, scan et remise testés. |
| Pricing | Prix cohérents avec coûts connus et provisions. |
| Support | Incident simulé traité et tracé. |
| UX | Testeurs capables de commander sans aide lourde. |

---

## 6. Lancement contrôlé

Le lancement doit rester progressif : réseau personnel, groupes WhatsApp ciblés, diaspora proche, vitrine relais, bilan des premières commandes, ajustement, puis communication plus large.

Pas de campagne massive tant que les preuves terrain ne sont pas validées.

---

## 7. KPIs de pilotage

| Indicateur | Sens |
|---|---|
| Commandes reçues | Mesure traction réelle. |
| Panier moyen | Vérifie économie unitaire. |
| Taux de conversion | Mesure clarté de l'offre. |
| Délai réel Dubai → relais | Mesure promesse logistique. |
| Taux de litige | Mesure qualité hub + fournisseur. |
| Écart estimé/réel | Mesure précision pricing/douane. |
| NPS ou satisfaction | Mesure confiance. |
| Part diaspora | Mesure utilité du paiement distant. |
| Marge réelle | Mesure viabilité. |

---

## 8. Risques majeurs

| Risque | Mitigation |
|---|---|
| Fournisseur non fiable | Avoir backup et tests produits. |
| Employé hub défaillant | Checklist, photos, supervision, backup. |
| Groupeur instable | Identifier au moins deux options. |
| Erreur non détectée au hub | Contrôle obligatoire + photo validation. |
| Paiement en ligne bloqué | Maintenir cash relais et alternative paiement. |
| Douane supérieure à l'estimation | Provision + historisation + ajustement moteur. |
| Colis perdu | Assurance ou politique de compensation claire. |
| Relais mal formé | Formation courte + procédure papier + support direct. |

---

## 9. Règle de crise

Tout incident opérationnel doit être documenté, qualifié, notifié si impactant, résolu ou compensé, puis transformé en règle/process si récurrent.

Le client doit apprendre l'incident par Komerce, pas en le découvrant seul.

---

## 10. Lien avec les autres docs

- Vision marché : `docs/VISION_MARCHE_KOMERCE.md`
- Doctrine économique : `docs/DOCTRINE_ECONOMIQUE_KOMERCE.md`
- Invariants critiques : `docs/ZONE_IMPACT.md`
- Cartographie technique : `docs/CARTOGRAPHY_360.md`
