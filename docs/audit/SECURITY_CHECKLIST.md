# 🔒 Checklist Sécurité Production — Komerce

> **D3 + D4 — Sprint UX+2**
> Actions manuelles requises avant go-live

---

## D3 — Changer le mot de passe admin

Le mot de passe par défaut (`Komerce2026!`) est codé dans `server.js` (migration `fixAdminHash()`).

### Méthode recommandée — Variable d'environnement

1. Dans **Railway → Settings → Variables**, ajouter :
   ```
   ADMIN_PASSWORD=VotreNouveauMotDePasse!Tr3sLong
   ```
2. Redéployer. La migration utilisera automatiquement ce mot de passe au lieu du défaut.

### ⚠️ Important
- Utilisez un mot de passe de **16+ caractères** avec majuscules, chiffres et symboles
- Ne jamais committer le mot de passe dans le code source
- Le mot de passe sera appliqué à chaque redémarrage du serveur

---

## D4 — JWT_SECRET unique en production

Le JWT_SECRET par défaut est dans le code — **tout le monde peut forger des tokens**.

### Étapes

1. Générer un secret aléatoire :
   ```bash
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   ```

2. Dans **Railway → Settings → Variables**, ajouter :
   ```
   JWT_SECRET=<le_secret_généré_ci-dessus>
   ```

3. Redéployer. Tous les tokens existants seront invalidés (les utilisateurs devront se reconnecter).

### ⚠️ Important
- Le secret doit faire **64+ caractères** aléatoires
- Ne jamais le committer dans le repo
- Changer le secret invalide toutes les sessions actives

---

## Variables d'environnement pour les emails (D2/BUG-017)

Pour activer l'envoi d'emails de confirmation de commande :

| Variable | Description | Exemple |
|----------|-------------|---------|
| `SMTP_HOST` | Serveur SMTP | `smtp.gmail.com` |
| `SMTP_PORT` | Port SMTP | `587` |
| `SMTP_USER` | Utilisateur SMTP | `noreply@komerce.km` |
| `SMTP_PASS` | Mot de passe SMTP / App Password | `xxxx-xxxx-xxxx-xxxx` |
| `SMTP_FROM` | Adresse expéditeur affichée | `Komerce <noreply@komerce.km>` |

> **Sans ces variables**, les emails sont simplement loggés en console (mode dev).
> Avec Gmail, utilisez un [App Password](https://myaccount.google.com/apppasswords).

---

## Autres variables recommandées

| Variable | Description | Défaut |
|----------|-------------|--------|
| `QR_SECRET` | Secret pour tokens QR de retrait | `komerce-qr-default...` (⚠️ changer) |
| `NODE_ENV` | Environnement | `development` |
| `FRONTEND_URL` | URL frontend pour CORS et emails | _(auto Railway)_ |

---

*Créé le 4 avril 2026 — Sprint UX+2 Tasklet*
