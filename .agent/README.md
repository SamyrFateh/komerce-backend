# Gouvernance agents — Komerce PDP V2

## Ce qui change

Le chat n’est plus un canal de livraison de fichiers.

L’agent produit un bundle ZIP structuré. Tu le déposes dans l’inbox du repo, puis
les scripts vérifient et appliquent les fichiers aux bons chemins.

## Circuit quotidien

### Envoyer une tâche

```powershell
.\scripts\agent-package.ps1 -TaskId T-001 -Agent "sonnet-1"
```

Le script exige par défaut un working tree propre et ne crée aucun changement suivi
dans Git.

### Recevoir la livraison

Déposer le ZIP dans :

```text
.agent/deliveries/inbox/
```

### Prévisualiser puis appliquer

```powershell
.\scripts\agent-import-delivery.ps1 -DeliveryZip ".agent\deliveries\inbox\DEL-T-001-....zip"
.\scripts\agent-import-delivery.ps1 -DeliveryZip ".agent\deliveries\inbox\DEL-T-001-....zip" -Apply
```

### Rejouer les gates

```powershell
.\scripts\agent-validate-delivery.ps1 -TaskId T-001
```

### Approuver et préparer le commit

```powershell
.\scripts\agent-review.ps1 -TaskId T-001 -Reviewer "Samyr" -Decision APPROVE
.\scripts\agent-stage-task.ps1 -TaskId T-001
git diff --cached
git commit -m "chore(pdp): T-001 — préflight ownership, modules mobiles et fixture"
```

## Pourquoi rien ne se perd

- Le code est appliqué dans ses vrais chemins.
- Les anciennes versions sont sauvegardées avant import.
- Le bundle brut est archivé localement.
- Le manifeste, les hashes, le patch, le handoff et les preuves sont commités.
- Un conflit de fichier bloque l’import avant tout écrasement.

Lire `.agent/DELIVERY_PROTOCOL.md` pour le protocole complet.
