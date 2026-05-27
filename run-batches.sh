#!/bin/bash
# Run keyword planner in batches of 10, appending results to a log file
LOG="/mnt/1tb-ssd/random/ads-automation/output/batch-run.log"
RESULTS="/mnt/1tb-ssd/random/ads-automation/output/all-services.csv"
mkdir -p /mnt/1tb-ssd/random/ads-automation/output

echo "=== Batch run started at $(date) ===" > "$LOG"
echo "keyword,avg_monthly_searches,competition,cpc_low,cpc_high" > "$RESULTS"

KEYWORDS=(
  "junk removal service,furniture removal service,appliance removal service,construction debris removal,yard waste removal,hot tub removal service,shed removal service,deck removal service,mattress removal service,garage cleanout service"
  "estate cleanout service,foreclosure cleanout service,hoarder cleanout service,commercial junk removal,dumpster loading service,furniture delivery service,appliance delivery service,building material delivery,gravel delivery service,mulch delivery service"
  "firewood delivery service,small load moving service,single item movers,heavy item moving service,piano moving service,lawn mowing service,bush trimming service,tree stump removal,stump grinding service,brush clearing service"
)

for i in "${!KEYWORDS[@]}"; do
  BATCH_NUM=$((i + 1))
  echo "" >> "$LOG"
  echo "--- BATCH $BATCH_NUM/3 starting at $(date) ---" >> "$LOG"

  # Clean stale locks
  rm -f /mnt/1tb-ssd/random/ads-automation/chrome-profile/SingletonLock /mnt/1tb-ssd/random/ads-automation/chrome-profile/SingletonCookie 2>/dev/null

  OUTPUT=$(cd /mnt/1tb-ssd/random/ads-automation && node planner.js --kw "${KEYWORDS[$i]}" 2>&1)
  EXIT_CODE=$?

  echo "$OUTPUT" >> "$LOG"
  echo "Exit code: $EXIT_CODE" >> "$LOG"

  # Extract the CSV file path from output and append data (skip header) to combined file
  CSV_FILE=$(echo "$OUTPUT" | grep "Results written to:" | sed 's/.*Results written to: //')
  if [ -n "$CSV_FILE" ] && [ -f "$CSV_FILE" ]; then
    tail -n +2 "$CSV_FILE" >> "$RESULTS"
    ROWS=$(tail -n +2 "$CSV_FILE" | wc -l)
    echo "BATCH $BATCH_NUM: Appended $ROWS rows to combined CSV" >> "$LOG"
  else
    echo "BATCH $BATCH_NUM: WARNING - no CSV file found" >> "$LOG"
  fi

  echo "--- BATCH $BATCH_NUM complete at $(date) ---" >> "$LOG"

  # Brief pause between batches
  if [ $BATCH_NUM -lt 3 ]; then
    sleep 5
  fi
done

echo "" >> "$LOG"
echo "=== All batches complete at $(date) ===" >> "$LOG"
TOTAL=$(tail -n +2 "$RESULTS" | wc -l)
echo "Total rows in combined CSV: $TOTAL" >> "$LOG"
echo "DONE" >> "$LOG"
