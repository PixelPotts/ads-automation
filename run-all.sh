#!/bin/bash
LOG="/mnt/1tb-ssd/random/keyword-planner/output/full-run.log"
CSV="/mnt/1tb-ssd/random/keyword-planner/output/phoenix-all.csv"
DESKTOP="/home/potts/Desktop/keyword-results.txt"
mkdir -p /mnt/1tb-ssd/random/keyword-planner/output

echo "=== Full run started at $(date) ===" > "$LOG"
echo "keyword,avg_monthly_searches,competition,cpc_low,cpc_high" > "$CSV"

BATCHES=(
  "junk removal service,furniture removal service,appliance removal service,construction debris removal,yard waste removal,hot tub removal service,shed removal service,deck removal service,mattress removal service,garage cleanout service"
  "estate cleanout service,foreclosure cleanout service,hoarder cleanout service,commercial junk removal,dumpster loading service,furniture delivery service,appliance delivery service,building material delivery,gravel delivery service,mulch delivery service"
  "firewood delivery service,small load moving service,single item movers,heavy item moving service,piano moving service,lawn mowing service,bush trimming service,tree stump removal,stump grinding service,brush clearing service"
  "lot clearing service,fence removal service,fence installation service,sod installation service,landscape grading service,french drain installation,retaining wall installation,paver installation service,gravel driveway installation,landscape rock delivery"
  "pressure washing service,driveway pressure washing,deck pressure washing,fence pressure washing,house washing service,commercial pressure washing,concrete cleaning service,parking lot cleaning service,graffiti removal service,fleet washing service"
  "concrete pouring service,sidewalk repair service,small concrete jobs,concrete pad installation,concrete demolition service,patio installation service,brick repair service,mailbox installation service,concrete sealing service,curb painting service"
  "handyman service near me,door installation service,window installation service,screen repair service,gutter cleaning service,gutter installation service,exterior painting service,deck staining service,power outlet installation,ceiling fan installation"
  "drywall repair service,tile installation service,flooring installation service,toilet installation service,water heater installation,parking lot striping,bollard installation,sign installation service,commercial painting service,warehouse cleaning service"
  "storage unit cleanout,light fixture installation,office furniture assembly,commercial door repair,ADA ramp installation,handrail installation,wheelchair ramp installation,loading dock repair,speed bump installation,safety bollard installation"
  "snow removal service,ice dam removal service,leaf removal service,holiday light installation,trampoline removal service,swing set removal,above ground pool removal,mobile car detailing,boat hauling service,trailer hauling service"
)

TOTAL=${#BATCHES[@]}

for i in "${!BATCHES[@]}"; do
  BATCH_NUM=$((i + 1))
  echo "" >> "$LOG"
  echo "--- BATCH $BATCH_NUM/$TOTAL starting at $(date) ---" >> "$LOG"

  rm -f /mnt/1tb-ssd/random/keyword-planner/chrome-profile/SingletonLock /mnt/1tb-ssd/random/keyword-planner/chrome-profile/SingletonCookie 2>/dev/null

  OUTPUT=$(cd /mnt/1tb-ssd/random/keyword-planner && node planner.js --kw "${BATCHES[$i]}" 2>&1)
  EXIT_CODE=$?

  echo "$OUTPUT" >> "$LOG"
  echo "Exit code: $EXIT_CODE" >> "$LOG"

  CSV_FILE=$(echo "$OUTPUT" | grep "Results written to:" | sed 's/.*Results written to: //')
  if [ -n "$CSV_FILE" ] && [ -f "$CSV_FILE" ]; then
    tail -n +2 "$CSV_FILE" >> "$CSV"
    ROWS=$(tail -n +2 "$CSV_FILE" | wc -l)
    echo "BATCH $BATCH_NUM: Appended $ROWS rows" >> "$LOG"

    # Update desktop file with latest results
    {
      echo "╔══════════════════════════════════════════════════════════════════════════════════════════╗"
      echo "║                    PHOENIX AZ — KEYWORD PLANNER RESULTS                                ║"
      echo "║                    Low CPC + High Volume + Good Conversion                              ║"
      echo "╠══════════════════════════════════════════════════════════════════════════════════════════╣"
      echo "║  Batch $BATCH_NUM/$TOTAL complete — $(tail -n +2 "$CSV" | wc -l) keywords scraped so far                                    ║"
      echo "╚══════════════════════════════════════════════════════════════════════════════════════════╝"
      echo ""
      printf "%-40s %15s %12s %10s %10s\n" "KEYWORD" "VOLUME" "COMPETITION" "CPC LOW" "CPC HIGH"
      echo "────────────────────────────────────────────────────────────────────────────────────────────"
      # Sort by CPC low (column 4) ascending, show all results
      tail -n +2 "$CSV" | sort -t',' -k4 -V | while IFS=',' read -r kw vol comp clow chi; do
        printf "%-40s %15s %12s %10s %10s\n" "$kw" "$vol" "$comp" "$clow" "$chi"
      done
      echo ""
      echo "────────────────────────────────────────────────────────────────────────────────────────────"
      echo "★ TOP PICKS (volume 100+ AND CPC under \$5):"
      echo "────────────────────────────────────────────────────────────────────────────────────────────"
      tail -n +2 "$CSV" | sort -t',' -k4 -V | while IFS=',' read -r kw vol comp clow chi; do
        # Filter: has a dollar CPC under $5 and volume is not tiny
        if echo "$clow" | grep -q '^\$[0-4]\.' && echo "$vol" | grep -qE '(100|1K|10K|100K|1M)'; then
          printf "%-40s %15s %12s %10s %10s\n" "$kw" "$vol" "$comp" "$clow" "$chi"
        fi
      done
    } > "$DESKTOP"
  else
    echo "BATCH $BATCH_NUM: WARNING - no CSV file found" >> "$LOG"
  fi

  echo "--- BATCH $BATCH_NUM complete at $(date) ---" >> "$LOG"

  # Pause between batches
  if [ $BATCH_NUM -lt $TOTAL ]; then
    sleep 3
  fi
done

echo "" >> "$LOG"
echo "=== All $TOTAL batches complete at $(date) ===" >> "$LOG"

# Final update to desktop file
{
  echo "╔══════════════════════════════════════════════════════════════════════════════════════════╗"
  echo "║                    PHOENIX AZ — KEYWORD PLANNER RESULTS  ✓ COMPLETE                    ║"
  echo "║                    $(tail -n +2 "$CSV" | wc -l) keywords scraped                                                      ║"
  echo "╚══════════════════════════════════════════════════════════════════════════════════════════╝"
  echo ""
  printf "%-40s %15s %12s %10s %10s\n" "KEYWORD" "VOLUME" "COMPETITION" "CPC LOW" "CPC HIGH"
  echo "────────────────────────────────────────────────────────────────────────────────────────────"
  tail -n +2 "$CSV" | sort -t',' -k4 -V | while IFS=',' read -r kw vol comp clow chi; do
    printf "%-40s %15s %12s %10s %10s\n" "$kw" "$vol" "$comp" "$clow" "$chi"
  done
  echo ""
  echo "════════════════════════════════════════════════════════════════════════════════════════════"
  echo "★ TOP PICKS (volume 100+ AND CPC under \$5):"
  echo "════════════════════════════════════════════════════════════════════════════════════════════"
  tail -n +2 "$CSV" | sort -t',' -k4 -V | while IFS=',' read -r kw vol comp clow chi; do
    if echo "$clow" | grep -q '^\$[0-4]\.' && echo "$vol" | grep -qE '(100|1K|10K|100K|1M)'; then
      printf "%-40s %15s %12s %10s %10s\n" "$kw" "$vol" "$comp" "$clow" "$chi"
    fi
  done
  echo ""
  echo "CSV: /mnt/1tb-ssd/random/keyword-planner/output/phoenix-all.csv"
} > "$DESKTOP"

echo "DONE" >> "$LOG"
