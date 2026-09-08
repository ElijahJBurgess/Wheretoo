#!/usr/bin/env bash
set -euo pipefail
# Set only after the owner approves this exact shared development run.
if [[ "${CORE_TICKET_LITE_SHARED_APPROVED:-}" != 1 ]]; then
  printf '%s\n' 'Shared proof requires owner approval: temporary driver deployment, Auth/Stripe fixtures, and checkout switch window.' >&2
  exit 78
fi
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$repository_root"
CORE_TICKET_LITE_PROOF=1 TASK14_BROWSER_PROJECT=desktop-chromium \
  tests/integration/run-stripe-ticketing-proof.sh
