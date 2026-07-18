# DELIVERY PROTOCOL — Zéro copier-coller

## Objectif

Une livraison d’agent n’est jamais une série de fichiers affichés dans le chat.

Elle est un ZIP structuré, vérifiable et automatiquement applicable aux vrais
chemins du dépôt local.

## Les quatre espaces

```text
.agent/deliveries/
├── outbox/   # le ZIP produit dans la copie de l’agent
├── inbox/    # le ZIP téléchargé et déposé dans le repo principal
├── archive/  # copie brute locale après import, ignorée par Git
├── backups/  # fichiers locaux remplacés avant import, ignorés par Git
├── rejected/ # bundles refusés
└── records/  # trace légère versionnée avec le commit
```

## Contenu d’un bundle

```text
DEL-T-XXX-....zip
├── delivery.json
├── checksums.json
├── payload/
│   ├── files/<chemins réels du repo>
│   └── deletions.json
├── governance/
│   ├── state.json
│   ├── handoff.md
│   └── evidence/
└── changes/
    └── T-XXX.patch
```

## Côté agent

Le package envoyé à l’agent doit être créé depuis un working tree propre :

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\agent-package.ps1 `
  -TaskId T-001 `
  -Agent "sonnet-1"
```

Cette commande modifie uniquement la copie de staging et un reçu local ignoré par Git.
Elle ne modifie pas le manifeste suivi.

Après `agent-finish.ps1` :

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\agent-export-delivery.ps1 `
  -TaskId T-001 `
  -Agent "sonnet-1"
```

L’agent remet le ZIP produit dans `.agent/deliveries/outbox/`.

## Côté repo principal

### 1. Déposer le bundle

```powershell
Copy-Item "$HOME\Downloads\DEL-T-001-*.zip" ".agent\deliveries\inbox\"
```

### 2. Prévisualiser

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\agent-import-delivery.ps1 `
  -DeliveryZip ".agent\deliveries\inbox\DEL-T-001-....zip"
```

Sans `-Apply`, aucun fichier n’est modifié.

### 3. Appliquer

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\agent-import-delivery.ps1 `
  -DeliveryZip ".agent\deliveries\inbox\DEL-T-001-....zip" `
  -Apply
```

Le script :

1. contrôle les checksums du bundle ;
2. contrôle le `package_id` source ;
3. contrôle le périmètre autorisé de la tâche ;
4. compare le hash local de chaque fichier au hash de départ ;
5. refuse tout conflit ;
6. sauvegarde les fichiers remplacés ;
7. applique les ajouts, modifications et suppressions ;
8. importe état, handoff et preuves ;
9. archive le ZIP brut localement ;
10. crée un record léger à commiter.

### 4. Rejouer les gates localement

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\agent-validate-delivery.ps1 `
  -TaskId T-001
```

Les gates exécutés par l’agent ne remplacent jamais cette validation locale.

### 5. Approuver

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\agent-review.ps1 `
  -TaskId T-001 `
  -Reviewer "Samyr" `
  -Decision APPROVE
```

### 6. Préparer le commit sans prendre les autres changements

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\agent-stage-task.ps1 `
  -TaskId T-001
```

Puis :

```powershell
git diff --cached
git commit -m "chore(pdp): T-001 — préflight ownership, modules mobiles et fixture"
```

## Protection contre les conflits parallèles

Le bundle contient le SHA-256 de départ de chaque fichier touché.

Même si une autre tâche a été commitée entre-temps :

- un fichier non concerné ne bloque pas l’import ;
- un fichier concerné mais inchangé depuis la base peut être appliqué ;
- un fichier concerné modifié entre-temps provoque un rejet explicite.

Il n’y a donc jamais d’écrasement silencieux.

## Ce qui est versionné

À commiter :

- le code effectivement livré ;
- `.agent/state/<TASK_ID>.json` ;
- `.agent/handoffs/<TASK_ID>.md` ;
- `.agent/evidence/<TASK_ID>/` ;
- `.agent/changes/<TASK_ID>.patch` ;
- `.agent/deliveries/records/<DELIVERY_ID>/` ;
- le dashboard et le journal d’audit.

À ne pas commiter :

- les ZIP bruts ;
- les sauvegardes locales ;
- les bundles rejetés.


## Fichiers générés par les gates

Les fichiers `dist`, le bundle CSS et le cache-buster ne sont pas oubliés.

La liste centrale `.agent/GENERATED_OUTPUTS.json` s’ajoute au périmètre explicite de
chaque tâche. T-001 doit confirmer les vrais chemins produits par le repo et retirer
les motifs inutiles. Cette liste ne doit jamais servir à contourner l’ownership des
sources.
