# Komerce — Cartographie des processus P1–P7 (référence)

> **Provenance** : document original rédigé par Opus (assistant IA) le 2026-10-21 dans la session de cadrage « navigabilité des dashboards », transmis par le propriétaire du produit et intégré au dépôt le 2026-10-21 à sa demande. Fichier source : `KOMERCE_OPUS_CARTOGRAPHIE_P1_P7_ORIGINALE.md`.
> **Statut** : référence de processus. Le texte situé sous la ligne `---` est reproduit **verbatim** ; les définitions P1–P7 ne sont pas modifiées.
> **Compléments** : `docs/doctrine/KOMERCE_NAVIGABILITE_CONTRAT_EXECUTABLE.md` (contrat d'implémentation) ; arbitrages métier ultérieurs ci-dessous.

## Arbitrages ultérieurs du propriétaire (hors texte original)
- **Navigation directe** : le lien workspace → workspace est autorisé quand la route existe ; la fiche 360 sert à comprendre, elle n'est pas un passage obligé (cette décision remplace la « règle de passage » du § B ci-dessous).
- **P6 → P1** : coûts réellement constatés et marges finalisées alimentent l'analyse économique et peuvent déclencher une **revue** des prix ; ils ne modifient jamais automatiquement un prix actif.
- **P7 (marché)** conditionne l'accès aux décisions commerciales (prix, exposition) et aux commandes selon la readiness du marché. Pilotage observe les processus et leurs blocages ; il n'en est pas propriétaire.
- **Mocks validés** (Pilotage, Commerce, Commandes, Opérations, Finance, Sourcing Live, Hub Live, Relais Live) et KPI pertinents priment sur les wireframes schématiques du § C.
- Toute décision reste humaine et explicite ; une marge provisoire ou inconnue ne devient jamais définitive.

---

## Komerce : processus, navigabilité et anatomie des dashboards

**En bref :** la base est solide. Les processus existent dans le code et le mécanisme de retour contextuel (`contextualHref` / `return_to`) existe déjà. Le manque principal n’est pas graphique. Les écrans de supervision (Pilotage, Commerce, Hub/Relais live, Expéditions, Achats) ne passent presque jamais la main à l’objet suivant. Les fiches Produit 360 et Commande 360 ne disent pas où en est l’objet dans son processus.

Légende : ✔ prouvé dans le code · ◐ partiel · ✖ manquant ou hypothèse.

### A. Cartographie des processus

**P1. Transformation produit** (Sourcing → Catalogue → Marché)

```
Fournisseur ─▶ Sourcing ─────────▶ Raffinerie ─────────▶ Catalogue global ─▶ Prix marché ─────▶ Exposition pays ─▶ Boutique
  (scan)      KEEP/WATCH/REJECT ✔  enrich·FR·certif ✔    publication ✔       draft→LOCAL_ACTIVE ✔  ENABLED ✔
               │ WATCH ↺ (rescan)   │ refus → retour candidat ◐               │ bloqué si policy/CDR ✔
               └ REJECT ■           └ changement fournisseur → re-raffinage ✔ (change-intake / field-sync)
Branche parallèle : LOCAL_STOCK (stock pays) ─▶ prix marché, sans chaîne import ✔
```

- Le Sourcing, puis le Catalogue (central), sont responsables jusqu’à la publication.
- L’Économie et le pays (`pricing.decide`) sont responsables du prix.
- Le pays (`catalog.expose`) est responsable de l’exposition.
- Le prix et l’exposition se font par marché et en parallèle : un produit peut être actif au Cameroun et absent aux Comores.

**P2. Commande → remise client** (machine d’états ✔)

```
pending ─▶ confirmed ─▶ ordered ─▶ preparation ─▶ shipped ─▶ in_transit ─▶ available ─▶ collected
   │paiement   │           │PO fournisseur (P3)  │colis/lot (P4)        │relais          │remise
   └───────────┴─ cancelled ─▶ refunded (à tout stade avant collected)
```

**P3. Approvisionnement :** commande payée ─▶ besoin ─▶ bon de commande fournisseur ─▶ paiement fournisseur (revue : ambigu ou rejeté ✔) ─▶ réception au Hub ✔

**P4. Logistique et douane**

```
Hub (Dubaï mutualisé ◐) ─▶ colis ─▶ lot / expédition par marché ─▶ douane ─▶ entrée pays ─▶ distribution locale ─▶ relais
                                     groupage ✔   MARKET_MISMATCH ✔                  segments Dubaï→CM/CG ✖ (à configurer)
                                                                   KM : étapes inter-îles en aval ✔
```

Dans le code, `transit_hub = ANJOUAN` reste un héritage KM, pas le Hub Dubaï.

**P5. Argent :** encaissement (Stripe, cash au relais) ─▶ garde cash (transferts) ─▶ dépôt ─▶ clôture finance ─▶ règlement pays (READY → REQUESTED → PAID → RECEIVED) ✔

**P6. Vérité des coûts :** estimation figée à la commande ─▶ coûts réels (fret, douane, Hub, relais, paiement) ─▶ marge finalisée ✔. C’est ce qui alimente Finance et l’Atelier des prix (boucle P6 → P1 : les coûts réels corrigent le prix).

**P7. Marché :** provisioning ─▶ readiness ─▶ ACTIVE ─▶ délégation (équipe, plafonds) ✔. Cette étape conditionne P1 (prix, exposition) et P2 (checkout).

### B. Carte de navigabilité

```
              ┌──────────── PILOTAGE (où ça coince ?) ────────────┐
              ▼              ▼              ▼              ▼
          COMMERCE       OPÉRATIONS      FINANCE        MARCHÉS
        (que vend-on)  (qu'est-ce qui  (où est l'argent) (qui opère)
              │          avance)          │
   ┌──────────┼──────┐     │       ┌──────┼──────────┐
   ▼          ▼      ▼     ▼       ▼      ▼          ▼
Sourcing  Raffinerie Prix  Hub/Relais  Expéd.&Douane  Comptabilité   ← WORKSPACES (agir)
   └──P1──────┴──────┘     └──P4──────────┘  └──P5──┘
              ▼                    ▼                ▼
        PRODUIT 360 ◀──────▶ COMMANDE 360 ◀──▶ CLIENT 360 / FOURNISSEUR 360   ← OBJETS (comprendre)
```

**Règle de passage :**

- On descend toujours avec le contexte : marché, période, `simulation_scope`, objet.
- On remonte par `return_to`.
- On passe latéralement d’une étape à l’autre par l’objet (la fiche 360), jamais d’un workspace à un autre en direct.

| Depuis                               | Clic             | Arrive sur                                 | État actuel                             |
| ------------------------------------ | ---------------- | ------------------------------------------ | --------------------------------------- |
| Pilotage, chiffre en anomalie        | « Voir »         | dashboard du domaine, filtré               | ✖ pas de lien contextuel                |
| Commerce, produit                    | ligne            | Produit 360                                | ✖                                       |
| Opérations, commande bloquée         | ligne            | Commande 360                               | ✔                                       |
| Hub/Relais live, Expéditions, Achats | colis, PO ou lot | Commande 360 / Fournisseur 360             | ✖                                       |
| Finance, écart                       | flèche           | Commande 360                               | ✔                                       |
| Sourcing, Raffinerie, Prix           | produit          | Produit 360                                | ✔                                       |
| Produit 360                          | étape du fil     | workspace de l’étape, objet présélectionné | ◐ liens présents, sans fil de processus |

### C. Trois wireframes

**Pilotage : supervision transversale.** Pas de KPI de domaine recopiés.

```
┌ Hero · marché · période ─────────────────────────────────────────────┐
├ 4 signaux santé (un par domaine) ────────────────────────────────────┤
│ Commerce ●  │ Opérations ● 3 bloquées │ Finance ● 50 % coûts │ Marchés ● 1 à configurer │
├ À traiter maintenant (5 max, triés par impact) ──────────────────────┤
│ ! 3 commandes bloquées > 48 h au Hub          → Opérations (filtré)  │
│ ! Congo : politique de prix absente           → Atelier des prix CG  │
└ Tendance unique (CA encaissé vs marge finalisée) ────────────────────┘
```

- Visible tout de suite : l’état de chaque domaine et les décisions en attente.
- Accessible par clic : tout le reste. Chaque signal ouvre son domaine avec le filtre déjà posé.

**Opérations : cockpit de processus.** C’est ici que le processus mérite d’être dessiné.

```
┌ Hero · marché · période ─────────────────────────────────────────────┐
├ Bande de flux P2 (comptes par étape, retard en orange) ──────────────┤
│ confirmées 12 ▸ commandées 8 ▸ préparation 5 ▸ expédiées 4 ▸ transit 6 ▸ au relais 3 ▸ remises │
│                      ▲ 2 en retard            ▲ 1 bloquée douane       │
├ Exceptions (liste) ────────────────┬ Lots en route ────────────────────┤
│ Réf · étape · depuis · qui agit →  │ Lot · marché · segment · ETA/À configurer │
└────────────────────────────────────┴───────────────────────────────────┘
```

- Un clic sur une étape filtre la liste. Un clic sur une ligne ouvre la Commande 360.
- Le travail lui-même se fait dans Hub/Relais ou Expéditions, que la ligne ouvre avec l’objet présélectionné.

**Produit : chaîne de transformation.** La vue est portée par la fiche Produit 360, pas par un nouveau dashboard.

```
┌ Produit 360 · RCT1-P4 ──────────────────────────────────────────────┐
│ Fil P1 : Sourcing ✔ ─ Raffinerie ✔ ─ Catalogue ✔ ─ Prix ─ Exposition │
│                                          KM ✖ pas de prix │ CM ✔ 20 000 XAF actif │
├ Étape courante (orange) : « Prix KM à décider » → Atelier des prix KM│
├ Onglets existants : Sourcing · Stock · Prix · Commandes · Fournisseurs │
└──────────────────────────────────────────────────────────────────────┘
```

Sourcing, Raffinerie et Catalogue restent des workspaces de file : la liste de produits à traiter dans l’étape. Chaque produit ouvre sa fiche 360, où l’on voit l’étape d’avant, l’étape d’après et le lien « Continuer → » vers le workspace suivant.

### D. Modèle minimal réutilisable

| Anatomie                                                                           | Rôle                         | Densité visible                                      | Profondeur                          |
| ---------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------- | ----------------------------------- |
| **Supervision** (Pilotage, Commerce, Finance, Marchés)                             | dire où ça va bien ou mal    | 4 KPI maximum, ≤ 2 bandeaux d’action, 1 à 2 panneaux | 1 clic vers le domaine ou la 360    |
| **Cockpit de processus** (Opérations)                                              | voir le flux et ses blocages | 1 bande d’étapes et 1 liste d’exceptions             | 1 clic vers la 360, 2 vers l’action |
| **Workspace** (Sourcing, Raffinerie, Prix, Hub, Expéditions, Achats, Comptabilité) | traiter une file             | file, filtres, détail latéral                        | l’action se fait sur place          |
| **Live** (Hub live, Relais live)                                                   | exécuter en temps réel       | file du moment, scan                                 | aucune analyse                      |
| **360**                                                                            | comprendre un objet          | fil de processus, étape courante, onglets            | relie toutes les étapes             |

Cinq règles :

1. Chaque chiffre est cliquable et ouvre la liste filtrée qui le compose.
2. Un processus n’est dessiné que sur l’objet (fiche 360) ou dans le cockpit qui le pilote, jamais sur une page de supervision.
3. On distingue toujours « inconnu », « zéro », « non applicable » et « simulé (RCT1) ».
4. On ne rejoue pas un indicateur d’un autre domaine : Pilotage pointe vers Finance, il ne recopie pas la marge.
5. Le contexte (marché, période, scope, retour) voyage toujours, avec le mécanisme existant.

### E. Écarts avec l’existant

**Ce qui existe déjà :**

- les processus P1 à P7 dans le code ;
- les quatre fiches 360 ;
- le retour contextuel ;
- Finance (FIN-03), Opérations vers Commande 360, Sourcing/Prix/Catalogue vers Produit 360.

**Les ruptures à corriger,** sans nouveau moteur :

1. Pilotage et Commerce n’ont aucun lien contextuel. Les signaux devraient ouvrir leur domaine avec le filtre posé.
2. Hub/Relais live, Expéditions & Douane et Achats ne mènent pas vers Commande 360 ni Fournisseur 360.
3. Produit 360 et Commande 360 n’ont pas de fil de processus. Les données d’étape existent déjà (statuts, décisions, états prix et exposition) ; seule la projection en lecture manque.
4. L’encadré « À quoi sert cet écran » répète le titre du hero. Je le remplacerais par l’aide repliée, comme dans Finance.
5. Le CA encaissé apparaît dans Pilotage, Commerce et Finance. Il faut lui donner un seul propriétaire, Finance, et des renvois ailleurs.

**Éléments manquants indispensables (rares) :**

- **Projection d’étape par objet** (produit, commande, lot) côté serveur, en lecture seule. Elle alimente le fil des 360 et la bande de flux d’Opérations. Sans elle, l’interface recalculerait le métier, ce qui est interdit.
- **Segments de transport par marché** (Dubaï → entrée pays → ville), déjà décidés dans l’issue #2754. Tant qu’ils manquent, ils doivent s’afficher « À configurer » dans le cockpit, pas comme vides.
- **État « marché à configurer »** (cf. Atelier des prix · Congo), commun à Pilotage, Prix et Marchés.

**Ce que je remets en cause dans les mocks :**

- Les dashboards de supervision sont trop denses : une partie de leur contenu relève des workspaces.
- Le processus produit ne devrait pas être un dashboard de plus. Sa place est la fiche Produit 360, plus un lien « Continuer → » dans chaque workspace.
- Les vues Live ne doivent pas prendre l’anatomie KPI : ce sont des files d’exécution.