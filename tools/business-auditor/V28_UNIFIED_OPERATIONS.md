# V2.8 — Scanner de logique métier unifié (prototype de recherche)

**Objectif historique** : parcourir le dépôt entier, détecter des signaux de défaut de logique métier, qualifier les états impossibles dans PostgreSQL, exécuter une preuve nominale et une anomalie avec **oracles indépendants** puis distinguer un bug reproduit d'un bug supposé ou d'un correctif confirmé. Un scanner ne promet pas de détecter 100 % des bugs.

## Une commande, quatre modes

Depuis la branche R&D (pas de modification de main) :

```bash
# Par défaut : tous les fichiers JS/TS suivis, aucun accès DB
npm run audit:logic:unified

# Contrôles SQL, lecture seule PostgreSQL local exclusivement
NODE_ENV=test KOMERCE_DISABLE_CRONS=true DATABASE_URL=postgres://...@localhost/komerce_test \
  npm run audit:logic:unified -- --mode data

# Vraies preuves métier bornées sur 4 bases clonées indépendamment détruites
NODE_ENV=test KOMERCE_DISABLE_CRONS=true DATABASE_URL=postgres://...@localhost/komerce_test \
  npm run audit:logic:unified -- --mode physical --max-cases 4

# Les trois couches et un rapport unique (mêmes préconditions PostgreSQL local)
NODE_ENV=test KOMERCE_DISABLE_CRONS=true DATABASE_URL=postgres://...@localhost/komerce_test \
  npm run audit:logic:unified -- --mode full --out /tmp/komerce-v28
```

Chaque mode écrit `unified-audit.json` et `unified-audit.md` avec le SHA, les domaines, les vérifications exécutées, les scénarios manquants et les limites de l'exercice. La commande historique `npm run audit:logic` est conservée pour ne pas perturber les contrôles existants de PR ; le renommage sera envisagé après acceptation du prototype.

## Sécurité et budget

- **quick** : pas de connexion DB ni appel PSP. Scanner statique du dépôt entier par l'outil historique, sans certifier ses suspicions.
- **data** : uniquement `komerce_test` sur `localhost`, `NODE_ENV=test`, crons désactivés. Transaction `REPEATABLE READ READ ONLY`, `ROLLBACK` garanti. Sept règles canoniques selon la version actuelle du moteur.
- **physical/full** : quatre scénarios maximum, registre **préfigé avant exécution** et hashé, clones SQL `kba_*` supprimés, transport PayPal strictement simulé, vrais services exécutés sans middleware HTTP (autorisation non certifiée).
- Sélecteur actuel : `FIN-REFUND-BA` nominal, `LOG-PARCEL-NOMINAL`, `FIN-REFUND-AB` adversarial, `LOG-PARCEL-CANCELLED`. Les oracles V2.2 financiers et V2.7 logistiques ne sont pas changés.
- La réussite du gate exige **de retrouver les contre-exemples** autant que les parcours sains. Un échec métier connu détecté n'est **pas** un échec du test ; la dérive du comportement attendu ou l'absence de preuve le sont.
- Les contrôles négatifs falsifient une sortie PSP additionnelle et un « correctif compteur » en colis annulé : les oracles doivent encore émettre une violation.
- `--max-cases 1..4` permet un mode réduit ; `--domains finance,logistics` limite la sélection. Les omissions sont déclarées **NON COUVERTES**.

## État réel de la généralisation

V2.8 fournit une **interface et un rapport communs**, une exécution bornée et deux adaptateurs d'oracles réutilisant les témoins des versions précédentes. Ce n'est **pas** encore un moteur capable d'inventer automatiquement un test physique pour chaque couple de writers du dépôt. La classification des signaux statiques par domaine repose encore sur des chemins/heuristiques : les fichiers non classables sont comptés à part.

| Domaine | Code | Preuve physique V2.8 |
|---|---|---|
| Finance | Parcours analysés | BA et AB, échantillon uniquement |
| Logistique | Parcours analysés | Affectation nominale et colis annulé |
| Inventaire / Hub | Parcours analysés | Non exécuté dans la commande V2.8 |
| Commandes hors remboursement | Parcours analysés | Non exécuté |
| Sourcing / raffinerie / taxonomie | Parcours analysés | Non exécuté |
| Prix, FX, douane | Parcours analysés | Non exécuté |
| Catalogue / exposition marchés | Parcours analysés | Non exécuté |
| Habilitations / isolation marché | Parcours analysés | Non exécuté |

## Suite nécessaire

1. Remplacer le registre de cas figé par un sélecteur général de paires/propriétaires branché sur la cartographie des frontières et les invariants (filtrage économique avant SQL).
2. Ajouter les adaptateurs **inventaire**, prix/FX, marché, taxonomie, catalogue, achats/Hub et clôture financière.
3. Tester les véritables routes avec rôles et appartenance marché, ainsi que la disponibilité réelle de la preuve PSP.
4. Accepter les propositions de correction uniquement quand l'oracle indépendant passe le même adversarial avant/après ; les faux fixes doivent rester détectables.
5. Donner au rapport des niveaux de preuve explicites, prioritiser les anomalies nouvelles et générer un bilan d'écarts compréhensible par les responsables métier.

**Aucune preuve V2.8 ne modifie une route, un service, une migration, main, staging ou Railway.**
