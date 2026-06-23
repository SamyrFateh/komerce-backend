# Komerce — Plan de Rollback

> Document F5 — Procédures de rollback prod et signaux de déclenchement.
> Mis à jour : 2026-06-23.

---

## 1. Rollback applicatif (Railway)

### Redéployer N-1

Railway conserve l'historique des déploiements. Depuis le dashboard :

1. Aller sur **railway.app → projet Komerce → service backend**
2. Onglet **Deployments**
3. Cliquer sur le déploiement précédent (N-1) → **Redeploy**

Railway arrête le container actuel, repart du snapshot N-1 (même image Docker, même release command). Durée typique : 30-90 secondes.

En CLI Railway :

```bash
railway deployments       # liste les déploiements
railway rollback          # rollback vers le déploiement précédent
```

### Signaux déclencheurs d'un rollback applicatif

| Signal | Seuil | Action |
|--------|-------|--------|
| Taux d'erreur HTTP 5xx | > 5% sur 5 min | Rollback immédiat |
| `/health` retourne `status: degraded` | Persistant > 2 min | Investiguer puis rollback |
| `/health/detailed` → Stripe error | Persistant > 5 min | Vérifier clé Stripe, rollback si clé OK |
| Webhook Stripe silencieux | > 30 min sans event | Vérifier Railway logs, rollback si déploiement récent |
| Temps de réponse moyen | > 3s sur `/api/orders` | Investiguer, rollback si déploiement récent |

---

## 2. Rollback de migration DB

**Les migrations Komerce sont irréversibles par défaut** (`ADD COLUMN`, `CREATE TABLE`, `CREATE INDEX`). Un rollback DB nécessite une migration de correction, pas un `DROP`.

### Procédure

1. **Ne jamais rollback Railway sans avoir lu les logs de migration** — `node scripts/migrate.js` tourne à chaque déploiement (railway.toml `releaseCommand`)
2. Si une migration a planté → le déploiement Railway est en échec, l'ancienne version tourne encore
3. Si une migration a réussi mais casse un flow → écrire une migration corrective `NNN_revert_xxx.sql`
4. Toujours tester la migration corrective sur une DB de staging avant

### Migrations safe à rollback

| Type | Rollback possible | Comment |
|------|-------------------|---------|
| `ADD COLUMN IF NOT EXISTS` | ✅ via `ALTER TABLE ... DROP COLUMN` | Sans données critiques |
| `CREATE TABLE IF NOT EXISTS` | ✅ via `DROP TABLE IF EXISTS` | Si vide |
| `CREATE INDEX` | ✅ via `DROP INDEX` | Sans impact data |
| `ALTER TYPE ADD VALUE` (ENUM) | ❌ impossible en PG | Prévenir en amont |
| `UPDATE` de données | ❌ irréversible | Toujours avec backup préalable |

---

## 3. Backup DB

Voir section backup DB dans [STATUS.md](chantier/STATUS.md) et audit F6.

Railway PostgreSQL effectue des backups automatiques. Pour restaurer :

```bash
# Depuis Railway dashboard : Database → Backups → Restore
# Ou via CLI :
railway db restore --backup-id <id>
```

---

## 4. Checklist pré-rollback

Avant tout rollback :

- [ ] Lire les logs Railway du déploiement fautif (`railway logs`)
- [ ] Vérifier `/health/detailed` pour identifier la dépendance en échec
- [ ] Confirmer que le problème est lié au dernier déploiement (pas un incident tiers Stripe/PayPal/WhatsApp)
- [ ] Prévenir l'équipe (Slack / WhatsApp admin)
- [ ] Documenter le rollback (date, raison, version cible)

---

## 5. Contacts d'urgence

- Railway status : https://railway.app/status
- Stripe status : https://status.stripe.com
- PayPal status : https://www.paypal-status.com
