#!/usr/bin/env bash
# Outillage de charge externe : installation locale, jamais dans public/.
set -euo pipefail
if ! command -v go >/dev/null 2>&1; then
  echo 'Go est requis pour installer k6 v0.56.0 (https://grafana.com/docs/k6/latest/set-up/install-k6/).' >&2
  exit 1
fi
go install go.k6.io/k6@v0.56.0
printf 'k6 v0.56.0 est installé dans %s (ou GOPATH/bin).\n' "$(go env GOBIN)"
