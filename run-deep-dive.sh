#!/bin/bash
# Deep-dive: run 100 keywords per top pick, keep best 25, append to desktop file
BASEDIR="/mnt/1tb-ssd/random/keyword-planner"
LOG="$BASEDIR/output/deep-dive.log"
DESKTOP="/home/potts/Desktop/keyword-results.txt"
OUTDIR="$BASEDIR/output"
mkdir -p "$OUTDIR"

# Which category to run (pass as arg, or "all")
RUN_CATEGORY="${1:-all}"

CATEGORIES=(
  "french-drain-installation"
  "mobile-car-detailing"
  "pressure-washing"
  "junk-removal"
  "ceiling-fan-installation"
)

echo "=== Deep dive started at $(date) ===" >> "$LOG"

for CAT in "${CATEGORIES[@]}"; do
  # If specific category requested, skip others
  if [ "$RUN_CATEGORY" != "all" ] && [ "$RUN_CATEGORY" != "$CAT" ]; then
    continue
  fi

  JSON="$BASEDIR/deep-dive/${CAT}.json"
  if [ ! -f "$JSON" ]; then
    echo "SKIP: $JSON not found" >> "$LOG"
    continue
  fi

  CATCSV="$OUTDIR/deep-${CAT}.csv"
  echo "keyword,avg_monthly_searches,competition,cpc_low,cpc_high" > "$CATCSV"

  # Read keywords from JSON into batches of 10
  KEYWORDS=$(python3 -c "import json; kws=json.load(open('$JSON')); [print(','.join(kws[i:i+10])) for i in range(0,len(kws),10)]")
  BATCH_NUM=0
  TOTAL_BATCHES=$(echo "$KEYWORDS" | wc -l)

  echo "" >> "$LOG"
  echo "=== CATEGORY: $CAT ($TOTAL_BATCHES batches) ===" >> "$LOG"

  while IFS= read -r BATCH; do
    BATCH_NUM=$((BATCH_NUM + 1))
    echo "--- $CAT batch $BATCH_NUM/$TOTAL_BATCHES at $(date) ---" >> "$LOG"

    rm -f "$BASEDIR/chrome-profile/SingletonLock" "$BASEDIR/chrome-profile/SingletonCookie" 2>/dev/null

    OUTPUT=$(cd "$BASEDIR" && node planner.js --kw "$BATCH" 2>&1)
    EXIT_CODE=$?
    echo "$OUTPUT" >> "$LOG"
    echo "Exit code: $EXIT_CODE" >> "$LOG"

    CSV_FILE=$(echo "$OUTPUT" | grep "Results written to:" | sed 's/.*Results written to: //')
    if [ -n "$CSV_FILE" ] && [ -f "$CSV_FILE" ]; then
      tail -n +2 "$CSV_FILE" >> "$CATCSV"
      ROWS=$(tail -n +2 "$CSV_FILE" | wc -l)
      echo "$CAT batch $BATCH_NUM: $ROWS rows" >> "$LOG"
    fi

    sleep 3
  done <<< "$KEYWORDS"

  # Now pick best 25: sort by CPC low ascending, filter out ones with no CPC, take top 25
  BEST25="$OUTDIR/best25-${CAT}.csv"
  echo "keyword,avg_monthly_searches,competition,cpc_low,cpc_high" > "$BEST25"

  # Separate rows with CPC data vs without, sort by volume desc then CPC asc
  # Priority: has CPC + has volume
  tail -n +2 "$CATCSV" | awk -F',' '
    $4 != "—" && $4 != "" {
      # Extract numeric CPC for sorting
      cpc = $4; gsub(/\$/, "", cpc);
      # Volume priority: 1M=6, 100K=5, 10K=4, 1K=3, 100=2, 10=1
      vol = 0;
      if ($2 ~ /1M/) vol = 6;
      else if ($2 ~ /100K/) vol = 5;
      else if ($2 ~ /10K/) vol = 4;
      else if ($2 ~ /1K/) vol = 3;
      else if ($2 ~ /100/) vol = 2;
      else if ($2 ~ /10/) vol = 1;
      # Score: higher volume better, lower CPC better
      score = vol * 100 - cpc;
      print score "\t" $0;
    }
  ' | sort -t$'\t' -k1 -rn | head -25 | cut -f2- >> "$BEST25"

  # If we have less than 25 with CPC, fill with no-CPC rows that have volume
  CURRENT=$(tail -n +2 "$BEST25" | wc -l)
  if [ "$CURRENT" -lt 25 ]; then
    NEED=$((25 - CURRENT))
    tail -n +2 "$CATCSV" | awk -F',' '
      ($4 == "—" || $4 == "") && $2 != "—" && $2 != "" {
        vol = 0;
        if ($2 ~ /1M/) vol = 6;
        else if ($2 ~ /100K/) vol = 5;
        else if ($2 ~ /10K/) vol = 4;
        else if ($2 ~ /1K/) vol = 3;
        else if ($2 ~ /100/) vol = 2;
        else if ($2 ~ /10/) vol = 1;
        print vol "\t" $0;
      }
    ' | sort -t$'\t' -k1 -rn | head -"$NEED" | cut -f2- >> "$BEST25"
  fi

  TOTAL_BEST=$(tail -n +2 "$BEST25" | wc -l)
  echo "$CAT: Selected $TOTAL_BEST best keywords" >> "$LOG"

  # Append to desktop file
  {
    echo ""
    echo ""
    echo "╔══════════════════════════════════════════════════════════════════════════════════════════╗"
    TITLE=$(echo "$CAT" | tr '-' ' ' | sed 's/\b\(.\)/\u\1/g')
    printf "║  %-85s ║\n" "DEEP DIVE: $TITLE"
    printf "║  %-85s ║\n" "Top 25 of 100 keywords tested — Phoenix, AZ"
    echo "╚══════════════════════════════════════════════════════════════════════════════════════════╝"
    echo ""
    printf "%-45s %15s %12s %10s %10s\n" "KEYWORD" "VOLUME" "COMPETITION" "CPC LOW" "CPC HIGH"
    echo "─────────────────────────────────────────────────────────────────────────────────────────────"
    tail -n +2 "$BEST25" | while IFS=',' read -r kw vol comp clow chi; do
      printf "%-45s %15s %12s %10s %10s\n" "$kw" "$vol" "$comp" "$clow" "$chi"
    done
    echo "─────────────────────────────────────────────────────────────────────────────────────────────"
  } >> "$DESKTOP"

  echo "=== $CAT complete at $(date) ===" >> "$LOG"
done

echo "" >> "$LOG"
echo "=== Deep dive complete at $(date) ===" >> "$LOG"
echo "DONE" >> "$LOG"
