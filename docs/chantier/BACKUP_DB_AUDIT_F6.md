# Audit F6 — Backup DB (2026-06-23)

## Résultat : ✅ Couvert par Railway — vérification manuelle à faire en prod

---

## Ce que Railway fournit

Railway PostgreSQL (service managé) inclut des **backups automatiques quotidiens** conservés 7 jours. Consultables depuis :

> railway.app → projet → service Database → onglet **Backups**

Fonctionnalités disponibles :
- Restore via dashboard en un clic (crée une nouvelle DB à partir du snapshot)
- Restore via CLI : `railway db restore --backup-id <id>`
- Export manuel : `railway db export` → dump `.sql`

---

## Point d'attention

Railway ne garantit pas les RPO/RTO dans les plans gratuits. Sur un plan payant (Pro), la fréquence est améliorée. À vérifier selon le plan actuel.

**Action recommandée (à faire par le propriétaire) :**

1. Se connecter au dashboard Railway
2. Vérifier que le service DB est bien en mode **PostgreSQL managé** (pas custom)
3. Confirmer que l'onglet Backups affiche des snapshots récents (< 24h)
4. Tester une restauration sur un service de staging Railway séparé

---

## Backup manuel ponctuel

```bash
# Dump complet via pg_dump
railway run pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql

# Ou via psql
pg_dump $(railway variables --json | jq -r .DATABASE_URL) -Fc -f backup.dump
```

---

## Fréquence recommandée

| Contexte | Fréquence backup | Rétention |
|----------|-----------------|-----------|
| Pré-déploiement critique | Manuel immédiat | Permanent |
| Production normale | Daily automatique Railway | 7 jours |
| Avant migration DB | Manuel + vérification | 30 jours |

La migration runner (`scripts/migrate.js`) tourne comme `releaseCommand` Railway — un backup avant déploiement est donc recommandé pour toute PR qui touche `migrations/`.
