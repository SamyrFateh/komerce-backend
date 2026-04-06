## 📋 Checklist avant merge

> ⚠️ **Aucune PR ne doit être mergée sans avoir coché TOUS les points ci-dessous.**

### 🗺️ Cartographie Coffre-Fort
- [ ] J'ai **consulté** [`docs/CARTOGRAPHY_360.md`](../docs/CARTOGRAPHY_360.md) avant de coder
- [ ] Les **endpoints modifiés/ajoutés** sont cohérents avec la carto
- [ ] Les **tables DB touchées** correspondent à la carto
- [ ] Si j'ai ajouté/modifié des endpoints ou tables : **j'ai mis à jour la carto dans cette PR**

### 🔒 Sécurité
- [ ] Pas de **secrets en dur** dans le code
- [ ] Les requêtes SQL sont **paramétrées** (pas de concaténation)
- [ ] Les routes sensibles ont **authenticate + requireRole**
- [ ] Les entrées utilisateur sont **validées** (Joi / validate middleware)

### 🧪 Qualité
- [ ] Le code a été **testé localement**
- [ ] Pas de `console.log` de debug restant
- [ ] Les erreurs sont gérées avec **try/catch**

---

**📦 Fichiers modifiés** :
<!-- Listez les fichiers modifiés et leur impact -->

**🎯 Endpoints impactés** :
<!-- Listez les endpoints créés/modifiés/supprimés -->

**🗄️ Tables DB impactées** :
<!-- Listez les tables touchées -->
