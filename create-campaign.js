#!/usr/bin/env node

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PROFILE_DIR = path.join(__dirname, 'chrome-profile');
const OUTPUT_DIR = path.join(__dirname, 'output');
const ADS_URL = 'https://ads.google.com';
const ACCOUNT_ID = '7752';

// ---------------------------------------------------------------------------
// Campaign configuration — edit these before running
// ---------------------------------------------------------------------------
const CAMPAIGN = {
  name: 'Phoenix Drainage - Search',
  dailyBudget: '20',  // dollars per day
  targetLocation: 'Phoenix',
  keywords: [
    'french drain installation',
    'french drain installation near me',
    'french drain contractor',
    'yard drainage solutions',
    'drainage contractor near me',
    'french drain cost',
    'yard drainage contractor',
    'backyard drainage solutions',
    'standing water yard fix',
    'channel drain driveway',
    'trench drain installation',
    'drainage contractor phoenix',
    'french drain installation phoenix',
    'pool deck drainage',
    'landscape drainage solutions',
  ],
  // Ad copy
  headlines: [
    'French Drain Installation',
    'Phoenix Drainage Experts',
    'Free Estimates Available',
    'Stop Yard Flooding Today',
    'Licensed & Insured',
    'Same-Week Service',
    'Monsoon-Ready Drains',
    'Yard Drainage Solutions',
  ],
  descriptions: [
    'Expert French drain installation in Phoenix. Free estimates, same-week service. Licensed & insured.',
    'Stop standing water & protect your foundation. Professional drainage systems built to last. Call today.',
  ],
  finalUrl: 'file:///mnt/1tb-ssd/random/keyword-planner/site/index.html', // replace with real URL
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function launchBrowser() {
  ensureDir(PROFILE_DIR);
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1400, height: 950 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
}

async function screenshot(page, name) {
  ensureDir(OUTPUT_DIR);
  const p = path.join(OUTPUT_DIR, `campaign-${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  console.log(`  Screenshot: ${p}`);
}

async function selectAccountIfNeeded(page) {
  const text = await page.textContent('body').catch(() => '');
  if (!text.includes('Select a Google Ads account')) return;
  console.log('Account picker — selecting', ACCOUNT_ID);
  const row = await page.$(`text=${ACCOUNT_ID}`);
  if (row) {
    await row.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(5000);
  }
}

async function waitAndClick(page, selectors, label, timeout = 15000) {
  if (typeof selectors === 'string') selectors = [selectors];
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click({ timeout: 5000 }).catch(() => el.click({ force: true }));
          console.log(`  Clicked: ${label} (${sel})`);
          return true;
        }
      } catch (e) {
        if (e.message.includes('Execution context was destroyed')) {
          await page.waitForTimeout(2000);
          break;
        }
      }
    }
    await page.waitForTimeout(500);
  }
  console.log(`  WARNING: Could not find: ${label}`);
  return false;
}

async function typeInField(page, selector, value, label) {
  const el = await page.$(selector);
  if (el) {
    await el.click();
    await el.fill('');
    await el.fill(value);
    console.log(`  Filled: ${label} = "${value}"`);
    return true;
  }
  console.log(`  WARNING: Could not find field: ${label}`);
  return false;
}

// ---------------------------------------------------------------------------
// Campaign creation steps
// ---------------------------------------------------------------------------

async function step1_startCampaign(page) {
  console.log('\n[1/7] Navigating to campaign creation...');

  // Go to Ads dashboard
  await page.goto(ADS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  await selectAccountIfNeeded(page);

  // Click "New campaign" or the + button
  // Try the Campaigns page first
  await page.goto('https://ads.google.com/aw/campaigns/new', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(4000);
  await selectAccountIfNeeded(page);

  await screenshot(page, '01-new-campaign');
  console.log('  Landed on:', page.url());
}

async function step2_selectGoal(page) {
  console.log('\n[2/7] Selecting campaign goal...');

  // Google Ads asks to pick a goal. We want "Website traffic" or "Leads"
  // or "Create a campaign without a goal's guidance"
  const clicked = await waitAndClick(page, [
    'text=Create a campaign without a goal\'s guidance',
    'text=without a goal',
    'div[role="button"]:has-text("without a goal")',
    'text=Website traffic',
    'text=Leads',
  ], 'campaign goal', 20000);

  if (!clicked) {
    // Might already be past this step
    console.log('  May already be past goal selection.');
  }

  await page.waitForTimeout(3000);
  await screenshot(page, '02-goal');
}

async function step3_selectCampaignType(page) {
  console.log('\n[3/7] Selecting campaign type (Search)...');

  await waitAndClick(page, [
    'text=Search',
    'div[role="button"]:has-text("Search")',
    '[data-campaign-type="SEARCH"]',
  ], 'Search campaign type', 15000);

  await page.waitForTimeout(2000);

  // May need to click Continue
  await waitAndClick(page, [
    'button:has-text("Continue")',
    'material-button:has-text("Continue")',
  ], 'Continue button', 10000);

  await page.waitForTimeout(3000);
  await screenshot(page, '03-campaign-type');
}

async function step4_campaignSettings(page) {
  console.log('\n[4/7] Configuring campaign settings...');

  // Campaign name
  const nameInput = await page.$('input[aria-label*="Campaign name"], input[aria-label*="campaign name"]');
  if (nameInput) {
    await nameInput.click();
    await nameInput.fill('');
    await nameInput.fill(CAMPAIGN.name);
    console.log(`  Set campaign name: ${CAMPAIGN.name}`);
  }

  await page.waitForTimeout(1000);

  // Uncheck Display Network and Search Partners if present
  const checkboxes = await page.$$('mat-checkbox, material-checkbox');
  for (const cb of checkboxes) {
    const label = await cb.textContent();
    if (label.includes('Display Network') || label.includes('Search Partners')) {
      const checked = await cb.getAttribute('aria-checked');
      if (checked === 'true') {
        await cb.click().catch(() => cb.click({ force: true }));
        console.log(`  Unchecked: ${label.trim().substring(0, 40)}`);
      }
    }
  }

  await page.waitForTimeout(2000);
  await screenshot(page, '04-settings');

  // Click Next/Continue
  await waitAndClick(page, [
    'button:has-text("Next")',
    'button:has-text("Continue")',
    'material-button:has-text("Next")',
  ], 'Next button', 10000);

  await page.waitForTimeout(3000);
}

async function step5_budgetAndBidding(page) {
  console.log('\n[5/7] Setting budget and bidding...');

  // Budget input
  const budgetFields = await page.$$('input[aria-label*="budget"], input[aria-label*="Budget"], input[type="number"]');
  for (const field of budgetFields) {
    const label = await field.getAttribute('aria-label') || '';
    if (label.toLowerCase().includes('budget') || label.includes('amount')) {
      await field.click();
      await field.fill('');
      await field.fill(CAMPAIGN.dailyBudget);
      console.log(`  Set daily budget: $${CAMPAIGN.dailyBudget}`);
      break;
    }
  }

  // If no labeled budget field found, try filling the first visible number input
  if (budgetFields.length === 0) {
    console.log('  Budget field not found yet — may appear on next step.');
  }

  await page.waitForTimeout(2000);
  await screenshot(page, '05-budget');

  // Click Next
  await waitAndClick(page, [
    'button:has-text("Next")',
    'material-button:has-text("Next")',
  ], 'Next button', 10000);

  await page.waitForTimeout(3000);
}

async function step6_keywordsAndAds(page) {
  console.log('\n[6/7] Adding keywords and ad copy...');
  await screenshot(page, '06-keywords-start');

  // Look for keyword input area
  const kwText = CAMPAIGN.keywords.join('\n');
  const kwInput = await page.$('textarea[aria-label*="keyword"], textarea[aria-label*="Keyword"], textarea');
  if (kwInput) {
    await kwInput.click();
    await kwInput.fill(kwText);
    console.log(`  Entered ${CAMPAIGN.keywords.length} keywords.`);
  } else {
    // Try typing into any editable area
    console.log('  No keyword textarea found — trying contenteditable.');
    const editable = await page.$('div[contenteditable="true"]');
    if (editable) {
      await editable.click();
      await page.keyboard.type(kwText, { delay: 20 });
      console.log(`  Typed ${CAMPAIGN.keywords.length} keywords.`);
    }
  }

  await page.waitForTimeout(2000);

  // Headlines — Google Ads has multiple headline fields
  const headlineInputs = await page.$$('input[aria-label*="Headline"], input[aria-label*="headline"]');
  for (let i = 0; i < Math.min(headlineInputs.length, CAMPAIGN.headlines.length); i++) {
    await headlineInputs[i].click();
    await headlineInputs[i].fill(CAMPAIGN.headlines[i]);
    console.log(`  Headline ${i + 1}: ${CAMPAIGN.headlines[i]}`);
    await page.waitForTimeout(300);
  }

  // Descriptions
  const descInputs = await page.$$('textarea[aria-label*="Description"], textarea[aria-label*="description"], input[aria-label*="Description"]');
  for (let i = 0; i < Math.min(descInputs.length, CAMPAIGN.descriptions.length); i++) {
    await descInputs[i].click();
    await descInputs[i].fill(CAMPAIGN.descriptions[i]);
    console.log(`  Description ${i + 1}: ${CAMPAIGN.descriptions[i].substring(0, 50)}...`);
    await page.waitForTimeout(300);
  }

  // Final URL
  const urlInput = await page.$('input[aria-label*="Final URL"], input[aria-label*="final URL"], input[aria-label*="Landing page"]');
  if (urlInput) {
    await urlInput.click();
    await urlInput.fill(CAMPAIGN.finalUrl);
    console.log(`  Final URL: ${CAMPAIGN.finalUrl}`);
  }

  await page.waitForTimeout(2000);
  await screenshot(page, '06-keywords-done');

  // Click Next
  await waitAndClick(page, [
    'button:has-text("Next")',
    'material-button:has-text("Next")',
  ], 'Next button', 10000);

  await page.waitForTimeout(3000);
}

async function step7_review(page) {
  console.log('\n[7/7] Review page...');
  await screenshot(page, '07-review');

  console.log('\n========================================');
  console.log('  CAMPAIGN READY FOR REVIEW');
  console.log('========================================');
  console.log(`  Name:     ${CAMPAIGN.name}`);
  console.log(`  Budget:   $${CAMPAIGN.dailyBudget}/day`);
  console.log(`  Location: ${CAMPAIGN.targetLocation}`);
  console.log(`  Keywords: ${CAMPAIGN.keywords.length}`);
  console.log(`  URL:      ${CAMPAIGN.finalUrl}`);
  console.log('');
  console.log('  The campaign is NOT published yet.');
  console.log('  Review the browser window and click');
  console.log('  "Publish" manually when ready.');
  console.log('========================================');
  console.log('\nPress ENTER to close the browser (campaign stays as draft).');
  console.log('Or go to the browser and click Publish.\n');

  await new Promise(resolve => {
    process.stdin.setRawMode?.(false);
    process.stdin.resume();
    process.stdin.once('data', resolve);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Google Ads Campaign Creator
===========================

Usage:
  node create-campaign.js           Create campaign (interactive)
  node create-campaign.js --dry-run Show config without launching browser

Edit the CAMPAIGN object at the top of create-campaign.js to configure:
  - Campaign name, daily budget
  - Target location
  - Keywords list
  - Ad headlines & descriptions
  - Landing page URL
`);
    process.exit(0);
  }

  if (args.includes('--dry-run')) {
    console.log('Campaign config:');
    console.log(JSON.stringify(CAMPAIGN, null, 2));
    process.exit(0);
  }

  console.log('Launching Google Ads Campaign Creator...');
  console.log(`Campaign: ${CAMPAIGN.name}`);
  console.log(`Budget: $${CAMPAIGN.dailyBudget}/day | Location: ${CAMPAIGN.targetLocation}`);
  console.log(`Keywords: ${CAMPAIGN.keywords.length} | Headlines: ${CAMPAIGN.headlines.length}`);
  console.log('');

  const context = await launchBrowser();
  const page = context.pages()[0] || await context.newPage();

  try {
    await step1_startCampaign(page);
    await step2_selectGoal(page);
    await step3_selectCampaignType(page);
    await step4_campaignSettings(page);
    await step5_budgetAndBidding(page);
    await step6_keywordsAndAds(page);
    await step7_review(page);
  } catch (err) {
    console.error('\nError during campaign creation:', err.message);
    await screenshot(page, 'error');
    console.log('Browser left open for manual intervention.');
    console.log('Press ENTER to close.\n');
    await new Promise(resolve => {
      process.stdin.setRawMode?.(false);
      process.stdin.resume();
      process.stdin.once('data', resolve);
    });
  }

  await context.close();
  console.log('Browser closed.');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
