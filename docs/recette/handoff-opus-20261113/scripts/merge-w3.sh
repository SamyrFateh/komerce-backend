#!/bin/bash
R=repos/SamyrFateh/komerce-backend; n=3968; cd /home/claude/wt-W3
for t in $(seq 1 90); do
  st=$(gh api $R/pulls/$n --jq .mergeable_state)
  case "$st" in
    clean) gh api -X PUT $R/pulls/$n/merge -f merge_method=squash >/dev/null 2>&1; sleep 5
           [ "$(gh api $R/pulls/$n --jq .merged)" = "true" ] && { echo MERGED $(gh api $R/commits/main --jq .sha); exit 0; } ;;
    behind) gh api -X PUT $R/pulls/$n/update-branch >/dev/null 2>&1; echo update-branch; sleep 120; git fetch -q origin feat/local-stock-receipts && git reset -q --hard FETCH_HEAD ;;
    dirty) git fetch -q origin main; git merge --no-commit origin/main >/dev/null 2>&1
           u=$(git diff --name-only --diff-filter=U); bad=$(echo "$u" | grep -vE '^docs/(BUSINESS_FEATURE_GRAPH|KOMERCE_ARCH_HEADER_GRAPH|komerce-arch-header-graph|FEATURE_360|META_GRAPH|_generated/)' | grep .)
           [ -n "$bad" ] && { echo "REAL_CONFLICT $bad"; git merge --abort; exit 1; }
           git checkout --theirs $u; npm run -s business-graph:gen >/dev/null 2>&1; npm run -s arch:gen >/dev/null 2>&1
           git add -A docs; git commit -q -m "merge main into W3 (projections régénérées)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SwgRpiat6KjVtGnaB4GKZi" >/dev/null 2>&1 || { echo COMMIT_FAIL; exit 1; }
           npm run -s pr:preflight >/dev/null 2>&1 || { echo PREFLIGHT_FAIL; exit 1; }
           git push -q origin HEAD:feat/local-stock-receipts && echo resolved-pushed; sleep 60 ;;
    *) sleep 60 ;;
  esac
done; echo TIMEOUT
