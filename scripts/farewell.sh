#!/usr/bin/env bash
# Research-Claw exit farewell screen.
# Rendered by run.sh after the gateway's shutdown logs when the user presses Ctrl+C.
# Shows: this-run usage overview, next update/start hints (per platform),
# current version, and a thank-you line.
#
# Inputs (env, all optional — every one has a safe fallback):
#   RC_RUN_START_EPOCH   run start, Unix seconds (no usage/duration if unset)
#   RC_VERSION           version string (falls back to package.json)
#   RC_SESSIONS_DIR      session jsonl dir (falls back to OpenClaw default)
#   RC_REPO_ROOT         repo root for command hints (falls back to script's repo)
#   RC_NODE              node binary to run the usage helper (default: node)
#   RC_PLATFORM_OVERRIDE force platform label (test hook): docker|macOS|WSL2|Linux
#
# This script must NEVER fail the caller: all work is best-effort.

set +e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${RC_REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
NODE_BIN="${RC_NODE:-node}"

# --- Colors (only on a real terminal) ---
if [ -t 1 ]; then
  R='\033[38;2;239;68;68m' B='\033[1m' D='\033[2m' C='\033[38;2;59;130;246m' N='\033[0m'
else
  R='' B='' D='' C='' N=''
fi

# --- Helpers ---
group() { # thousands separators: 12345 -> 12,345 (portable, no sed)
  local s="$1" sign='' out=''
  case "$s" in -*) sign='-'; s="${s#-}" ;; esac
  case "$s" in ''|*[!0-9]*) printf '%s' "$1"; return ;; esac
  while [ "${#s}" -gt 3 ]; do
    out=",${s: -3}${out}"
    s="${s:0:${#s}-3}"
  done
  printf '%s%s%s' "$sign" "$s" "$out"
}

fmt_duration() { # seconds -> "1h 23m 45s" (drops leading zero units)
  local s=$1 h m
  [ -z "$s" ] && { printf -- '-'; return; }
  h=$(( s / 3600 )); m=$(( (s % 3600) / 60 )); s=$(( s % 60 ))
  if [ "$h" -gt 0 ]; then printf '%dh %dm %ds' "$h" "$m" "$s"
  elif [ "$m" -gt 0 ]; then printf '%dm %02ds' "$m" "$s"
  else printf '%ds' "$s"; fi
}

detect_platform() {
  if [ -n "$RC_PLATFORM_OVERRIDE" ]; then printf '%s' "$RC_PLATFORM_OVERRIDE"; return; fi
  if [ -f /.dockerenv ]; then printf 'docker'; return; fi
  case "$(uname -s 2>/dev/null)" in
    Darwin) printf 'macOS' ;;
    Linux)
      if grep -qi microsoft /proc/version 2>/dev/null; then printf 'WSL2'; else printf 'Linux'; fi ;;
    *) printf 'unknown' ;;
  esac
}

# --- Version ---
VERSION="$RC_VERSION"
if [ -z "$VERSION" ] && [ -f "$REPO_ROOT/package.json" ]; then
  VERSION="$("$NODE_BIN" -e "try{process.stdout.write(require('$REPO_ROOT/package.json').version||'')}catch{}" 2>/dev/null)"
fi
[ -z "$VERSION" ] && VERSION="?"

# --- Sessions dir ---
SESSIONS_DIR="${RC_SESSIONS_DIR:-${OPENCLAW_STATE_DIR:-$HOME/.openclaw}/agents/main/sessions}"

# --- Banner ---
printf "\n${R}"
cat <<'ART'
     ____                 _ _
    / ___| ___   ___   __| | |__  _   _  ___
   | |  _ / _ \ / _ \ / _` | '_ \| | | |/ _ \
   | |_| | (_) | (_) | (_| | |_) | |_| |  __/
    \____|\___/ \___/ \__,_|_.__/ \__, |\___|
                                  |___/
ART
printf "${N}\n"

# --- Block 1: this-run usage ---
printf "  ${B}── 本次运行 ─────────────────────────${N}\n"
if [ -n "$RC_RUN_START_EPOCH" ]; then
  NOW=$(date +%s)
  ELAPSED=$(( NOW - RC_RUN_START_EPOCH ))
  [ "$ELAPSED" -lt 0 ] && ELAPSED=0
  printf "   运行时长   ${B}%s${N}\n" "$(fmt_duration "$ELAPSED")"

  RC_U_IN=0 RC_U_OUT=0 RC_U_CACHE=0 RC_U_REASON=0 RC_U_COST=0 RC_U_SESSIONS=0 RC_U_MESSAGES=0
  START_MS=$(( RC_RUN_START_EPOCH * 1000 ))
  USAGE_SH="$("$NODE_BIN" "$SCRIPT_DIR/farewell-usage.mjs" --sh "$SESSIONS_DIR" "$START_MS" 2>/dev/null)"
  case "$USAGE_SH" in
    RC_U_IN=*) eval "$USAGE_SH" ;;  # only eval our own well-formed numeric output
  esac

  TOTAL=$(( RC_U_IN + RC_U_OUT ))
  printf "   活跃会话   %s\n" "$RC_U_SESSIONS"
  printf "   Token 用量 ${B}%s${N}  ${D}(输入 %s / 输出 %s)${N}\n" \
    "$(group "$TOTAL")" "$(group "$RC_U_IN")" "$(group "$RC_U_OUT")"
  if [ "${RC_U_CACHE:-0}" -gt 0 ] 2>/dev/null; then
    printf "   缓存命中   ${D}%s${N}\n" "$(group "$RC_U_CACHE")"
  fi
  # cost.total is summed from session usage; unit follows model provider config.
  COST_FMT="$("$NODE_BIN" -e "const c=Number(process.argv[1]||0);process.stdout.write(c>0?c.toFixed(4):'0.00')" "$RC_U_COST" 2>/dev/null)"
  [ -z "$COST_FMT" ] && COST_FMT="0.00"
  printf "   预估花费   %s\n" "$COST_FMT"
else
  printf "   ${D}(本次运行用量不可用)${N}\n"
fi
printf "\n"

# --- Block 2: next update / start (per platform) ---
PLATFORM="$(detect_platform)"
printf "  ${B}── 下次启动 (检测到: %s) ─────────────${N}\n" "$PLATFORM"
case "$PLATFORM" in
  docker)
    printf "   更新   ${C}docker compose pull && docker compose up -d${N}\n"
    printf "   ${D}提示   Ctrl+C 仅停止当前容器；后台运行请用 -d${N}\n"
    ;;
  *)
    printf "   更新   ${C}bash scripts/update-research-claw.sh${N}\n"
    printf "   启动   ${C}pnpm serve${N}\n"
    printf "   ${D}Windows 原生用户：scripts\\\\update-research-claw.ps1${N}\n"
    ;;
esac
printf "\n"

# --- Block 3: version (offline) ---
printf "  ${B}── 版本 ─────────────────────────────${N}\n"
printf "   当前       ${B}v%s${N}\n" "$VERSION"
printf "   ${D}检查更新   设置 → 关于，或运行 update-research-claw 脚本${N}\n"
printf "\n"

# --- Block 4: thank you ---
printf "  ${R}感谢您使用科研龙虾，24/7 本地运行，一切产出专属于你。${N}\n\n"

exit 0
