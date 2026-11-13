#!/bin/bash
# usage: merge-list.sh PR...  (update-branch -> attendre clean -> squash -> vérifier merged ; stop sur conflit)
R=repos/SamyrFateh/komerce-backend
busy(){ (gh api "$R/actions/runs?status=in_progress&per_page=50" --jq '.workflow_runs[] | .name') | grep -ciE "staging|chromium|g6|recette"; }
for n in "$@"; do
  [ "$(gh api $R/pulls/$n --jq .draft)" = "true" ] && gh api -X POST $R/pulls/$n/ccr/ready_for_review >/dev/null 2>&1
  for t in $(seq 1 80); do
    st=$(gh api $R/pulls/$n --jq .mergeable_state)
    case "$st" in
      clean) [ "$(busy)" != "0" ] && { sleep 60; continue; }
             gh api -X PUT $R/pulls/$n/merge -f merge_method=squash >/dev/null 2>&1; sleep 5
             [ "$(gh api $R/pulls/$n --jq .merged)" = "true" ] && { echo "$n MERGED"; break; } ;;
      behind) gh api -X PUT $R/pulls/$n/update-branch >/dev/null 2>&1; echo "$n update-branch"; sleep 120 ;;
      dirty) echo "$n CONFLICT"; exit 1 ;;
      *) sleep 60 ;;
    esac
  done
  [ "$(gh api $R/pulls/$n --jq .merged)" = "true" ] || { echo "$n NOT MERGED ($st)"; exit 1; }
done
echo DONE $(gh api $R/commits/main --jq .sha)
