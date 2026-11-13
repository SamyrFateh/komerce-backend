#!/bin/bash
R=repos/SamyrFateh/komerce-backend
for n in 3968; do
  for t in $(seq 1 60); do
    st=$(gh api $R/pulls/$n --jq .mergeable_state)
    if [ "$st" = "behind" ]; then gh api -X PUT $R/pulls/$n/update-branch >/dev/null 2>&1; echo "$n update-branch"; sleep 90; continue; fi
    if [ "$st" = "clean" ]; then
      out=$(gh api -X PUT $R/pulls/$n/merge -f merge_method=squash 2>&1); sleep 5
      m=$(gh api $R/pulls/$n --jq .merged); echo "$n merge merged=$m"; [ "$m" = "true" ] && break
    fi
    if [ "$st" = "dirty" ]; then echo "$n CONFLICT"; exit 1; fi
    sleep 60
  done
  [ "$(gh api $R/pulls/$n --jq .merged)" = "true" ] || { echo "$n NOT MERGED (state $st)"; exit 1; }
done
echo ALL_MERGED $(gh api $R/commits/main --jq .sha)
