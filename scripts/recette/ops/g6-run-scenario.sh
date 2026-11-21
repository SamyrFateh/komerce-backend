#!/bin/bash
# Lance un scénario G6 (ouvre l issue owner-only, attend, relance une annulation à vide, extrait le verdict).
# Usage : g6-run-scenario.sh 0 <ID>-<MK> "<corps>"   (1er argument : PR à fusionner avant, ou 0)
cd "$(git rev-parse --show-toplevel)"
[ "$1" != 0 ] && { bash ${MERGE_SCRIPT:?MERGE_SCRIPT requis si PR fournie} $1 2>&1 | tail -1; sleep 60; }
gh api repos/SamyrFateh/komerce-backend/issues -f title="[staging-op] g6-dynamic-fresh-full-$2" -f body="$3" --jq .number
sleep 30; R=$(gh api "repos/SamyrFateh/komerce-backend/actions/workflows/staging-g6-dynamic-fresh-buyer-cash.yml/runs?per_page=1" --jq '.workflow_runs[0].id'); echo RUN=$R
for t in 1 2 3; do while :; do s=$(gh api repos/SamyrFateh/komerce-backend/actions/runs/$R --jq '.status+" "+(.conclusion//"")'); case "$s" in completed*) break;; esac; sleep 45; done
 n=$(gh api repos/SamyrFateh/komerce-backend/actions/runs/$R/jobs --jq .total_count)
 if [ "$s" = "completed cancelled" ] && [ "$n" = 0 ]; then echo "rerun empty cancel"; gh api -X POST repos/SamyrFateh/komerce-backend/actions/runs/$R/rerun >/dev/null; sleep 30; else break; fi; done
echo "$s"
gh api repos/SamyrFateh/komerce-backend/actions/jobs/$(gh api repos/SamyrFateh/komerce-backend/actions/runs/$R/jobs --jq '.jobs[0].id')/logs 2>/dev/null | grep -oE '"verdict":"[^"]*"|"reference":"K[A-Z0-9]{6}"|G6_[A-Z0-9_]{12,}[^ "]{0,200}' | grep -v "G6_TARGET\|G6_DYNAMIC_TO\|G6_CANONICAL_SC\|STAGING_SHA_DRIFT$" | uniq | head -25
