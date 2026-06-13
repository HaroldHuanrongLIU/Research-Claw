#!/usr/bin/env bash
# Research-Claw — zero-dependency secret scanner.
# Blocks plaintext credentials from reaching GitHub / Gitee.
#
# Usage:
#   scripts/secret-scan.sh --staged          # scan staged changes        (pre-commit)
#   scripts/secret-scan.sh --range A B        # scan files changed A..B     (pre-push)
#   scripts/secret-scan.sh --all              # scan whole tracked tree     (CI backstop)
#   scripts/secret-scan.sh FILE...            # scan specific files
#
# Exit 0 = clean, 1 = secret found. Accepted exceptions live in scripts/.secret-scan-allow.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || exit 2
ALLOW_FILE="scripts/.secret-scan-allow"

# High-confidence, prefix-anchored patterns — keeps false positives near zero.
PATTERNS='(-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-ant-[A-Za-z0-9_-]{20,}|sk-[a-zA-Z0-9]{32,}|AIza[0-9A-Za-z_-]{35}|[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})'
# Lines matching any of these are treated as safe (placeholders / fixtures / explicit allow).
SAFE='__OPENCLAW_REDACTED__|REDACTED|pragma: allowlist secret|EXAMPLE|placeholder|YOUR_|<your|changeme|sk-FAKE|sk-TEST|sk-xxx|0000000000000000|abcdefghijklmnopqrstuvwxyz'

is_allowed() {
  local f="$1" pat
  [ -f "$ALLOW_FILE" ] || return 1
  while IFS= read -r pat || [ -n "$pat" ]; do
    pat="${pat%%#*}"
    pat="$(printf '%s' "$pat" | tr -d '[:space:]')"
    [ -z "$pat" ] && continue
    # shellcheck disable=SC2254
    case "$f" in $pat) return 0 ;; esac
  done < "$ALLOW_FILE"
  return 1
}

collect_files() {
  case "${1:-}" in
    --staged) git diff --cached --name-only --diff-filter=ACM ;;
    --range)  git diff --name-only --diff-filter=ACM "$2..$3" ;;
    --all)    git ls-files ;;
    *)        printf '%s\n' "$@" ;;
  esac
}

mask() {
  sed -E 's/(sk-ant-[A-Za-z0-9]{6}|sk-[a-zA-Z0-9]{6}|AIza.{6}|[0-9]{6}:AA[A-Za-z0-9_-]{4}|gh[pousr]_[A-Za-z0-9]{6}|AKIA[0-9A-Z]{4}|xox.-[A-Za-z0-9]{4})[A-Za-z0-9_:/+.-]+/\1…REDACTED/g'
}

found=0
report=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  [ -f "$f" ] || continue
  is_allowed "$f" && continue
  hits="$(grep -nIE "$PATTERNS" "$f" 2>/dev/null | grep -vIE "$SAFE" || true)"
  if [ -n "$hits" ]; then
    found=1
    report="${report}
--- ${f} ---
$(printf '%s' "$hits" | mask)"
  fi
done <<EOF
$(collect_files "$@")
EOF

if [ "$found" -eq 1 ]; then
  {
    echo "🛑 secret-scan: 检测到疑似明文密钥,已阻止本次操作。"
    printf '%s\n' "$report"
    echo ""
    echo "误报处理:在 ${ALLOW_FILE} 加入该路径,或在该行尾加注释 'pragma: allowlist secret'。"
    echo "紧急绕过(不推荐):git commit/push --no-verify"
  } >&2
  exit 1
fi
echo "secret-scan: 未发现明文密钥 ✓"
exit 0
