'use strict';
// Print for Review: the summary the screen shows, then a table whose text
// never runs into the next column. jsPDF draws into a canvas-less document,
// so we hook jsPDF's own text()/addPage()/save() and measure the runs it
// emits with the same getTextWidth the layout uses.
const { test, expect } = require('@playwright/test');

const PAGE_W = 612;
const MARGIN = 40;

async function seedBid(page) {
  await page.goto('/');
  await page.evaluate(() => {
    // wipe the seed row, then build a bid with the shapes that used to break
    // the layout: a very long description, a per-foot labor rate that rounds
    // to nothing at one decimal, and an Other-charges row carrying labor.
    for (const item of TakeoffState.getTopLevelItems().slice()) TakeoffState.removeItem(item.id);
    TakeoffState.setLaborRate(92);
    TakeoffState.addItem({ type: 'lighting', description: '2x4 LED Recessed Troffer, 40W, 4000K, dimmable, with emergency battery pack and wire guard', quantity: 10, labor: 0.75, price: 89.5, planPage: 'E2.1 / North wing', parentId: null });
    TakeoffState.addItem({ type: 'wire', description: '#12 THHN Stranded Copper', quantity: 3000, labor: 0.006, price: 0.18, planPage: 'E3', parentId: null });
    TakeoffState.addItem({ type: 'powerCoCharges', description: 'County power company connection', quantity: 1, labor: 3, price: 500, planPage: '', parentId: null });
    const run = TakeoffState.addItem({ type: 'devices', description: 'Duplex receptacle run', quantity: 24, labor: 0, price: null, planPage: 'E2.2', parentId: null });
    TakeoffState.addItem({ type: 'box', description: '4" square box, 2-1/8" deep, with mud ring', quantity: 24, labor: 0.2, price: 3.15, parentId: run.id });
    TakeoffApp.render();
  });
}

// Hook jsPDF so every text run it draws is recorded with its measured width
// and the page it landed on. save() is stubbed so no download is started.
async function recordPdf(page, buttonId) {
  await page.evaluate(() => {
    window.__runs = [];
    window.__pageNo = 1;
    // jsPDF 2.5.1 assigns its API onto each instance, not the prototype, so
    // the constructor is what has to be wrapped.
    const Orig = jspdf.jsPDF;
    const Wrapped = function () {
      const doc = new Orig(...arguments);
      const origText = doc.text.bind(doc);
      const origAddPage = doc.addPage.bind(doc);
      const origSetPage = doc.setPage.bind(doc);
      doc.addPage = function () {
        window.__pageNo += 1;
        return origAddPage(...arguments);
      };
      // the page footers are stamped in a final pass that revisits every page
      doc.setPage = function (n) {
        window.__pageNo = n;
        return origSetPage(...arguments);
      };
      doc.text = function (text, x, y, options) {
        const str = String(text);
        let w = 0;
        try { w = doc.getTextWidth(str); } catch (e) { w = 0; }
        const align = (options && options.align) || 'left';
        const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
        window.__runs.push({ page: window.__pageNo, text: str, y, left, right: left + w, width: w });
        return origText(...arguments);
      };
      doc.save = function (name) { window.__saved = true; window.__savedAs = name; return doc; };
      return doc;
    };
    Wrapped.prototype = Orig.prototype;
    jspdf.jsPDF = Wrapped;
  });
  if (!(await page.locator('#' + buttonId).isVisible())) {
    await page.locator('#print-options-toggle').click();
  }
  await page.locator('#' + buttonId).click();
  return page.evaluate(() => ({ runs: window.__runs, pages: window.__pageNo, saved: !!window.__saved, savedAs: window.__savedAs }));
}

// runs sharing a baseline are neighbouring cells: they must not touch, and
// nothing may leave the printable width.
function expectNoOverruns(runs) {
  for (const r of runs) {
    expect(r.left, `"${r.text}" starts left of the margin`).toBeGreaterThanOrEqual(MARGIN - 0.5);
    expect(r.right, `"${r.text}" runs past the right margin`).toBeLessThanOrEqual(PAGE_W - MARGIN + 0.5);
  }
  const byLine = new Map();
  for (const r of runs) {
    const key = r.page + '@' + r.y.toFixed(2);
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(r);
  }
  for (const [key, line] of byLine) {
    line.sort((a, b) => a.left - b.left);
    for (let i = 1; i < line.length; i++) {
      expect(
        line[i].left,
        `on ${key}: "${line[i - 1].text}" (ends ${line[i - 1].right.toFixed(1)}) runs into "${line[i].text}" (starts ${line[i].left.toFixed(1)})`
      ).toBeGreaterThanOrEqual(line[i - 1].right - 0.5);
    }
  }
}

test('Review PDF: page 1 carries the summary the screen shows', async ({ page }) => {
  await seedBid(page);

  const screen = await page.evaluate(() => {
    const s = TakeoffState.getSummaryBreakdown();
    const rate = TakeoffState.getLaborRate();
    return {
      laborTotal: s.laborTotal,
      grand: s.materialsTotal + s.laborTotal * rate + s.otherTotal,
      materialsTotal: s.materialsTotal,
    };
  });

  const { runs, saved } = await recordPdf(page, 'print-review-btn');
  expect(saved).toBe(true);
  const p1 = runs.filter((r) => r.page === 1).map((r) => r.text);

  // same words as the screen's three blocks
  for (const word of ['MATERIALS', 'LABOR', 'OTHER CHARGES', 'Sub Total', 'Materials TOTAL $', 'Labor TOTAL (hrs)', 'Labor Rate ($/Hr)', 'Other TOTAL $', 'Grand Total']) {
    expect(p1, `page 1 should say "${word}"`).toContain(word);
  }
  // dollars with cents, and the same grand total
  const grandText = p1.find((t) => /^\$[\d,]+\.\d\d$/.test(t) && Number(t.replace(/[$,]/g, '')).toFixed(2) === screen.grand.toFixed(2));
  expect(grandText, `page 1 should print the grand total ${screen.grand.toFixed(2)}; got ${JSON.stringify(p1)}`).toBeTruthy();
  expect(p1).toContain(screen.laborTotal.toFixed(2));
});

test('Review PDF: labor totals match the screen (Other-charges labor included the same way)', async ({ page }) => {
  await seedBid(page);
  const screenLabor = await page.evaluate(() => TakeoffState.getSummaryBreakdown().laborTotal);
  // the power-company row carries 3 hrs that the old getTotalLabor() counted
  // and the screen did not; whichever way that branch is settled, the PDF has
  // to print the screen's number
  const legacyTotal = await page.evaluate(() => TakeoffState.getTotalLabor());

  const { runs } = await recordPdf(page, 'print-review-btn');
  const footer = runs.map((r) => r.text).filter((t) => t.startsWith('Labor TOTAL (hrs):'));
  expect(footer.length).toBe(1);
  expect(footer[0]).toBe('Labor TOTAL (hrs): ' + screenLabor.toFixed(2));
  if (legacyTotal !== screenLabor) expect(footer[0]).not.toContain(legacyTotal.toFixed(2));
});

test('Review PDF: no text run overruns its column or the page', async ({ page }) => {
  await seedBid(page);
  const { runs, pages } = await recordPdf(page, 'print-review-btn');
  expect(pages).toBeGreaterThanOrEqual(2);

  expectNoOverruns(runs);

  // labor prints at two decimals, and per-foot work is no longer "free"
  const texts = runs.map((r) => r.text);
  expect(texts).toContain('0.01'); // 0.006 hrs/ft, which used to print 0.0
  expect(texts).toContain('18.00'); // extended: 3,000 ft x 0.006
  // display labels, not internal keys
  expect(texts).toContain('Power co. charges');
  expect(texts.some((t) => t === 'powerCoC' || t === 'powerCoCharges')).toBe(false);
  expect(texts).toContain('Box'); // the child type label, not "box"
});

// --- Purchase list (PO) — T2-21 -------------------------------------------
// The PO PDF used to be the manifest tree with quantities: grouping rows,
// permits and utility fees on it, duplicates unmerged, and not one dollar or
// total anywhere. It is now the same report the screen shows.

test('Purchase list (PO) PDF: carries the on-screen list’s lines, prices and total', async ({ page }) => {
  await seedBid(page);
  // one material with no price, so the "without a price" flag has something
  // to count
  await page.evaluate(() => {
    TakeoffState.addItem({ type: 'gear', description: 'Panel LP-1 tub and trim', quantity: 2, labor: 1, price: null, planPage: '', parentId: null });
    TakeoffApp.render();
  });
  const report = await page.evaluate(() => TakeoffState.getPurchaseList());
  expect(report.unpricedCount).toBe(1);

  const { runs, saved, savedAs } = await recordPdf(page, 'print-po-btn');
  expect(saved).toBe(true);
  const texts = runs.map((r) => r.text);

  // the screen's own columns
  for (const head of ['Qty', 'Material', 'Unit $', 'Extended $']) expect(texts).toContain(head);
  // every merged line, by the description the screen shows (a description too
  // wide for its box is wrapped across runs, so match the reflowed text)
  const flowed = texts.join(' ').replace(/\s+/g, ' ');
  for (const line of report.lines) {
    expect(flowed, `the PO should list "${line.description}"`).toContain(line.description);
  }
  // ...and the materials total, to the cent
  expect(texts).toContain('Materials total (before tax)');
  const totalText = '$' + report.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  expect(texts, `the PO should print the total ${totalText}`).toContain(totalText);
  // unpriced lines are counted where the supply house can see it
  expect(texts.some((t) => t.includes(`${report.unpricedCount} without a price`))).toBe(true);

  // what the tree dump used to put on a supply house's desk
  expect(texts).not.toContain('Duplex receptacle run'); // a price-less grouping row
  expect(texts).not.toContain('County power company connection'); // an Other charge
  expect(texts.some((t) => /Purchase list \(PO\)/.test(t))).toBe(true);
  expect(savedAs).toMatch(/-purchase-list-\d{4}-\d{2}-\d{2}\.pdf$/);

  expectNoOverruns(runs);
});

// --- Print with form — T2-20 ----------------------------------------------

test('Form PDF: prints the job’s own details under the project name on page 1', async ({ page }) => {
  await seedBid(page);
  await page.evaluate(() => {
    TakeoffState.setProjectName('Cedar Ridge Clinic');
    TakeoffState.setProjectDetails({
      client: 'Ridgeline Construction',
      address: '1450 Cedar Ridge Rd',
      permitNo: 'E-2026-0413',
      builderOrOccupant: 'Ridgeline / Cedar Ridge Clinic',
      dueDate: 'Oct 2',
    });
    TakeoffApp.render();
  });

  const { runs, saved, savedAs } = await recordPdf(page, 'print-form-btn');
  expect(saved).toBe(true);
  const p1 = runs.filter((r) => r.page === 1).map((r) => r.text);

  for (const word of ['Client', 'Address', 'Permit no.', 'Builder or occupant', 'Due date']) {
    expect(p1, `page 1 should label "${word}"`).toContain(word);
  }
  for (const value of ['Ridgeline Construction', '1450 Cedar Ridge Rd', 'E-2026-0413', 'Oct 2']) {
    expect(p1, `page 1 should print "${value}"`).toContain(value);
  }
  // the details sit above the line items, not in a footer after the last row
  const detailY = runs.find((r) => r.text === 'Client').y;
  const firstItemY = runs.find((r) => r.text === 'Description' && r.page === 1).y;
  expect(detailY).toBeLessThan(firstItemY);
  expect(savedAs).toMatch(/^cedar-ridge-clinic-form-\d{4}-\d{2}-\d{2}\.pdf$/);

  expectNoOverruns(runs);
});

test('Form PDF: a bid with no details still prints', async ({ page }) => {
  await seedBid(page);
  const { runs, saved } = await recordPdf(page, 'print-form-btn');
  expect(saved).toBe(true);
  expect(runs.map((r) => r.text)).not.toContain('Client');
});

// --- Filenames — B10 -------------------------------------------------------

test('every PDF is named after the job and the day, with / and : stripped', async ({ page }) => {
  await seedBid(page);
  await page.evaluate(() => {
    TakeoffState.setProjectName('Bldg 3/4: North wing');
    TakeoffApp.render();
  });
  const today = new Date();
  const stamp = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');

  for (const [btn, kind] of [['print-review-btn', 'review'], ['print-po-btn', 'purchase-list'], ['print-form-btn', 'form']]) {
    const { savedAs } = await recordPdf(page, btn);
    expect(savedAs).toBe(`bldg-3-4-north-wing-${kind}-${stamp}.pdf`);
    expect(savedAs).not.toContain('/');
    expect(savedAs).not.toContain(':');
  }
});
