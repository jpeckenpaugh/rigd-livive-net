#!/usr/bin/env bash
# ==============================================================================
# train_asl.sh — End-to-end ASL Sign Pipeline Runner
#
# Downloads, extracts 30 fps keyframes, solves deterministic kinematic trajectories
# using bidirectional RL, and exports playable sequences directly into the 3D rig.
#
# Usage:
#   ./scripts/train_asl.sh <word> [word2 ...]
#   ./scripts/train_asl.sh water candy hello
#   ./scripts/train_asl.sh --fps 30 water,candy,hello
#   ./scripts/train_asl.sh --scorer-only father   # re-solve without re-downloading
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Terminal colors
BOLD=$(printf '\033[1m')
GREEN=$(printf '\033[0;32m')
SKY=$(printf '\033[0;36m')
AMBER=$(printf '\033[0;33m')
RED=$(printf '\033[0;31m')
NC=$(printf '\033[0m')

FPS=30
SCORER_ONLY=false
WORDS=()

print_usage() {
  cat << EOF
${BOLD}train_asl.sh${NC} — Automated ASL Sign Training & Kinematic Solver Pipeline

${BOLD}USAGE:${NC}
  ./scripts/train_asl.sh [OPTIONS] <word1> [word2 ...]

${BOLD}OPTIONS:${NC}
  --fps <n>         Keyframe extraction rate in fps (default: 30)
  --scorer-only     Skip video download/extraction; re-run kinematic trajectory solver only
  -h, --help        Show this help message and exit

${BOLD}EXAMPLES:${NC}
  ./scripts/train_asl.sh water
  ./scripts/train_asl.sh water candy hello
  ./scripts/train_asl.sh --fps 30 "water, candy, hello"
  ./scripts/train_asl.sh --scorer-only mother
EOF
}

# Parse command line flags & positional words
while [[ $# -gt 0 ]]; do
  case "$1" in
    --fps)
      if [[ -n "$2" && ! "$2" =~ ^-- ]]; then
        FPS="$2"
        shift 2
      else
        echo -e "${RED}[ERROR]${NC} --fps requires a numeric argument." >&2
        exit 1
      fi
      ;;
    --scorer-only)
      SCORER_ONLY=true
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    -*)
      echo -e "${RED}[ERROR]${NC} Unknown option: $1" >&2
      print_usage
      exit 1
      ;;
    *)
      # Handle comma-separated or space-separated items
      IFS=',' read -ra SPLIT <<< "$1"
      for token in "${SPLIT[@]}"; do
        clean=$(echo "$token" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
        if [[ -n "$clean" ]]; then
          WORDS+=("$clean")
        fi
      done
      shift
      ;;
  esac
done

if [[ ${#WORDS[@]} -eq 0 ]]; then
  echo -e "${RED}[ERROR]${NC} No ASL words specified to process." >&2
  echo ""
  print_usage
  exit 1
fi

echo -e "${BOLD}${SKY}========================================================================${NC}"
echo -e "${BOLD}${SKY}             CKPE Automated ASL Kinematic Training Pipeline            ${NC}"
echo -e "${BOLD}${SKY}========================================================================${NC}"
echo -e " Target Words : ${BOLD}${WORDS[*]}${NC}"
echo -e " Extraction   : ${BOLD}${FPS} fps${NC}"
echo -e " Mode         : $(if $SCORER_ONLY; then echo "${AMBER}Scorer / Kinematic Solver Only (Skip Ingestion)${NC}"; else echo "${GREEN}Full Pipeline (Download + Ingestion + RL Solver + Export)${NC}"; fi)"
echo ""

SUCCEEDED=()
FAILED=()

for word in "${WORDS[@]}"; do
  echo -e "${BOLD}------------------------------------------------------------------------${NC}"
  echo -e "${BOLD}${SKY}>>> Processing Sign: '${word}'${NC}"
  echo -e "${BOLD}------------------------------------------------------------------------${NC}"

  SIGN_DIR="data/asl/${word}"

  # Step 1: Ingestion / Download & Keyframe Extraction
  if [[ "$SCORER_ONLY" == false ]]; then
    echo -e "${SKY}[Step 1/2]${NC} Ingesting ASL-LEX video & extracting keyframes at ${FPS} fps..."
    if ! python3 scripts/prepare_asl_sign.py --sign "$word" --fps "$FPS"; then
      echo -e "${RED}[FAIL]${NC} Failed to prepare dataset for '${word}'." >&2
      FAILED+=("$word (Ingestion failed)")
      continue
    fi
  else
    if [[ ! -d "$SIGN_DIR" || ! -f "$SIGN_DIR/keyframes.json" ]]; then
      echo -e "${RED}[FAIL]${NC} Directory '${SIGN_DIR}' does not exist. Cannot run with --scorer-only." >&2
      FAILED+=("$word (Directory missing)")
      continue
    fi
    echo -e "${SKY}[Step 1/2]${NC} Skipping ingestion (--scorer-only). Using existing ${SIGN_DIR}..."
  fi

  # Step 2: Deterministic Trajectory Optimization & Sequence Export
  echo -e "${SKY}[Step 2/2]${NC} Solving kinematic trajectory with bidirectional RL policy optimizer..."
  if ! python3 scripts/rig_rl_scorer.py --sign-dir "$SIGN_DIR" --export-sequence; then
    echo -e "${RED}[FAIL]${NC} Kinematic trajectory optimization failed for '${word}'." >&2
    FAILED+=("$word (Solver failed)")
    continue
  fi

  echo -e "${GREEN}[SUCCESS]${NC} Successfully processed and exported '${word}'!"
  SUCCEEDED+=("$word")
  echo ""
done

# Final Summary Report
echo -e "${BOLD}${SKY}========================================================================${NC}"
echo -e "${BOLD}${SKY}                           Pipeline Summary                             ${NC}"
echo -e "${BOLD}${SKY}========================================================================${NC}"
echo -e " Total Requested : ${#WORDS[@]}"
echo -e " Succeeded       : ${GREEN}${#SUCCEEDED[@]}${NC}"
echo -e " Failed          : $(if [[ ${#FAILED[@]} -gt 0 ]]; then echo -e "${RED}${#FAILED[@]}${NC}"; else echo "0"; fi)"
echo ""

if [[ ${#SUCCEEDED[@]} -gt 0 ]]; then
  echo -e "${BOLD}Trained Signs Available in Viewer:${NC}"
  for s in "${SUCCEEDED[@]}"; do
    echo -e "  ${GREEN}✓${NC} ${BOLD}${s}${NC} -> sequences.json & data/asl/${s}/"
  done
  echo ""
  echo -e "To view in 3D:"
  echo -e "  1. Start local server: ${BOLD}python3 -m http.server 8000${NC}"
  echo -e "  2. Open: ${BOLD}http://localhost:8000/3d/${NC}"
  echo -e "  3. Select sign from the ${BOLD}Sequence${NC} or ${BOLD}Keyframe Overlay${NC} dropdown."
fi

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo ""
  echo -e "${RED}${BOLD}Failed Signs:${NC}"
  for f in "${FAILED[@]}"; do
    echo -e "  ${RED}✗${NC} ${f}"
  done
  exit 1
fi

exit 0
