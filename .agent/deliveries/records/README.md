# Records versionnés

Chaque livraison importée crée un dossier :

```text
records/<DELIVERY_ID>/
├── delivery.json
├── checksums.json
├── import-report.json
└── task.patch
```

Ces fichiers sont légers et doivent être commités. Ils permettent de retrouver :

- le package source ;
- l’agent et la tâche ;
- les fichiers ajoutés, modifiés ou supprimés ;
- les hashes avant/après ;
- le résultat de l’import ;
- le patch original.
