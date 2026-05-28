#!/usr/bin/env node

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PROFILE_DIR = path.join(__dirname, 'chrome-profile');
const OUTPUT_DIR = path.join(__dirname, 'output');
const ADS_URL = 'https://ads.google.com';
const ACCOUNT_ID = '0849'; // Production account
const TEST_MODE = process.argv.includes('--test');
const PUBLISH_MODE = process.argv.includes('--publish');

// Human-like random delay between actions (1.5–4s)
function humanDelay() {
  return 1500 + Math.floor(Math.random() * 2500);
}

// ---------------------------------------------------------------------------
// Campaign configuration — load from --config file or use defaults
// ---------------------------------------------------------------------------
function loadCampaignConfig() {
  const configIdx = process.argv.indexOf('--config');
  if (configIdx !== -1 && process.argv[configIdx + 1]) {
    const configPath = path.resolve(process.argv[configIdx + 1]);
    if (!fs.existsSync(configPath)) {
      console.error(`Config file not found: ${configPath}`);
      process.exit(1);
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log(`Loaded config: ${configPath}`);
    return config;
  }
  // Default config (french drain)
  return {
    name: 'Phoenix Drainage - Search',
    dailyBudget: '20',
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
    finalUrl: 'file:///mnt/1tb-ssd/random/french-drain-install/index.html',
  };
}

const CAMPAIGN = loadCampaignConfig();

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
  // Scroll Next button into view first
  await page.evaluate(() => {
    const btns = document.querySelectorAll('material-button, button');
    for (const btn of btns) {
      if (btn.textContent.trim() === 'Next' && btn.offsetWidth > 0) {
        btn.scrollIntoView({ block: 'center' });
        return;
      }
    }
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(800);

  let clicked = false;

  // Method 1: Use Playwright's page.click() directly — handles Material Design best
  try {
    await page.click('material-button:has-text("Next")', { timeout: 5000 });
    console.log(`  Clicked: ${label} (page.click material-button)`);
    clicked = true;
  } catch (e) {
    // Method 2: Try standard button
    try {
      await page.click('button:has-text("Next")', { timeout: 3000 });
      console.log(`  Clicked: ${label} (page.click button)`);
      clicked = true;
    } catch (e2) {
      // Method 3: JS evaluate with MouseEvent dispatch on material-button
      clicked = await page.evaluate(() => {
        // Directly query material-button and button elements
        const btns = document.querySelectorAll('material-button, button, [role="button"]');
        for (const btn of btns) {
          if (btn.textContent.trim() === 'Next' && btn.offsetWidth > 0) {
            btn.scrollIntoView({ block: 'center' });
            // Try native click first
            btn.click();
            // Also dispatch a proper MouseEvent (for Angular event handlers)
            const rect = btn.getBoundingClientRect();
            const evt = new MouseEvent('click', {
              bubbles: true, cancelable: true, view: window,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2,
            });
            btn.dispatchEvent(evt);
            return 'btn ' + btn.tagName + ' at y=' + Math.round(rect.top);
          }
        }
        return null;
      });
      if (clicked) console.log(`  Clicked: ${label} (JS dispatch: ${clicked})`);
    }
  }

  if (clicked) {
    await page.waitForTimeout(humanDelay());
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);
  } else {
    console.log(`  WARNING: ${label} — Next button not found!`);
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

// Dismiss the "Turn off ad blockers" overlay that prevents saving
async function dismissAdBlockerWarning(page) {
  const dismissed = await page.evaluate(() => {
    const results = [];
    // Find ALL elements related to the ad blocker warning and REMOVE them from DOM
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      const t = el.textContent.trim();
      if (t.includes('Turn off ad blockers') && el.offsetHeight > 0) {
        // Walk up to find the highest overlay/dialog container
        let target = el;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const style = window.getComputedStyle(p);
          if (style.position === 'fixed' || style.position === 'absolute' ||
              p.getAttribute('role') === 'dialog' || p.getAttribute('role') === 'alertdialog' ||
              p.className.includes('overlay') || p.className.includes('dialog') ||
              p.className.includes('modal') || p.className.includes('banner')) {
            target = p;
          }
        }
        target.remove();
        results.push('removed overlay');
      }
    }
    // Also remove any full-screen overlay/backdrop that might block interaction
    for (const el of document.querySelectorAll('[class*="overlay"], [class*="backdrop"], [class*="scrim"]')) {
      const style = window.getComputedStyle(el);
      if ((style.position === 'fixed' || style.position === 'absolute') &&
          el.offsetWidth > window.innerWidth * 0.8 && el.offsetHeight > window.innerHeight * 0.8) {
        el.remove();
        results.push('removed backdrop');
      }
    }
    return results.length > 0 ? results.join(', ') : null;
  });
  if (dismissed) {
    console.log(`  Dismissed ad blocker warning: ${dismissed}`);
    await page.waitForTimeout(2000);
  }
  return dismissed;
}

async function step1_navigate(page) {
  console.log('\n[1/10] Navigating to campaign creation...');

  await page.goto(ADS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(humanDelay());
  await dismissAdBlockerWarning(page);
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
  console.log('\n[2/10] Selecting campaign goal (Website traffic)...');

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

async function step3_selectCampaignType(page) {
  console.log('\n[3/10] Selecting Search campaign type...');

  // Some accounts show a "Search" campaign type card, others skip straight to
  // a combined page with conversion goals + campaign name.
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
  console.log('  Search type:', typeClicked || 'NOT FOUND (may be combined page)');
  await page.waitForTimeout(humanDelay());

  // --- Handle "Page view" conversion goal if present ---
  // Some accounts show conversion goals on this page (e.g. "Page view" radio)
  await selectPageViewGoalIfPresent(page);

  await screenshot(page, '03-type-selected');

  // Scroll down and click Continue
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(humanDelay());

  await waitAndClick(page, [
    'button:has-text("Continue")',
    'material-button:has-text("Continue")',
  ], 'Continue (type page)', 15000);

  await page.waitForTimeout(humanDelay());
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(humanDelay());
  await screenshot(page, '03b-after-continue');
}

// Click "Page view" conversion goal radio if present on current page
async function selectPageViewGoalIfPresent(page) {
  const clicked = await page.evaluate(() => {
    const els = document.querySelectorAll('*');
    for (const el of els) {
      const t = el.textContent.trim();
      if (t.startsWith('Page view') && el.offsetHeight > 0 && el.offsetHeight < 120 && el.offsetWidth > 200) {
        // Click the card/row containing "Page view"
        const radio = el.querySelector('input[type="radio"]');
        if (radio) {
          radio.click();
          return 'radio inside Page view card';
        }
        el.click();
        return 'Page view card at y=' + Math.round(el.getBoundingClientRect().top);
      }
    }
    return null;
  });
  if (clicked) {
    console.log(`  Conversion goal (Page view): ${clicked}`);
    await page.waitForTimeout(1000);
  }
}

async function step4_campaignName(page) {
  console.log('\n[4/10] Setting campaign name + entering wizard...');

  // Handle draft dialog if it appeared
  await dismissDraftIfNeeded(page);
  await page.waitForTimeout(1000);
  await dismissDraftIfNeeded(page);

  // Safety: select Page view goal if it appears on this page (some accounts)
  await selectPageViewGoalIfPresent(page);

  // Scroll down to reveal campaign name section
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);

  // Wait for campaign name input to appear (it renders lazily)
  const nameInput = await page.waitForSelector(
    'input[aria-label*="Campaign name"], input[aria-label*="campaign name"]',
    { timeout: 10000 }
  ).catch(() => null);

  if (nameInput) {
    await nameInput.click();
    await nameInput.fill('');
    await page.waitForTimeout(500);
    await nameInput.type(CAMPAIGN.name, { delay: 50 });
    console.log(`  Campaign name: ${CAMPAIGN.name}`);
  } else {
    console.log('  WARNING: Campaign name field not found — using default.');
  }

  await page.waitForTimeout(humanDelay());
  await screenshot(page, '04-name-set');

  // Click Continue/Next to enter the left-nav wizard
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);

  // Try Next first (button may have changed), then Continue
  let clicked = await waitAndClick(page, [
    'button:has-text("Next")',
    'material-button:has-text("Next")',
  ], 'Next (enter wizard)', 5000);

  if (!clicked) {
    clicked = await waitAndClick(page, [
      'button:has-text("Continue")',
      'material-button:has-text("Continue")',
    ], 'Continue (enter wizard)', 10000);
  }

  await page.waitForTimeout(humanDelay());
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);

  // Draft dialog may appear after this transition
  await dismissDraftIfNeeded(page);
  await page.waitForTimeout(1500);
  await dismissDraftIfNeeded(page);

  await screenshot(page, '04b-entered-wizard');
  const wizState = await detectWizardStep(page);
  console.log('  Wizard state:', JSON.stringify(wizState));
}

// ---------------------------------------------------------------------------
// LEFT-NAV WIZARD STEPS
// Each step: screenshot, do work (if any), click Next
// ---------------------------------------------------------------------------

async function step5_bidding(page) {
  console.log('\n[5/10] Bidding page (accepting defaults)...');
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

async function step6_campaignSettings(page) {
  console.log('\n[6/10] Campaign settings (location + EU political ads)...');
  await dismissDraftIfNeeded(page);
  await screenshot(page, '06-settings');

  // --- LOCATION: click "Enter another location" radio ---
  // Use page.click on the text to trigger the Material radio
  await page.evaluate(() => {
    const els = document.querySelectorAll('*');
    for (const el of els) {
      if (el.childNodes.length <= 3 && el.textContent.trim() === 'Enter another location' && el.offsetHeight > 0) {
        el.scrollIntoView({ block: 'center' });
        el.click();
        return;
      }
    }
  });
  await page.waitForTimeout(2000);

  // --- LOCATION: type Phoenix in the search input ---
  // Google Ads Material input: the visible text "Enter a location to include or exclude" is a label,
  // the actual <input> has no placeholder. Find it by proximity to the label text.
  const locTyped = await page.evaluate((targetLoc) => {
    // Find the label/span with the placeholder text
    const els = document.querySelectorAll('*');
    for (const el of els) {
      const t = el.textContent.trim();
      if (t === 'Enter a location to include or exclude' && el.offsetHeight > 0) {
        // The input is typically a sibling or within the same parent container
        const container = el.closest('div') || el.parentElement;
        const input = container?.querySelector('input') ||
                      container?.parentElement?.querySelector('input') ||
                      container?.parentElement?.parentElement?.querySelector('input');
        if (input) {
          input.scrollIntoView({ block: 'center' });
          input.focus();
          input.click();
          return { found: true, tag: input.tagName };
        }
      }
    }
    // Fallback: find any text input in the Locations section
    const locSection = Array.from(document.querySelectorAll('*')).find(
      el => el.textContent.trim().startsWith('Locations') && el.offsetHeight > 20 && el.offsetHeight < 60
    );
    if (locSection) {
      const parent = locSection.closest('section') || locSection.parentElement?.parentElement;
      const input = parent?.querySelector('input[type="text"], input:not([type])');
      if (input) {
        input.scrollIntoView({ block: 'center' });
        input.focus();
        input.click();
        return { found: true, tag: 'fallback-input' };
      }
    }
    return { found: false };
  }, CAMPAIGN.targetLocation);

  if (locTyped.found) {
    await page.waitForTimeout(500);
    await page.keyboard.type(CAMPAIGN.targetLocation, { delay: 80 });
    console.log(`  Typed location: ${CAMPAIGN.targetLocation}`);
    await page.waitForTimeout(3000); // wait for suggestion dropdown

    // Click the "Include" button WITHIN the suggestion row (not the row text)
    const includeClicked = await page.evaluate((loc) => {
      // Strategy 1: Find "Include" button near Phoenix suggestion
      const allEls = document.querySelectorAll('button, [role="button"], a, material-button, span');
      for (const el of allEls) {
        const t = el.textContent.trim();
        if (t === 'Include' && el.offsetHeight > 0 && el.offsetHeight < 50) {
          const rect = el.getBoundingClientRect();
          if (rect.top > 100 && rect.top < 800) {
            el.click();
            return 'Include at y=' + Math.round(rect.top);
          }
        }
      }
      // Strategy 2: Find "Target" button
      for (const el of allEls) {
        const t = el.textContent.trim();
        if (t === 'Target' && el.offsetHeight > 0 && el.offsetHeight < 50) {
          el.click();
          return 'Target button';
        }
      }
      return null;
    }, CAMPAIGN.targetLocation);
    console.log(`  Location include: ${includeClicked || 'NOT FOUND'}`);

    // Verify: check if a location chip/badge appeared
    await page.waitForTimeout(2000);
    const verified = await page.evaluate((loc) => {
      const body = document.body.textContent;
      return body.includes('Targeted') && body.includes(loc) ? 'verified' : null;
    }, CAMPAIGN.targetLocation);
    console.log(`  Location verified: ${verified || 'not confirmed — may need retry'}`);
  } else {
    console.log('  WARNING: Location input not found, using default (All countries).');
  }

  await page.waitForTimeout(humanDelay());

  // --- EU POLITICAL ADS ---
  // First scroll to the EU political ads section
  await page.evaluate(() => {
    const els = document.querySelectorAll('*');
    for (const el of els) {
      if (el.textContent.trim() === 'EU political ads' && el.offsetHeight > 0 && el.offsetHeight < 60) {
        el.scrollIntoView({ block: 'center' });
        break;
      }
    }
  });
  await page.waitForTimeout(1500);

  // Now click the "No" option
  const euClicked = await page.evaluate(() => {
    const els = document.querySelectorAll('*');
    for (const el of els) {
      const t = el.textContent.trim();
      // Match the specific "No" label text (not parent containers)
      if (t.startsWith('No,') && t.includes('EU political') && el.offsetHeight > 0 && el.offsetHeight < 50) {
        el.scrollIntoView({ block: 'center' });
        el.click();
        return 'clicked: ' + t.substring(0, 60);
      }
    }
    // Fallback: try the second radio in the EU political ads section
    const section = Array.from(document.querySelectorAll('*')).find(
      e => e.textContent.trim() === 'EU political ads' && e.offsetHeight > 0
    );
    if (section) {
      const parent = section.closest('section') || section.parentElement?.parentElement?.parentElement;
      const radios = parent?.querySelectorAll('input[type="radio"]');
      if (radios && radios.length >= 2) {
        radios[1].scrollIntoView({ block: 'center' });
        radios[1].click();
        return 'clicked 2nd radio in EU section';
      }
    }
    return null;
  });
  console.log('  EU political ads (No):', euClicked || 'NOT FOUND — will try to proceed anyway');

  await page.waitForTimeout(humanDelay());
  await screenshot(page, '06b-settings-done');

  // --- CLICK NEXT ---
  // Scroll to very bottom and try to find the Next button
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);

  // Try material-button first (what worked on Bidding page)
  let nextClicked = await waitAndClick(page, [
    'material-button:has-text("Next")',
    'button:has-text("Next")',
  ], 'Next (campaign settings)', 8000);

  // Fallback: use page.evaluate to find and click the Next button element
  if (!nextClicked) {
    nextClicked = await page.evaluate(() => {
      const btns = document.querySelectorAll('material-button, button, [role="button"]');
      for (const btn of btns) {
        const t = btn.textContent.trim();
        if (t === 'Next' && btn.offsetWidth > 0) {
          btn.scrollIntoView({ block: 'center' });
          btn.click();
          const rect = btn.getBoundingClientRect();
          return 'JS click at y=' + Math.round(rect.top);
        }
      }
      return null;
    });
    if (nextClicked) console.log(`  Clicked: Next (campaign settings) (${nextClicked})`);
  }

  if (nextClicked) {
    await page.waitForTimeout(humanDelay());
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);
  } else {
    console.log('  WARNING: Next button not found on Campaign settings!');
  }
}

async function step7_aiMaxAndKeywordGen(page) {
  console.log('\n[7/10] AI Max + Keyword generation (skipping both)...');
  await dismissDraftIfNeeded(page);

  // AI Max page — just screenshot and click Next
  await screenshot(page, '07a-ai-max');
  await clickNext(page, 'Next (AI Max)');

  // Keyword and asset generation page — click "Skip" (not Next)
  await page.waitForTimeout(1000);
  await dismissDraftIfNeeded(page);
  await screenshot(page, '07b-keyword-gen');

  // This page has "Skip" and "Generate" buttons instead of "Next"
  let skipClicked = false;
  try {
    await page.click('text=Skip', { timeout: 5000 });
    skipClicked = true;
    console.log('  Clicked: Skip (keyword generation)');
  } catch {
    // Fallback: JS click
    skipClicked = await page.evaluate(() => {
      const els = document.querySelectorAll('button, [role="button"], material-button, a, span');
      for (const el of els) {
        if (el.textContent.trim() === 'Skip' && el.offsetHeight > 0) {
          el.click();
          return true;
        }
      }
      return false;
    });
    if (skipClicked) console.log('  Clicked: Skip (JS fallback)');
  }

  if (!skipClicked) {
    // Maybe the page didn't transition — try Next as fallback
    console.log('  Skip not found — trying Next...');
    await clickNext(page, 'Next (keyword generation)');
  } else {
    await page.waitForTimeout(humanDelay());
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);
  }

  await screenshot(page, '07c-after-keyword-gen');
}

// Helper: scroll element into view and click it
async function scrollAndClick(page, el) {
  await el.evaluate(e => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await el.click({ force: true });
}

async function step8_keywordsAndAds(page) {
  console.log('\n[8/10] Keywords and ads (main content entry)...');
  await dismissDraftIfNeeded(page);
  await screenshot(page, '08-keywords-start');
  await dumpFormFields(page);

  // --- KEYWORDS ---
  const kwText = CAMPAIGN.keywords.join('\n');
  let kwEntered = false;

  // Find the keywords textarea (has placeholder about "enter or paste keywords")
  const kwTextarea = await page.$('textarea');
  if (kwTextarea) {
    await scrollAndClick(page, kwTextarea);
    await kwTextarea.fill(kwText);
    kwEntered = true;
    console.log(`  Entered ${CAMPAIGN.keywords.length} keywords.`);
  }

  if (!kwEntered) {
    console.log('  WARNING: No keyword textarea found!');
  }

  await page.waitForTimeout(humanDelay());

  // --- SCROLL DOWN to the Ads section ---
  // The page has Keywords section at top, then Ads section below with URL/Headlines/Descriptions
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2000);
  await screenshot(page, '08b-ads-section');
  await dumpFormFields(page);

  // --- FINAL URL ---
  // Find the Final URL input in the ads section (not the keyword suggestions one)
  // The ads section Final URL has aria-label "Final URL" and is near headlines
  const urlInputs = await page.$$('input[aria-label*="Final URL" i]');
  let urlFilled = false;
  for (const inp of urlInputs) {
    const visible = await inp.isVisible().catch(() => false);
    if (visible) {
      await scrollAndClick(page, inp);
      await inp.fill(CAMPAIGN.finalUrl);
      urlFilled = true;
      console.log(`  Final URL: ${CAMPAIGN.finalUrl}`);
      break;
    }
  }
  // Fallback: use evaluate to find by label text
  if (!urlFilled) {
    urlFilled = await page.evaluate((url) => {
      const inputs = document.querySelectorAll('input');
      for (const inp of inputs) {
        const label = (inp.getAttribute('aria-label') || '').toLowerCase();
        if (label.includes('final url') && !label.includes('mobile')) {
          inp.scrollIntoView({ block: 'center' });
          inp.focus();
          inp.value = url;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
      return false;
    }, CAMPAIGN.finalUrl);
    if (urlFilled) console.log(`  Final URL (JS): ${CAMPAIGN.finalUrl}`);
  }
  if (!urlFilled) console.log('  WARNING: Final URL field not found.');

  await page.waitForTimeout(humanDelay());

  // --- HEADLINES ---
  // The headline inputs may not have "Headline" in aria-label. They're plain INPUT[text]
  // grouped after the Final URL. Try multiple selectors.
  let headlineInputs = await page.$$('input[aria-label*="Headline" i]');
  if (headlineInputs.length === 0) {
    // Fallback: find inputs between Final URL and Description sections via evaluate
    headlineInputs = await page.$$eval('input[type="text"]', (inputs) => {
      return inputs.filter(i => {
        const label = i.getAttribute('aria-label') || '';
        return !label.includes('Final URL') && !label.includes('Path') &&
               !label.includes('parameter') && !label.includes('mobile') &&
               !label.includes('Explain') && !label.includes('products') &&
               i.offsetHeight > 0;
      }).map(i => i); // can't return element handles from $$eval
    });
    // $$eval returns serialized data, not handles. Use a different approach.
    headlineInputs = [];
  }

  // Better approach: use evaluate to fill headlines by finding text inputs near "Headline" labels
  if (headlineInputs.length === 0) {
    const filledCount = await page.evaluate((headlines) => {
      let filled = 0;
      const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
      const adInputs = [];
      for (const inp of inputs) {
        const label = (inp.getAttribute('aria-label') || '');
        // Skip known non-headline inputs
        if (label.includes('Final URL') || label.includes('Path') ||
            label.includes('parameter') || label.includes('mobile') ||
            label.includes('Explain') || label.includes('products') ||
            label.includes('keyword') || label.includes('language')) continue;
        if (inp.offsetHeight > 0 && inp.offsetWidth > 100) {
          adInputs.push(inp);
        }
      }
      // The first batch of text inputs after Final URL are headlines
      for (let i = 0; i < Math.min(adInputs.length, headlines.length); i++) {
        adInputs[i].scrollIntoView({ block: 'center' });
        adInputs[i].focus();
        adInputs[i].value = headlines[i];
        adInputs[i].dispatchEvent(new Event('input', { bubbles: true }));
        adInputs[i].dispatchEvent(new Event('change', { bubbles: true }));
        filled++;
      }
      return filled;
    }, CAMPAIGN.headlines);
    if (filledCount > 0) console.log(`  Filled ${filledCount}/${CAMPAIGN.headlines.length} headlines (JS).`);
    else console.log('  WARNING: No headline inputs found.');
  } else {
    for (let i = 0; i < Math.min(headlineInputs.length, CAMPAIGN.headlines.length); i++) {
      await scrollAndClick(page, headlineInputs[i]);
      await headlineInputs[i].fill(CAMPAIGN.headlines[i]);
      await page.waitForTimeout(400);
    }
    console.log(`  Filled ${Math.min(headlineInputs.length, CAMPAIGN.headlines.length)} headlines.`);
  }

  await page.waitForTimeout(humanDelay());

  // --- DESCRIPTIONS ---
  const descInputs = await page.$$('textarea[aria-label*="Description" i], input[aria-label*="Description" i]');
  if (descInputs.length > 0) {
    for (let i = 0; i < Math.min(descInputs.length, CAMPAIGN.descriptions.length); i++) {
      await scrollAndClick(page, descInputs[i]);
      await descInputs[i].fill(CAMPAIGN.descriptions[i]);
      console.log(`  Description ${i + 1}: ${CAMPAIGN.descriptions[i].substring(0, 50)}...`);
      await page.waitForTimeout(500);
    }
  } else {
    // JS fallback for descriptions
    const descFilled = await page.evaluate((descriptions) => {
      const textareas = document.querySelectorAll('textarea');
      let filled = 0;
      for (const ta of textareas) {
        const label = (ta.getAttribute('aria-label') || '').toLowerCase();
        if (label.includes('description') && ta.offsetHeight > 0) {
          ta.scrollIntoView({ block: 'center' });
          ta.focus();
          ta.value = descriptions[filled];
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
          filled++;
          if (filled >= descriptions.length) break;
        }
      }
      return filled;
    }, CAMPAIGN.descriptions);
    if (descFilled > 0) console.log(`  Filled ${descFilled} descriptions (JS).`);
    else console.log('  WARNING: No description fields found.');
  }

  await page.waitForTimeout(humanDelay());
  await screenshot(page, '08c-keywords-done');
  await clickNext(page, 'Next (keywords and ads)');
}

// Dismiss "Confirm it's you" Google security dialog
async function dismissConfirmDialog(page) {
  const dismissed = await page.evaluate(() => {
    const btns = document.querySelectorAll('button, [role="button"], material-button');
    for (const btn of btns) {
      const t = btn.textContent.trim();
      if (t === 'Cancel' && btn.offsetHeight > 0) {
        // Check if this is in a "Confirm it's you" dialog
        const dialog = btn.closest('[role="dialog"], [class*="dialog"], [class*="modal"]') || btn.parentElement?.parentElement;
        if (dialog && dialog.textContent.includes('Confirm')) {
          btn.click();
          return 'cancelled';
        }
      }
    }
    return null;
  });
  if (dismissed) {
    console.log('  Dismissed "Confirm it\'s you" dialog.');
    await page.waitForTimeout(1500);
  }
  return dismissed;
}

async function step9_budget(page) {
  console.log('\n[9/10] Setting budget...');
  await dismissDraftIfNeeded(page);
  await dismissConfirmDialog(page);
  await screenshot(page, '09-budget-start');

  // Budget page uses radio buttons for preset amounts + "Set custom budget" option
  // Click "Set custom budget" to enter our own amount
  const customClicked = await page.evaluate(() => {
    const els = document.querySelectorAll('*');
    for (const el of els) {
      if (el.textContent.trim() === 'Set custom budget' && el.offsetHeight > 0 && el.offsetHeight < 50) {
        el.scrollIntoView({ block: 'center' });
        el.click();
        return true;
      }
    }
    return false;
  });
  if (customClicked) {
    console.log('  Clicked: Set custom budget');
    await page.waitForTimeout(1500);
  }

  // Now look for a text input to enter the budget amount
  let budgetSet = false;

  // After clicking "Set custom budget", an input field should appear
  const budgetInput = await page.evaluate((budget) => {
    const inputs = document.querySelectorAll('input');
    for (const inp of inputs) {
      if (inp.offsetHeight > 0 && inp.type !== 'hidden' && inp.type !== 'radio') {
        const label = (inp.getAttribute('aria-label') || '').toLowerCase();
        const parent = inp.closest('div, section');
        const context = parent ? parent.textContent.toLowerCase() : '';
        if (label.includes('budget') || label.includes('amount') || label.includes('$') ||
            context.includes('custom budget') || context.includes('daily budget')) {
          inp.scrollIntoView({ block: 'center' });
          inp.focus();
          inp.value = '';
          inp.value = budget;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          return 'input: ' + (inp.getAttribute('aria-label') || 'unlabeled');
        }
      }
    }
    return null;
  }, CAMPAIGN.dailyBudget);

  if (budgetInput) {
    budgetSet = true;
    console.log(`  Set budget: $${CAMPAIGN.dailyBudget}/day (${budgetInput})`);
  }

  // Fallback: try any visible text/number input on the page
  if (!budgetSet) {
    const allInputs = await page.$$('input[type="text"], input[type="number"], input:not([type="radio"]):not([type="hidden"])');
    for (const inp of allInputs) {
      const visible = await inp.isVisible().catch(() => false);
      if (visible) {
        const label = await inp.getAttribute('aria-label').catch(() => '');
        if (label && !label.includes('Explain')) {
          await scrollAndClick(page, inp);
          await inp.fill(CAMPAIGN.dailyBudget);
          budgetSet = true;
          console.log(`  Set budget via fallback: $${CAMPAIGN.dailyBudget} (${label})`);
          break;
        }
      }
    }
  }

  if (!budgetSet) {
    console.log('  WARNING: Could not set custom budget — using Google\'s default.');
  }

  await page.waitForTimeout(humanDelay());
  await screenshot(page, '09-budget-done');
  await clickNext(page, 'Next (budget)');
}

async function step10_review(page) {
  console.log('\n[10/10] Review page...');
  await dismissDraftIfNeeded(page);
  await dismissConfirmDialog(page);
  await dismissAdBlockerWarning(page);
  await page.waitForTimeout(3000);
  await dismissAdBlockerWarning(page);
  await screenshot(page, '10-review');

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
  if (PUBLISH_MODE) {
    console.log('\n  --publish mode: scrolling to find Publish button...');

    // Google Ads uses a nested scrollable container — scroll it, not the window
    await page.evaluate(() => {
      // Strategy 1: scroll any scrollable container that holds review content
      const containers = document.querySelectorAll('div, section, main');
      for (const c of containers) {
        if (c.scrollHeight > c.clientHeight + 200 && c.clientHeight > 300) {
          c.scrollTop = c.scrollHeight;
        }
      }
      // Strategy 2: also try body and documentElement
      window.scrollTo(0, document.body.scrollHeight);
      document.documentElement.scrollTop = document.documentElement.scrollHeight;
      // Strategy 3: find "Publish" or bottom elements and scrollIntoView
      const allEls = document.querySelectorAll('material-button, button, [role="button"]');
      for (const el of allEls) {
        const t = el.textContent.trim();
        if (t.includes('Publish') && el.offsetWidth > 0) {
          el.scrollIntoView({ block: 'center' });
          return;
        }
      }
      // Scroll the "Leave feedback" link into view as a fallback to reach the bottom
      const feedback = Array.from(document.querySelectorAll('span, a')).find(
        e => e.textContent.trim() === 'Leave feedback' && e.offsetWidth > 0
      );
      if (feedback) feedback.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(3000);
    await screenshot(page, '10b-review-bottom');

    // Check for error messages on the review page
    const errors = await page.evaluate(() => {
      const errEls = document.querySelectorAll('[class*="error"], [class*="warning"], [class*="alert"]');
      const msgs = [];
      for (const el of errEls) {
        if (el.offsetHeight > 0 && el.textContent.trim().length > 5 && el.textContent.trim().length < 200) {
          msgs.push(el.textContent.trim());
        }
      }
      // Also check for red text
      const allEls = document.querySelectorAll('span, div, p');
      for (const el of allEls) {
        const style = window.getComputedStyle(el);
        if (style.color.includes('211, 47') || style.color.includes('213, 0') || style.color.includes('234, 67') || style.color.includes('244, 67')) {
          const t = el.textContent.trim();
          if (t.length > 3 && t.length < 200 && !msgs.includes(t)) msgs.push(t);
        }
      }
      return [...new Set(msgs)].slice(0, 10);
    });
    console.log('  Review errors:', JSON.stringify(errors));

    // Dump all visible buttons for debugging
    const allBtns = await page.evaluate(() => {
      const btns = document.querySelectorAll('material-button, button, [role="button"]');
      return Array.from(btns).filter(b => b.offsetWidth > 0).map(b => ({
        text: b.textContent.trim().substring(0, 40),
        tag: b.tagName,
        y: Math.round(b.getBoundingClientRect().top),
      }));
    });
    console.log('  Visible buttons:', JSON.stringify(allBtns));

    // Click the Publish campaign button
    let published = false;
    try {
      await page.click('material-button:has-text("Publish")', { timeout: 5000 });
      published = true;
      console.log('  Clicked: Publish (material-button)');
    } catch {
      try {
        await page.click('button:has-text("Publish")', { timeout: 5000 });
        published = true;
        console.log('  Clicked: Publish (button)');
      } catch {
        published = await page.evaluate(() => {
          const btns = document.querySelectorAll('material-button, button, [role="button"]');
          for (const btn of btns) {
            const t = btn.textContent.trim();
            if ((t.includes('Publish') || t.includes('publish')) && btn.offsetWidth > 0) {
              btn.scrollIntoView({ block: 'center' });
              btn.click();
              const rect = btn.getBoundingClientRect();
              const evt = new MouseEvent('click', {
                bubbles: true, cancelable: true, view: window,
                clientX: rect.left + rect.width / 2,
                clientY: rect.top + rect.height / 2,
              });
              btn.dispatchEvent(evt);
              return true;
            }
          }
          return false;
        });
        if (published) console.log('  Clicked: Publish (JS dispatch)');
      }
    }

    if (published) {
      await page.waitForTimeout(5000);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(3000);
      await screenshot(page, '10c-after-publish');
      console.log('  Campaign published! Waiting 10s for confirmation...');
      await page.waitForTimeout(10000);
      await screenshot(page, '10d-published-final');
    } else {
      console.log('  WARNING: Publish button not found. Browser stays open 120s for manual publish.');
      await page.waitForTimeout(120000);
    }
    return;
  }

  if (TEST_MODE) {
    console.log('\n  --test mode: NOT publishing. Browser stays open 120s for manual action...');
    console.log('  Go to the Chromium window to review or publish.');
    await page.waitForTimeout(120000);
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
  node create-campaign.js                              Create campaign (interactive, default config)
  node create-campaign.js --config campaigns/xyz.json  Load campaign config from JSON file
  node create-campaign.js --test                       Auto-close after review (no publish)
  node create-campaign.js --dry-run                    Show config without launching browser

Available configs:
  campaigns/french-drain.json
  campaigns/mobile-detailing.json
  campaigns/pressure-washing.json
  campaigns/junk-removal.json

Example:
  node create-campaign.js --config campaigns/french-drain.json --test
`);
    process.exit(0);
  }

  if (args.includes('--dry-run')) {
    console.log('Campaign config:');
    console.log(JSON.stringify(CAMPAIGN, null, 2));
    process.exit(0);
  }

  console.log('Launching Google Ads Campaign Creator...');
  console.log(`Account: ${ACCOUNT_ID} | Mode: ${PUBLISH_MODE ? 'AUTO-PUBLISH' : TEST_MODE ? 'TEST (120s window)' : 'INTERACTIVE'}`);
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
    await step3_selectCampaignType(page);
    await step4_campaignName(page);

    // Left-nav wizard steps
    await step5_bidding(page);
    await step6_campaignSettings(page);
    await step7_aiMaxAndKeywordGen(page);
    await step8_keywordsAndAds(page);
    await step9_budget(page);
    await step10_review(page);
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
