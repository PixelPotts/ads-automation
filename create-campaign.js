#!/usr/bin/env node

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PROFILE_DIR = path.join(__dirname, 'chrome-profile');
const OUTPUT_DIR = path.join(__dirname, 'output');
const ADS_URL = 'https://ads.google.com';
const ACCOUNT_ID = '7888'; // General Carpentry — test account (use 7752 for production)
const TEST_MODE = process.argv.includes('--test');

// Human-like random delay between actions (1.5–4s)
function humanDelay() {
  return 1500 + Math.floor(Math.random() * 2500);
}

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
    await page.waitForTimeout(humanDelay() + 2000);
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
          await page.waitForTimeout(humanDelay());
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

// Dismiss "Create a new campaign or finish a saved draft?" dialog
async function dismissDraftIfNeeded(page) {
  const dismissed = await page.evaluate(() => {
    const btns = document.querySelectorAll('button, a, [role="button"], material-button');
    for (const btn of btns) {
      const txt = btn.textContent.trim();
      if (txt === 'Start new' || txt === 'Start New') {
        btn.click();
        return true;
      }
    }
    return false;
  });
  if (dismissed) {
    console.log('  Dismissed draft dialog — starting new campaign.');
    await page.waitForTimeout(humanDelay());
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1000);
  }
  return dismissed;
}

// Click "Next" button in the wizard — used by every wizard step
async function clickNext(page, label) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);
  const clicked = await waitAndClick(page, [
    'button:has-text("Next")',
    'material-button:has-text("Next")',
  ], label || 'Next button', 15000);
  if (clicked) {
    await page.waitForTimeout(humanDelay());
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);
  }
  return clicked;
}

// Dump visible form fields for debugging
async function dumpFormFields(page) {
  const fields = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input, textarea, select');
    return Array.from(inputs).filter(i => i.offsetHeight > 0).slice(0, 25).map(i => ({
      tag: i.tagName,
      type: i.type || '',
      label: i.getAttribute('aria-label') || '',
      placeholder: i.placeholder || '',
      value: i.value?.substring(0, 30) || '',
    }));
  });
  console.log('  Form fields:', JSON.stringify(fields.map(f => f.label || f.placeholder || `${f.tag}[${f.type}]`)));
  return fields;
}

// Detect which wizard step we're on by checking left nav
async function detectWizardStep(page) {
  return page.evaluate(() => {
    const navItems = document.querySelectorAll('*');
    const steps = [];
    for (const el of navItems) {
      const t = el.textContent.trim();
      const rect = el.getBoundingClientRect();
      // Left nav items are in the left column (x < 250) and have specific step names
      if (rect.left < 250 && rect.width < 250 && rect.top > 100 && el.offsetHeight > 0 && el.offsetHeight < 50) {
        const stepNames = ['Bidding', 'Campaign settings', 'AI Max', 'Keyword and asset generation', 'Keywords and ads', 'Budget', 'Review'];
        for (const name of stepNames) {
          if (t === name) {
            // Check if this step is active (look for blue/selected indicator)
            const style = window.getComputedStyle(el);
            const isActive = style.color === 'rgb(26, 115, 232)' || style.fontWeight === '700' || style.fontWeight === 'bold' || el.closest('[class*="active"]');
            steps.push({ name, active: !!isActive, y: Math.round(rect.top) });
          }
        }
      }
    }
    // Also check the page heading
    const h1 = document.querySelector('h1, h2');
    const heading = h1 ? h1.textContent.trim() : '';
    return { heading, steps: [...new Map(steps.map(s => [s.name, s])).values()] };
  });
}

// ---------------------------------------------------------------------------
// PRE-WIZARD STEPS (scrollable single pages)
// ---------------------------------------------------------------------------

async function step1_navigate(page) {
  console.log('\n[1/9] Navigating to campaign creation...');

  await page.goto(ADS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(humanDelay());
  await selectAccountIfNeeded(page);

  await page.goto('https://ads.google.com/aw/campaigns/new', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(humanDelay() + 1000);
  await selectAccountIfNeeded(page);

  await screenshot(page, '01-new-campaign');
  console.log('  Landed on:', page.url());
}

async function step2_selectGoal(page) {
  console.log('\n[2/9] Selecting campaign goal (Website traffic)...');

  const goalClicked = await page.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (el.textContent.trim().startsWith('Website traffic') &&
          el.textContent.includes('Get the right people') &&
          el.offsetHeight > 60 && el.offsetHeight < 300 &&
          el.offsetWidth > 100) {
        el.click();
        return 'clicked card';
      }
    }
    for (const el of allEls) {
      if (el.textContent.trim() === 'Website traffic' && el.offsetHeight > 0 && el.offsetHeight < 40) {
        const parent = el.closest('[role="button"]') || el.parentElement?.parentElement;
        if (parent) { parent.click(); return 'clicked parent'; }
        el.click();
        return 'clicked heading';
      }
    }
    return null;
  });
  console.log('  Website traffic goal:', goalClicked || 'NOT FOUND');

  await page.waitForTimeout(humanDelay());
  await screenshot(page, '02-goal');

  // Click Continue
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(humanDelay());
  await waitAndClick(page, [
    'button:has-text("Continue")',
    'material-button:has-text("Continue")',
  ], 'Continue (objective)', 15000);

  await page.waitForTimeout(humanDelay());
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(humanDelay());
}

async function step3_typeAndName(page) {
  console.log('\n[3/9] Selecting Search type + campaign name...');

  // Click Search card
  const typeClicked = await page.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const ownText = el.childNodes.length > 0
        ? Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('')
        : el.textContent.trim();
      if (ownText === 'Search' && el.offsetHeight > 0) {
        const rect = el.getBoundingClientRect();
        if (rect.top > 100) {
          let target = el;
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            if (p.offsetHeight > 80 && p.offsetHeight < 400 && p.offsetWidth > 150) {
              target = p;
              break;
            }
          }
          target.click();
          return 'clicked at y=' + Math.round(rect.top);
        }
      }
    }
    return null;
  });
  console.log('  Search type:', typeClicked || 'NOT FOUND');
  await page.waitForTimeout(humanDelay());

  // Scroll down to campaign name
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(humanDelay());

  // Set campaign name
  const nameInput = await page.$('input[aria-label*="Campaign name"], input[aria-label*="campaign name"]');
  if (nameInput) {
    await nameInput.click();
    await nameInput.fill('');
    await page.waitForTimeout(500);
    await nameInput.type(CAMPAIGN.name, { delay: 50 });
    console.log(`  Campaign name: ${CAMPAIGN.name}`);
  } else {
    console.log('  WARNING: Campaign name field not found');
  }

  await page.waitForTimeout(humanDelay());
  await screenshot(page, '03-type-and-name');

  // Click Continue — this transitions to the left-nav wizard
  await waitAndClick(page, [
    'button:has-text("Continue")',
    'material-button:has-text("Continue")',
  ], 'Continue (type page)', 15000);

  await page.waitForTimeout(humanDelay());
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);

  // Draft dialog often appears here
  await dismissDraftIfNeeded(page);
  // Check again after a moment (sometimes it loads slowly)
  await page.waitForTimeout(1500);
  await dismissDraftIfNeeded(page);

  await screenshot(page, '03b-entered-wizard');
  const wizState = await detectWizardStep(page);
  console.log('  Wizard state:', JSON.stringify(wizState));
}

// ---------------------------------------------------------------------------
// LEFT-NAV WIZARD STEPS
// Each step: screenshot, do work (if any), click Next
// ---------------------------------------------------------------------------

async function step4_bidding(page) {
  console.log('\n[4/9] Bidding page (accepting defaults)...');
  await dismissDraftIfNeeded(page);
  await screenshot(page, '04-bidding');

  // Bidding page has "Conversions" as default focus — that's fine
  // Just dump what we see and click Next
  const heading = await page.evaluate(() => {
    const h = document.querySelector('h1, h2');
    return h ? h.textContent.trim() : '';
  });
  console.log('  Page heading:', heading);

  await clickNext(page, 'Next (bidding)');
  await screenshot(page, '04b-after-bidding');
}

async function step5_campaignSettings(page) {
  console.log('\n[5/9] Campaign settings (location targeting)...');
  await dismissDraftIfNeeded(page);
  await screenshot(page, '05-settings');

  // Dump form fields to understand the layout
  await dumpFormFields(page);

  // Look for location input and set to Phoenix
  // The location section usually has a text input for searching locations
  const locationSet = await page.evaluate((targetLoc) => {
    const inputs = document.querySelectorAll('input');
    for (const inp of inputs) {
      const label = (inp.getAttribute('aria-label') || '').toLowerCase();
      const placeholder = (inp.placeholder || '').toLowerCase();
      if (label.includes('location') || label.includes('target') ||
          placeholder.includes('location') || placeholder.includes('city') ||
          placeholder.includes('enter a location')) {
        inp.focus();
        inp.click();
        return { found: true, label: inp.getAttribute('aria-label'), placeholder: inp.placeholder };
      }
    }
    return { found: false };
  }, CAMPAIGN.targetLocation);

  if (locationSet.found) {
    console.log(`  Found location field: "${locationSet.label || locationSet.placeholder}"`);
    // Type the location
    const locInput = await page.$(`input[aria-label*="location" i], input[placeholder*="location" i], input[aria-label*="target" i]`);
    if (locInput) {
      await locInput.fill('');
      await page.keyboard.type(CAMPAIGN.targetLocation, { delay: 80 });
      await page.waitForTimeout(2000); // wait for suggestions

      // Click the suggestion that matches Phoenix, Arizona
      const suggestionClicked = await page.evaluate((loc) => {
        // Look for suggestion dropdown items
        const items = document.querySelectorAll('[role="option"], [role="listbox"] *, li, .suggestion');
        for (const item of items) {
          if (item.textContent.includes(loc) && item.offsetHeight > 0) {
            item.click();
            return item.textContent.trim().substring(0, 60);
          }
        }
        // Try finding "Include" buttons (like in keyword planner)
        const btns = document.querySelectorAll('button, [role="button"]');
        for (const btn of btns) {
          if (btn.textContent.trim() === 'Include' && btn.offsetHeight > 0) {
            btn.click();
            return 'clicked Include';
          }
        }
        return null;
      }, CAMPAIGN.targetLocation);
      console.log(`  Location suggestion: ${suggestionClicked || 'no suggestion found'}`);
    }
  } else {
    console.log('  No location input found on this page — location may be elsewhere.');
    // Try to find any location-related section and expand it
    const expanded = await page.evaluate(() => {
      const els = document.querySelectorAll('*');
      for (const el of els) {
        if (el.textContent.trim() === 'Locations' && el.offsetHeight > 0 && el.offsetHeight < 40) {
          el.click();
          return true;
        }
      }
      return false;
    });
    if (expanded) {
      console.log('  Expanded Locations section — retrying...');
      await page.waitForTimeout(1500);
      await dumpFormFields(page);
    }
  }

  await page.waitForTimeout(humanDelay());
  await screenshot(page, '05b-settings-done');
  await clickNext(page, 'Next (campaign settings)');
}

async function step6_aiMaxAndKeywordGen(page) {
  console.log('\n[6/9] AI Max + Keyword generation (skipping both)...');
  await dismissDraftIfNeeded(page);

  // AI Max page — just screenshot and click Next
  await screenshot(page, '06a-ai-max');
  const heading1 = await page.evaluate(() => {
    const h = document.querySelector('h1, h2');
    return h ? h.textContent.trim() : '';
  });
  console.log('  Page heading:', heading1);
  await clickNext(page, 'Next (AI Max)');

  // Keyword and asset generation page — just click Next
  await page.waitForTimeout(1000);
  await dismissDraftIfNeeded(page);
  await screenshot(page, '06b-keyword-gen');
  const heading2 = await page.evaluate(() => {
    const h = document.querySelector('h1, h2');
    return h ? h.textContent.trim() : '';
  });
  console.log('  Page heading:', heading2);
  await clickNext(page, 'Next (keyword generation)');
}

async function step7_keywordsAndAds(page) {
  console.log('\n[7/9] Keywords and ads (main content entry)...');
  await dismissDraftIfNeeded(page);
  await screenshot(page, '07-keywords-start');
  await dumpFormFields(page);

  // Enter keywords
  const kwText = CAMPAIGN.keywords.join('\n');

  // Try textarea first
  let kwEntered = false;
  const kwInput = await page.$('textarea[aria-label*="keyword" i], textarea[aria-label*="Keyword" i]');
  if (kwInput) {
    await kwInput.click();
    await kwInput.fill(kwText);
    kwEntered = true;
    console.log(`  Entered ${CAMPAIGN.keywords.length} keywords (textarea).`);
  }

  // Try contenteditable div
  if (!kwEntered) {
    const editable = await page.$('div[contenteditable="true"]');
    if (editable) {
      await editable.click();
      await page.keyboard.type(kwText, { delay: 15 });
      kwEntered = true;
      console.log(`  Typed ${CAMPAIGN.keywords.length} keywords (contenteditable).`);
    }
  }

  // Try any generic textarea on the page
  if (!kwEntered) {
    const anyTA = await page.$('textarea');
    if (anyTA) {
      await anyTA.click();
      await anyTA.fill(kwText);
      kwEntered = true;
      console.log(`  Entered ${CAMPAIGN.keywords.length} keywords (generic textarea).`);
    }
  }

  if (!kwEntered) {
    console.log('  WARNING: No keyword input found!');
  }

  await page.waitForTimeout(humanDelay());

  // Final URL
  const urlInput = await page.$('input[aria-label*="Final URL" i], input[aria-label*="final url" i], input[aria-label*="Landing page" i], input[aria-label*="landing page" i]');
  if (urlInput) {
    await urlInput.click();
    await urlInput.fill(CAMPAIGN.finalUrl);
    console.log(`  Final URL: ${CAMPAIGN.finalUrl}`);
  } else {
    console.log('  Final URL field not found on this page.');
  }

  await page.waitForTimeout(humanDelay());

  // Headlines
  const headlineInputs = await page.$$('input[aria-label*="Headline" i], input[aria-label*="headline" i]');
  const filledHeadlines = Math.min(headlineInputs.length, CAMPAIGN.headlines.length);
  for (let i = 0; i < filledHeadlines; i++) {
    await headlineInputs[i].click();
    await headlineInputs[i].fill(CAMPAIGN.headlines[i]);
    console.log(`  Headline ${i + 1}: ${CAMPAIGN.headlines[i]}`);
    await page.waitForTimeout(400 + Math.floor(Math.random() * 600));
  }
  if (filledHeadlines > 0) console.log(`  Filled ${filledHeadlines}/${CAMPAIGN.headlines.length} headlines.`);

  // Descriptions
  const descInputs = await page.$$('textarea[aria-label*="Description" i], textarea[aria-label*="description" i], input[aria-label*="Description" i]');
  const filledDescs = Math.min(descInputs.length, CAMPAIGN.descriptions.length);
  for (let i = 0; i < filledDescs; i++) {
    await descInputs[i].click();
    await descInputs[i].fill(CAMPAIGN.descriptions[i]);
    console.log(`  Description ${i + 1}: ${CAMPAIGN.descriptions[i].substring(0, 50)}...`);
    await page.waitForTimeout(400 + Math.floor(Math.random() * 600));
  }
  if (filledDescs > 0) console.log(`  Filled ${filledDescs}/${CAMPAIGN.descriptions.length} descriptions.`);

  await page.waitForTimeout(humanDelay());
  await screenshot(page, '07-keywords-done');
  await clickNext(page, 'Next (keywords and ads)');
}

async function step8_budget(page) {
  console.log('\n[8/9] Setting budget...');
  await dismissDraftIfNeeded(page);
  await screenshot(page, '08-budget-start');
  await dumpFormFields(page);

  // Find the budget input field
  let budgetSet = false;

  // Try labeled budget fields
  const budgetInputs = await page.$$('input[aria-label*="budget" i], input[aria-label*="Budget" i], input[aria-label*="amount" i]');
  for (const field of budgetInputs) {
    const visible = await field.isVisible().catch(() => false);
    if (visible) {
      await field.click();
      await field.fill('');
      await field.fill(CAMPAIGN.dailyBudget);
      budgetSet = true;
      console.log(`  Set daily budget: $${CAMPAIGN.dailyBudget}`);
      break;
    }
  }

  // Fallback: try number inputs
  if (!budgetSet) {
    const numInputs = await page.$$('input[type="number"]');
    for (const field of numInputs) {
      const visible = await field.isVisible().catch(() => false);
      if (visible) {
        await field.click();
        await field.fill('');
        await field.fill(CAMPAIGN.dailyBudget);
        budgetSet = true;
        console.log(`  Set budget via number input: $${CAMPAIGN.dailyBudget}`);
        break;
      }
    }
  }

  // Fallback: try any visible text input that's near "budget" text
  if (!budgetSet) {
    budgetSet = await page.evaluate((budget) => {
      const inputs = document.querySelectorAll('input');
      for (const inp of inputs) {
        if (inp.offsetHeight > 0 && inp.type !== 'hidden') {
          // Check if nearby text mentions "budget"
          const parent = inp.closest('div, section, fieldset');
          if (parent && parent.textContent.toLowerCase().includes('budget')) {
            inp.focus();
            inp.value = '';
            inp.value = budget;
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
      }
      return false;
    }, CAMPAIGN.dailyBudget);
    if (budgetSet) console.log(`  Set budget via fallback: $${CAMPAIGN.dailyBudget}`);
  }

  if (!budgetSet) {
    console.log('  WARNING: Could not find budget field!');
  }

  await page.waitForTimeout(humanDelay());
  await screenshot(page, '08-budget-done');
  await clickNext(page, 'Next (budget)');
}

async function step9_review(page) {
  console.log('\n[9/9] Review page...');
  await dismissDraftIfNeeded(page);
  await screenshot(page, '09-review');

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
  if (TEST_MODE) {
    console.log('\n  --test mode: NOT publishing. Closing in 5s...');
    await page.waitForTimeout(5000);
    return;
  }

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
  node create-campaign.js --test    Create campaign and auto-close (no publish)
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
  console.log(`Account: ${ACCOUNT_ID} | Mode: ${TEST_MODE ? 'TEST (no publish)' : 'INTERACTIVE'}`);
  console.log(`Campaign: ${CAMPAIGN.name}`);
  console.log(`Budget: $${CAMPAIGN.dailyBudget}/day | Location: ${CAMPAIGN.targetLocation}`);
  console.log(`Keywords: ${CAMPAIGN.keywords.length} | Headlines: ${CAMPAIGN.headlines.length}`);
  console.log('');

  const context = await launchBrowser();
  const page = context.pages()[0] || await context.newPage();

  try {
    // Pre-wizard pages
    await step1_navigate(page);
    await step2_selectGoal(page);
    await step3_typeAndName(page);

    // Left-nav wizard steps
    await step4_bidding(page);
    await step5_campaignSettings(page);
    await step6_aiMaxAndKeywordGen(page);
    await step7_keywordsAndAds(page);
    await step8_budget(page);
    await step9_review(page);
  } catch (err) {
    console.error('\nError during campaign creation:', err.message);
    await screenshot(page, 'error').catch(() => {});
    if (TEST_MODE) {
      console.log('  --test mode: closing after error.');
    } else {
      console.log('Browser left open for manual intervention.');
      console.log('Press ENTER to close.\n');
      await new Promise(resolve => {
        process.stdin.setRawMode?.(false);
        process.stdin.resume();
        process.stdin.once('data', resolve);
      });
    }
  }

  await context.close();
  console.log('Browser closed.');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
