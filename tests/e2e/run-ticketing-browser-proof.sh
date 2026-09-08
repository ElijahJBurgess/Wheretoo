#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$repository_root"

# Reuse Task 13's development/TEST admission, stable fixture, driver materialization,
# checkout switch restoration and exact audit-tombstone cleanup. One payment per
# lifecycle keeps the canonical three-ticket/one-refund cleanup bounds intact.
for browser_project in mobile-chromium desktop-chromium; do
  TASK14_BROWSER_PROJECT="$browser_project" \
    tests/integration/run-stripe-ticketing-proof.sh
done

printf '%s\n' 'Task 14 buyer browser proof and exact cleanup passed; TEST connected account preserved.'
