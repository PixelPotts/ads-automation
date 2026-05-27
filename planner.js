#!/usr/bin/env node

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PROFILE_DIR = path.join(__dirname, 'chrome-profile');
const OUTPUT_DIR = path.join(__dirname, 'output');
const ADS_URL = 'https://ads.google.com';
const KW_PLANNER_URL = 'https://ads.google.com/aw/keywordplanner/home';
const BATCH_SIZE = 10;
const ACCOUNT_ID = '7752'; // last 4 digits of the Google Ads account to auto-select

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { mode: null, keywordsFile: null, keywords: [] };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--login') {
      opts.mode = 'login';
    } else if (args[i] === '--keywords' && args[i + 1]) {
      opts.mode = 'scrape';
      opts.keywordsFile = args[++i];
    } else if (args[i] === '--kw') {
      // inline keywords: --kw "shoe,boot,sneaker"
      opts.mode = 'scrape';
      opts.keywords = args[++i].split(',').map(k => k.trim());
    } else if (args[i] === '--help' || args[i] === '-h') {
      printUsage();
      process.exit(0);
    }
  }
  return opts;
}

function printUsage() {
  console.log(`
Google Ads Keyword Planner Automation
=====================================

Usage:
  node planner.js --login                   Sign in to Google Ads (run once)
  node planner.js --keywords keywords.json  Scrape data for keywords in JSON file
  node planner.js --kw "shoe,boot,sneaker"  Scrape data for inline keywords

Options:
  --login             Launch browser for manual Google Ads sign-in
  --keywords <file>   Path to JSON file containing keyword array
  --kw <list>         Comma-separated keywords
  -h, --help          Show this help
`);
}

function loadKeywords(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const raw = fs.readFileSync(abs, 'utf-8');
  return JSON.parse(raw);
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function csvEscape(val) {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function writeCsv(rows, outPath) {
  const header = 'keyword,avg_monthly_searches,competition,cpc_low,cpc_high';
  const lines = rows.map(r =>
    [r.keyword, r.avgMonthlySearches, r.competition, r.cpcLow, r.cpcHigh]
      .map(csvEscape)
      .join(',')
  );
  fs.writeFileSync(outPath, [header, ...lines].join('\n') + '\n');
}

async function launchBrowser() {
  ensureDir(PROFILE_DIR);
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  return context;
}

async function selectAccountIfNeeded(page) {
  // Check if we're on the account picker page
  const pickerText = await page.textContent('body').catch(() => '');
  if (!pickerText.includes('Select a Google Ads account')) return false;

  console.log('Account picker detected — looking for account ending in', ACCOUNT_ID, '...');

  // Click the row containing our account ID
  const accountRow = await page.$(`text=${ACCOUNT_ID}`);
  if (accountRow) {
    await accountRow.click();
    console.log('Clicked account', ACCOUNT_ID, '— waiting for dashboard...');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(5000);
    console.log('Now on:', page.url());
    return true;
  }

  console.error('ERROR: Could not find account matching', ACCOUNT_ID);
  ensureDir(OUTPUT_DIR);
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'debug-account-picker.png'), fullPage: true });
  return false;
}

// ---------------------------------------------------------------------------
// Phase 1 — Login
// ---------------------------------------------------------------------------

async function doLogin() {
  console.log('Launching browser for Google Ads sign-in...');
  console.log('Profile dir:', PROFILE_DIR);
  const context = await launchBrowser();
  const page = context.pages()[0] || await context.newPage();

  await page.goto(ADS_URL, { waitUntil: 'domcontentloaded' });
  console.log('\n>>> Sign in to your Google Ads account in the browser window.');
  console.log('>>> Once you are on the Google Ads dashboard, press ENTER here to confirm.\n');

  // Wait for user to press enter in terminal
  await new Promise(resolve => {
    process.stdin.setRawMode?.(false);
    process.stdin.resume();
    process.stdin.once('data', resolve);
  });

  // Quick check — see if we're on a Google Ads-related page
  const url = page.url();
  const validDomains = ['ads.google.com', 'business.google.com', 'google.com/ads'];
  if (validDomains.some(d => url.includes(d))) {
    console.log('Auth looks good — current URL:', url);
  } else if (url.includes('accounts.google.com') || url.includes('signin')) {
    console.log('WARNING: Still on sign-in page. Auth may not have completed.');
    console.log('Current URL:', url);
  } else {
    console.log('Current URL:', url);
    console.log('(Session cookies saved regardless — try scraping to see if auth persisted.)');
  }

  await context.close();
  console.log('Browser closed. Session cookies saved to chrome-profile/.');
  console.log('You can now run: node planner.js --keywords keywords.json');
}

// ---------------------------------------------------------------------------
// Phase 2 — Scrape keyword data
// ---------------------------------------------------------------------------

async function waitForSelector(page, selectors, timeout = 30000) {
  // Try multiple selectors, return the first one found
  // Handles navigation-induced context destruction gracefully
  if (typeof selectors === 'string') selectors = [selectors];
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el) return { el, selector: sel };
      } catch (e) {
        if (e.message.includes('Execution context was destroyed') || e.message.includes('navigation')) {
          console.log('  (page navigating, waiting for it to settle...)');
          await page.waitForLoadState('domcontentloaded').catch(() => {});
          await page.waitForTimeout(2000);
          break; // restart selector loop after navigation settles
        }
        throw e;
      }
    }
    await page.waitForTimeout(500);
  }
  return null;
}

async function navigateToForecasts(page) {
  console.log('Navigating to Keyword Planner...');
  await page.goto(KW_PLANNER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Wait for any redirects to settle
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(4000);
  console.log('Landed on:', page.url());

  // Handle account picker if it appears again after nav
  await selectAccountIfNeeded(page);

  ensureDir(OUTPUT_DIR);
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'debug-nav.png'), fullPage: true });
  console.log('Screenshot saved to output/debug-nav.png');

  // Google Ads may land on different views — look for the
  // "Get search volume and forecasts" option
  const forecastBtn = await waitForSelector(page, [
    'text=Get search volume and forecasts',
    'text=Get search volume',
    '[data-panel-id="forecasts"]',
    'div[role="button"]:has-text("Get search volume")',
  ], 15000);

  if (forecastBtn) {
    console.log('Clicking "Get search volume and forecasts"...');
    await forecastBtn.el.click();
    await page.waitForTimeout(2000);
  } else {
    console.log('Could not find forecast button — may already be on the right page.');
  }
}

async function enterKeywords(page, keywords) {
  const kwText = keywords.join('\n');
  console.log(`Entering ${keywords.length} keywords...`);

  // Look for the keyword textarea / input
  const textarea = await waitForSelector(page, [
    'textarea[aria-label*="keyword"]',
    'textarea[aria-label*="Keyword"]',
    'textarea[placeholder*="keyword"]',
    'textarea',
    'div[contenteditable="true"]',
  ], 15000);

  if (!textarea) {
    console.error('ERROR: Could not find keyword input area.');
    console.log('Current URL:', page.url());
    console.log('Taking debug screenshot...');
    ensureDir(OUTPUT_DIR);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'debug-input.png'), fullPage: true });
    throw new Error('Keyword input not found');
  }

  console.log('Found input using selector:', textarea.selector);
  await textarea.el.click();
  await page.waitForTimeout(500);

  // Clear existing text and type keywords
  await textarea.el.fill('');
  await textarea.el.fill(kwText);
  await page.waitForTimeout(1000);

  // Click "Get started" / "Get results" / submit button
  const submitBtn = await waitForSelector(page, [
    'button:has-text("Get started")',
    'button:has-text("Get results")',
    'button:has-text("Get forecasts")',
    'button:has-text("Submit")',
    'material-button:has-text("Get started")',
  ], 10000);

  if (submitBtn) {
    console.log('Clicking submit button...');
    await submitBtn.el.click();
  } else {
    console.log('No submit button found — trying Enter key...');
    await page.keyboard.press('Enter');
  }

  // Wait for results to load
  console.log('Waiting for results to load...');
  await page.waitForTimeout(5000);
}

async function scrapeResults(page) {
  // Wait for the results table to appear
  console.log('Looking for results table...');

  // Take a screenshot for debugging regardless
  ensureDir(OUTPUT_DIR);
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'debug-results.png'), fullPage: true });

  // Try to find the results table — Google Ads uses various table structures
  const tableSelectors = [
    'table.p6Nud',                          // known GA table class
    'table[class*="keyword"]',
    'div[role="grid"]',
    'table',
  ];

  let table = null;
  for (const sel of tableSelectors) {
    table = await page.$(sel);
    if (table) {
      console.log('Found table with selector:', sel);
      break;
    }
  }

  if (!table) {
    console.error('ERROR: Could not find results table.');
    console.log('Current URL:', page.url());
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'debug-no-table.png'), fullPage: true });
    throw new Error('Results table not found');
  }

  // Dump row HTML for debugging
  const debugHtml = await page.evaluate(() => {
    const rows = document.querySelectorAll('div[role="row"]');
    return Array.from(rows).map((r, i) => {
      const cells = r.querySelectorAll('div[role="gridcell"], div[role="columnheader"], header-tools-cell');
      const cellTexts = Array.from(cells).map(c => c.textContent.trim());
      return `ROW ${i} (${cells.length} cells): ${JSON.stringify(cellTexts)}\nHTML: ${r.innerHTML.substring(0, 1000)}`;
    }).join('\n\n');
  });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'debug-rows.txt'), debugHtml);
  console.log('Row debug dumped to output/debug-rows.txt');

  // Extract rows from the table
  // Google Ads Keyword Planner "Saved keywords" table columns (0-indexed):
  // 0: checkbox, 1: Keyword, 2: Avg. monthly searches, 3: Three month change,
  // 4: YoY change, 5: Competition, 6: Ad impression share,
  // 7: Top of page bid (low range), 8: Top of page bid (high range)
  const rows = await page.evaluate(() => {
    const results = [];
    // Google Ads uses custom elements: tools-cell, ess-cell with role="gridcell"
    const allRows = document.querySelectorAll('div[role="row"]');

    for (const row of allRows) {
      // Use generic [role="gridcell"] to catch all custom element types
      const cells = row.querySelectorAll('[role="gridcell"]');
      if (cells.length < 5) continue;

      const texts = Array.from(cells).map(c => c.textContent.trim());

      // Skip header row
      if (texts.some(t => t.includes('Keyword') && t.length < 20)) continue;

      // Layout: [checkbox, keyword, avg searches, 3mo change, yoy change, competition, ad impr, cpc low, cpc high, account status]
      // Index 0 = checkbox/tools-cell, 1 = keyword, 2 = avg monthly searches, etc.
      const kwCell = cells[1];
      let keyword = kwCell?.querySelector('[title]')?.getAttribute('title')
        || kwCell?.textContent?.trim()
        || texts[1];

      // Clean up keyword (remove trailing ellipsis artifacts)
      keyword = keyword.replace(/\s*…$/, '').replace(/\s*\.\.\.$/, '');

      const avgMonthlySearches = texts[2] || '';
      // texts[3] = three month change, texts[4] = yoy change — skip
      const competition = texts[5] || '';
      // texts[6] = ad impression share — skip
      const cpcLow = texts[7] || '';
      const cpcHigh = texts[8] || '';

      if (keyword && keyword.length > 0) {
        results.push({ keyword, avgMonthlySearches, competition, cpcLow, cpcHigh });
      }
    }
    return results;
  });

  console.log(`Scraped ${rows.length} rows from table.`);
  return rows;
}

async function doScrape(keywords) {
  console.log(`Starting scrape for ${keywords.length} keywords...`);
  const context = await launchBrowser();
  const page = context.pages()[0] || await context.newPage();

  // Check if we're logged in
  await page.goto(ADS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  const url = page.url();
  if (url.includes('accounts.google.com/signin') || url.includes('accounts.google.com/v3/signin')) {
    console.error('ERROR: Not logged in. Run `node planner.js --login` first.');
    await context.close();
    process.exit(1);
  }

  console.log('Authenticated — current URL:', url);

  // Handle account picker if it appears
  await selectAccountIfNeeded(page);

  console.log('Attempting to navigate to Keyword Planner...');

  const allResults = [];
  const batches = chunk(keywords, BATCH_SIZE);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`\n--- Batch ${i + 1}/${batches.length} (${batch.length} keywords) ---`);

    await navigateToForecasts(page);
    await enterKeywords(page, batch);
    const rows = await scrapeResults(page);
    allResults.push(...rows);

    if (i < batches.length - 1) {
      console.log('Waiting before next batch...');
      await page.waitForTimeout(3000);
    }
  }

  // Write output
  ensureDir(OUTPUT_DIR);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = path.join(OUTPUT_DIR, `keywords-${timestamp}.csv`);
  writeCsv(allResults, outPath);
  console.log(`\nResults written to: ${outPath}`);

  // Print summary
  console.log('\n=== Summary ===');
  console.log(`Total keywords scraped: ${allResults.length}`);
  if (allResults.length > 0) {
    console.log('\nkeyword | searches | competition | cpc_low | cpc_high');
    console.log('-'.repeat(70));
    for (const r of allResults) {
      console.log(`${r.keyword} | ${r.avgMonthlySearches} | ${r.competition} | ${r.cpcLow} | ${r.cpcHigh}`);
    }
  }

  await context.close();
  console.log('\nDone. Browser closed.');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();

  if (!opts.mode) {
    printUsage();
    process.exit(1);
  }

  if (opts.mode === 'login') {
    await doLogin();
    return;
  }

  if (opts.mode === 'scrape') {
    let keywords = opts.keywords;
    if (opts.keywordsFile) {
      keywords = loadKeywords(opts.keywordsFile);
    }
    if (!keywords || keywords.length === 0) {
      console.error('No keywords provided.');
      process.exit(1);
    }
    await doScrape(keywords);
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
