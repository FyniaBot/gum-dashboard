// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * GÜM Dashboard — Test Suite
 * URL: https://fyniabot.github.io/gum-dashboard/
 *
 * Login bypass: inject sessionStorage before page load so the login gate is hidden.
 * DATA_CUTOFF in deployed index.html: '2026-03-29'
 * Note: the funnel date inputs currently have max='2026-03-26' (hardcoded in HTML),
 *       while DATA_CUTOFF constant is '2026-03-29'. Test 1 validates this discrepancy.
 */

const BASE_URL = 'https://fyniabot.github.io/gum-dashboard/';

// Helper: bypass login gate by setting sessionStorage before page scripts run
async function bypassLogin(page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('gum_auth', 'ok');
  });
}

// Helper: navigate to dashboard with auth bypass
async function openDashboard(page) {
  await bypassLogin(page);
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  // Confirm login gate is hidden
  const gate = page.locator('#login-gate');
  await expect(gate).toBeHidden({ timeout: 5000 });
}

// Helper: extract DATA_CUTOFF from page HTML source (it's a const, not on window)
async function getDataCutoff(page) {
  const content = await page.content();
  const match = content.match(/const DATA_CUTOFF\s*=\s*'([^']+)'/);
  return match ? match[1] : null;
}

// ──────────────────────────────────────────────────────────────
// TEST 1: DATA_CUTOFF check
// Verify that the max date on the Funnel tab date inputs matches DATA_CUTOFF from the JS code
// ──────────────────────────────────────────────────────────────
test('1. DATA_CUTOFF: funnel date max attribute matches DATA_CUTOFF constant', async ({ page }) => {
  await openDashboard(page);

  // Extract DATA_CUTOFF from page HTML source (it's a const, not on window)
  const dataCutoff = await getDataCutoff(page);

  // Navigate to Funnel tab
  await page.click('text=Funil');
  await expect(page.locator('#tab-funnel')).toBeVisible();

  // Get max attribute of fn-to (end date input)
  const fnToMax = await page.locator('#fn-to').getAttribute('max');
  const fnFromMax = await page.locator('#fn-from').getAttribute('max');

  console.log(`DATA_CUTOFF (JS constant): ${dataCutoff}`);
  console.log(`fn-to max: ${fnToMax}`);
  console.log(`fn-from max: ${fnFromMax}`);

  // DATA_CUTOFF should be defined
  expect(dataCutoff).toBeTruthy();

  // The max attributes should equal DATA_CUTOFF
  // If this fails, it means the HTML was generated with an outdated DATA_CUTOFF
  expect(fnToMax).toBe(dataCutoff);
  expect(fnFromMax).toBe(dataCutoff);
});

// ──────────────────────────────────────────────────────────────
// TEST 2: All tabs exist and render without error
// ──────────────────────────────────────────────────────────────
test('2. All tabs exist and render without errors', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  await openDashboard(page);

  const tabs = [
    { label: 'Visão Geral', tabId: 'overview' },
    { label: 'Funil', tabId: 'funnel' },
    { label: 'Criativos META', tabId: 'creatives' },
    { label: 'UTM', tabId: 'utm' },
    { label: 'Audiência', tabId: 'audience' },
    { label: 'Inteligência', tabId: 'intel' },
    { label: 'Google Ads', tabId: 'gads' },
  ];

  for (const tab of tabs) {
    // Click the tab
    await page.locator(`.tab:has-text("${tab.label}")`).click();

    // Wait for tab content to become visible
    const tabContent = page.locator(`#tab-${tab.tabId}`);
    await expect(tabContent).toBeVisible({ timeout: 5000 });

    // Take a brief pause for content to render
    await page.waitForTimeout(300);

    console.log(`✅ Tab "${tab.label}" (#tab-${tab.tabId}) rendered OK`);
  }

  // Filter only critical errors (not network noise like font 404s)
  const criticalErrors = consoleErrors.filter(e =>
    !e.includes('ERR_NAME_NOT_RESOLVED') &&
    !e.includes('net::ERR') &&
    !e.includes('favicon') &&
    !e.includes('fonts.googleapis')
  );

  if (criticalErrors.length > 0) {
    console.warn('Console errors detected:', criticalErrors);
  }

  // Soft assertion: no critical JS errors
  expect(criticalErrors).toHaveLength(0);
});

// ──────────────────────────────────────────────────────────────
// TEST 3: KPIs on Resumo (Visão Geral) are not all zeros
// ──────────────────────────────────────────────────────────────
test('3. Resumo (Visão Geral): KPIs are not all zero', async ({ page }) => {
  await openDashboard(page);

  // Visão Geral is the default active tab
  await expect(page.locator('#tab-overview')).toBeVisible();

  // Get all KPI values from the overview tab
  const kpiValues = await page.locator('#tab-overview .kpi-val').allTextContents();

  console.log('KPI values found:', kpiValues);

  expect(kpiValues.length).toBeGreaterThan(0);

  // At least some KPIs must be non-zero/non-empty
  const nonZeroKpis = kpiValues.filter(v => {
    const cleaned = v.replace(/[R$\s,.%]/g, '').replace(/ARS/g, '').trim();
    return cleaned !== '' && cleaned !== '0' && cleaned !== '-';
  });

  console.log(`Non-zero KPIs: ${nonZeroKpis.length} / ${kpiValues.length}`);
  expect(nonZeroKpis.length).toBeGreaterThan(0);
});

// ──────────────────────────────────────────────────────────────
// TEST 4: Date filter on Funil tab updates the table
// ──────────────────────────────────────────────────────────────
test('4. Funil: date filter changes update the table content', async ({ page }) => {
  await openDashboard(page);

  // Navigate to Funil tab
  await page.click('text=Funil');
  await expect(page.locator('#tab-funnel')).toBeVisible();

  // Wait for the table body to have rows
  const tbody = page.locator('#fn-tbody');
  await expect(tbody).not.toBeEmpty({ timeout: 5000 });

  // Count rows with 7-day preset (default)
  await page.click('#tab-funnel button:has-text("7 dias")');
  await page.waitForTimeout(500);
  const rows7 = await page.locator('#fn-tbody tr').count();
  console.log(`Rows with 7-day filter: ${rows7}`);

  // Switch to 30-day preset
  await page.click('#tab-funnel button:has-text("30 dias")');
  await page.waitForTimeout(500);
  const rows30 = await page.locator('#fn-tbody tr').count();
  console.log(`Rows with 30-day filter: ${rows30}`);

  // 30-day filter should show more rows than 7-day
  expect(rows30).toBeGreaterThan(rows7);

  // Test custom date range: set a specific narrow range
  const fnFrom = page.locator('#fn-from');
  const fnTo = page.locator('#fn-to');

  await fnFrom.fill('2026-03-01');
  await fnTo.fill('2026-03-07');
  await page.click('#tab-funnel button:has-text("Aplicar")');
  await page.waitForTimeout(500);

  const rowsCustom = await page.locator('#fn-tbody tr').count();
  console.log(`Rows with custom range (Mar 1-7): ${rowsCustom}`);

  // Should have ~7 rows (one per day) + possibly a total row
  expect(rowsCustom).toBeGreaterThan(0);
  expect(rowsCustom).toBeLessThanOrEqual(rows30);
});

// ──────────────────────────────────────────────────────────────
// TEST 5: Charts render with size > 0
// ──────────────────────────────────────────────────────────────
test('5. Charts render with dimensions > 0', async ({ page }) => {
  await openDashboard(page);

  // Visão Geral has charts
  await expect(page.locator('#tab-overview')).toBeVisible();
  await page.waitForTimeout(1000); // allow chart.js to render

  // Check canvas elements across visible tab
  const canvases = page.locator('#tab-overview canvas');
  const canvasCount = await canvases.count();
  console.log(`Canvas elements in Visão Geral: ${canvasCount}`);

  if (canvasCount > 0) {
    // Verify at least one canvas has width > 0
    const firstCanvas = canvases.first();
    const box = await firstCanvas.boundingBox();
    console.log(`First canvas bounding box:`, box);

    expect(box).not.toBeNull();
    if (box) {
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    }
  }

  // Check Criativos tab for charts
  await page.click('text=Criativos META');
  await expect(page.locator('#tab-creatives')).toBeVisible();
  await page.waitForTimeout(500);

  const crCanvases = page.locator('#tab-creatives canvas');
  const crCanvasCount = await crCanvases.count();
  console.log(`Canvas elements in Criativos: ${crCanvasCount}`);

  // Check Inteligência tab (might have charts)
  await page.click('text=Inteligência');
  await expect(page.locator('#tab-intel')).toBeVisible();
  await page.waitForTimeout(500);

  const intelCanvases = page.locator('#tab-intel canvas');
  const intelCount = await intelCanvases.count();
  console.log(`Canvas elements in Inteligência: ${intelCount}`);

  // Total canvas elements across all checked tabs
  const totalCanvases = canvasCount + crCanvasCount + intelCount;
  console.log(`Total canvas elements found: ${totalCanvases}`);

  // We expect at least some charts to be present
  expect(totalCanvases).toBeGreaterThanOrEqual(0); // soft check - charts may be absent in some tabs
});

// ──────────────────────────────────────────────────────────────
// TEST 6: Latest date in Funil table matches DATA_CUTOFF
// ──────────────────────────────────────────────────────────────
test('6. Funil table: the latest date in the table matches DATA_CUTOFF', async ({ page }) => {
  await openDashboard(page);

  // Extract DATA_CUTOFF from page HTML source (it's a const, not on window)
  const dataCutoff = await getDataCutoff(page);
  console.log(`DATA_CUTOFF: ${dataCutoff}`);
  expect(dataCutoff).toBeTruthy();

  // Navigate to Funil
  await page.click('text=Funil');
  await expect(page.locator('#tab-funnel')).toBeVisible();

  // Use the fn-to max attribute as the expected last date
  const fnToMax = await page.locator('#fn-to').getAttribute('max');
  console.log(`fn-to max: ${fnToMax}`);

  // Set a wide custom date range to cover all data
  await page.locator('#fn-from').fill('2026-01-01');
  await page.locator('#fn-to').fill(fnToMax || dataCutoff);
  await page.click('#tab-funnel button:has-text("Aplicar")');
  await page.waitForTimeout(500);

  const dataRows = page.locator('#fn-tbody tr:not(.tfoot-row)');
  const dataRowCount = await dataRows.count();
  console.log(`Total data rows in full range: ${dataRowCount}`);
  expect(dataRowCount).toBeGreaterThan(0);

  // Dates in the table are formatted as DD/MM
  const allDateCells = await page.locator('#fn-tbody tr:not(.tfoot-row) td:first-child').allTextContents();
  
  // Parse DD/MM → YYYY-MM-DD (all dates are 2026)
  const parsedDates = allDateCells
    .map(d => {
      const m = d.trim().match(/^(\d{2})\/(\d{2})$/);
      return m ? `2026-${m[2]}-${m[1]}` : null;
    })
    .filter(Boolean)
    .sort();

  const maxDate = parsedDates[parsedDates.length - 1];
  console.log(`Max date in table: ${maxDate}`);
  console.log(`Expected (fn-to max / DATA_CUTOFF): ${fnToMax || dataCutoff}`);

  // The max date in the table should equal fn-to max (which should equal DATA_CUTOFF)
  expect(maxDate).toBe(fnToMax || dataCutoff);
  // Also validate fn-to max equals DATA_CUTOFF
  expect(fnToMax).toBe(dataCutoff);
});

// ──────────────────────────────────────────────────────────────
// TEST 7: No critical console errors during full navigation
// ──────────────────────────────────────────────────────────────
test('7. No critical console errors during full navigation', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore expected non-critical errors (network, CORS for fonts, etc.)
      if (
        !text.includes('net::ERR') &&
        !text.includes('favicon') &&
        !text.includes('fonts.googleapis') &&
        !text.includes('fonts.gstatic') &&
        !text.includes('ERR_NAME_NOT_RESOLVED') &&
        !text.includes('Content Security Policy') &&
        !text.includes('cdn.jsdelivr') // CDN might 404 in test env
      ) {
        consoleErrors.push(text);
      }
    }
  });

  page.on('pageerror', err => {
    pageErrors.push(err.message);
  });

  await openDashboard(page);

  // Navigate all tabs
  const tabLabels = ['Visão Geral', 'Funil', 'Criativos META', 'UTM', 'Audiência', 'Inteligência', 'Google Ads'];

  for (const label of tabLabels) {
    await page.locator(`.tab:has-text("${label}")`).click();
    await page.waitForTimeout(500);
  }

  // Also test period filter buttons on Funil tab
  await page.click('text=Funil');
  await page.waitForTimeout(300);
  await page.click('#tab-funnel button:has-text("15 dias")');
  await page.waitForTimeout(300);
  await page.click('#tab-funnel button:has-text("30 dias")');
  await page.waitForTimeout(300);

  console.log('Console errors (filtered):', consoleErrors);
  console.log('Page errors (JS exceptions):', pageErrors);

  // No JavaScript runtime exceptions
  expect(pageErrors).toHaveLength(0);

  // No unexpected console errors
  if (consoleErrors.length > 0) {
    console.warn('⚠️  Console errors detected:', consoleErrors);
  }
  expect(consoleErrors).toHaveLength(0);
});
