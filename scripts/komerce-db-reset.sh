#!/usr/bin/env bash
# Retired: remote reset must use the pinned, owner-confirmed staging workflow.
set -eu
printf '%s\n' 'Retired. Use GitHub Actions: staging-reset.yml (dry-run, then explicit owner-approved execute).' >&2
exit 1
