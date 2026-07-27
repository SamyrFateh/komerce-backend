# P3b — projection `gateHealth`

**Statut : clos.** Le contrat de couverture est atteint et rendu bloquant dans le dépôt : 18 sources de gates configurées, 18 attribuables, 0 source en échec.

Clôturé le **2026-07-28** sur `main`.

---

## 1. Contrat de clôture

Le palier exigeait :

- `gateHealth` présent sur les 28 features canoniques ;
- au moins **18 sources de gates attribuables** ;
- vérification de la couverture des fichiers avant interprétation des violations ;
- 0 finding sans attribution exploitable ;
- 0 fichier non projetable ;
- 0 fichier projeté vers plusieurs features ;
- conservation du message détaillé de chaque finding ;
- un gate exécutable refusant toute régression sous le seuil contractuel.

La cible de 18 n'a pas été abaissée et aucune source n'a été comptée par simple présence déclarative.

## 2. État avant

La première projection couvrait correctement les 28 features, mais n'exécutait que trois sources de gates. La mécanique était saine sur son petit périmètre, sans satisfaire le contrat 18/24.

Le blocage provenait principalement de l'ownership frontend : des fichiers actifs restaient regroupés dans le manifeste transversal `boutique`, ce qui empêchait d'attribuer honnêtement les sorties des gates à une feature canonique.

## 3. Modifications livrées

- Réduction du manifeste historique `boutique` à un alias de compatibilité de **15 arêtes**, sans ownership de source active.
- Projection du panier personnel et du suivi client vers la feature canonique `orders`.
- Projection du shell, du bus, du store, du client API et des utilitaires vers `platform-ops`.
- Réattribution des surfaces catalogue, favoris, groupe et tests existants à leurs propriétaires canoniques.
- Normalisation de 18 sorties de gates dans `scripts/gen-gate-findings.js` avec preuve de couverture par fichier.
- Conservation du fichier source et du message détaillé dans chaque finding projeté.
- Durcissement de `scripts/feature-360-check.js` avec `MIN_GATE_SOURCES = 18`, échec sous le seuil, échec si une source échoue, et échec sur attribution absente, fichier non projetable ou multiprojection.
- Ajout de tests de régression sur la classification des preuves de composition O6.
- Déplacement de `showToast` hors du panier vers l'utilitaire transversal, supprimant un faux couplage `auth-identity → orders`.

Aucun nouveau domaine métier n'a été créé. Les 28 autorités canoniques restent inchangées.

## 4. Mesure après

Sources générées : `docs/GATE_FINDINGS.json` et `docs/FEATURE_360.json`.

```text
minimumAttributableSources : 18
configuredSources          : 18
attributableSources        : 18
coverageBeforeViolations   : true
sourcesFailed              : 0

features                    : 28
totalFindings               : 43
attributedFindings          : 43
unattributedFindings        : 0
unprojectableFiles          : 0
multiProjectedFiles         : 0
gateBlocked                 : 0
```

Les 43 findings sont des signaux attribués, pas 43 erreurs bloquantes. La projection agrège uniquement vers `HEALTHY`, `ATTENTION` ou `BLOCKED`, tout en conservant le détail source.

## 5. Preuves de détection

Le contrat est maintenant fail-capable :

- moins de 18 sources → `GATE_SOURCE_COVERAGE_BELOW_CONTRACT` ;
- une source de gate en échec → `GATE_SOURCE_FAILED` ;
- fichier sans propriétaire projetable → `GATE_FINDING_FILE_UNPROJECTABLE` ;
- fichier possédé par plusieurs features → `GATE_FINDING_FILE_MULTI_PROJECTED` ;
- finding sans attribution → `GATE_FINDING_UNATTRIBUTED` ;
- finding sans message → `GATE_FINDING_MESSAGE_LOST`.

Les tests ciblés du finaliseur ont également vérifié :

- composition pure → `COMPOSITION_ROOT_WIRING` ;
- composition mélangée à un appel d'interface → classification depuis la preuve hors wiring ;
- dépendance technique hors wiring → `TECHNICAL_PRIMITIVE` ;
- comportement du panier et de l'identité après déplacement de `showToast`.

## 6. Interaction O6 — dette visible, pas de faux zéro

La clôture P3b n'efface pas les coutures observées :

- `CROSS_FEATURE_DIRECT_IMPORT` observés : **3** ;
- imports directs non arbitrés : **0** ;
- paires `UNCLASSIFIED` : **0** ;
- ledger d'exceptions O6 : **7 décisions étroites** ;
- deux cycles topologiques `auth-identity ↔ platform-ops` et `catalog ↔ platform-ops` restent visibles dans l'inventaire O6, mais leurs quatre directions sont expliquées et bornées dans le ledger ; elles ne sont pas masquées comme inexistantes.

Le `map:check` complet a accepté ces dispositions. Aucun contrat ou import brut n'a été réécrit artificiellement à zéro.

## 7. Exécution de clôture

GitHub Actions, run **30312357239**, job `finalize` :

- dépendances installées ;
- tests ciblés verts ;
- cartes dépendantes régénérées ;
- `feature:360:check` vert ;
- `map:check` vert ;
- commit de clôture poussé ;
- workflow one-shot supprimé de l'arbre validé.

Commit de preuve :

```text
ad6addfa3bdfa06edfb7db8e4e362e8272c6ea7f
chore(p3b): verified 18-source closure [p3b-generated]
```

Le job temporaire `p3b-closure` a ensuite été retiré de `carte-first.yml`, et le workflow principal a été remis en permissions de lecture seule.

## 8. Verdict

**P3b est clos.**

Le seuil 18/18 est mesuré, attribuable, testé et bloquant. Les anomalies restantes sont visibles comme `ATTENTION` ou comme dispositions O6 documentées ; elles ne rouvrent pas ce palier et ne justifient pas l'ouverture de P6, P7 ou P8 dans ce chantier.
