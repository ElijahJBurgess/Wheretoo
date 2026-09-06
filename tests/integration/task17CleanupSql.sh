#!/bin/sh

render_task17_cleanup_sql() {
  case "${TASK17_CLEANUP_FIXTURE_PREFIX-}" in
    task17_????????????) ;;
    *) return 1 ;;
  esac
  case "${TASK17_CLEANUP_CONNECTED_ACCOUNT_ID-}" in
    acct_*) ;;
    *) return 1 ;;
  esac
  case "${TASK17_CLEANUP_ONLY-}" in
    0|1) ;;
    *) return 1 ;;
  esac
  printf '%s' "$TASK17_CLEANUP_FIXTURE_PREFIX" |
    grep -Eq '^task17_[a-z0-9]{12}$' || return 1
  printf '%s' "$TASK17_CLEANUP_CONNECTED_ACCOUNT_ID" |
    grep -Eq '^acct_[A-Za-z0-9]+$' || return 1
  [ -r "${TASK17_CLEANUP_SQL_TEMPLATE-}" ] || return 1
  sed \
    -e "s/__TASK17_FIXTURE_PREFIX__/$TASK17_CLEANUP_FIXTURE_PREFIX/g" \
    -e "s/__TASK17_CONNECTED_ACCOUNT_ID__/$TASK17_CLEANUP_CONNECTED_ACCOUNT_ID/g" \
    -e "s/__TASK13_CLEANUP_ONLY__/$TASK17_CLEANUP_ONLY/g" \
    "$TASK17_CLEANUP_SQL_TEMPLATE"
}
