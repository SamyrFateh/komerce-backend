#!/bin/bash
# À exécuter APRÈS avoir extrait komerce_session_patches.zip dans le repo
# Supprime les copies mortes public/admin/ et public/admin-legacy/

echo "Suppression des copies mortes..."
rm -rf public/admin public/admin-legacy
echo "✅ public/admin/ et public/admin-legacy/ supprimés"
echo ""
echo "Vérification rapide :"
echo -n "  @unknown restants : "
grep -rn "@db-write.*@unknown\|@db-read.*@unknown" --include="*.js" 2>/dev/null | wc -l
echo -n "  features avec security : "
grep -rl "security:" features/*.feature.js 2>/dev/null | wc -l
echo ""
echo "✅ Merge complet."
