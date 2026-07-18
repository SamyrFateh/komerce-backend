# Inbox

Déposer ici le ZIP de livraison téléchargé depuis l’agent.

Exemple :

```powershell
Copy-Item "$HOME\Downloads\DEL-T-001-*.zip" ".agent\deliveries\inbox\"
```

Ne jamais extraire manuellement le ZIP dans le repo. Utiliser
`scripts/agent-import-delivery.ps1`.
