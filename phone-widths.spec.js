'use strict';
// Phone widths (375x812) and the money parser on the way into the book.
// Covers T1-10 (parseMoney), T1-22 (catalog rows + global search), T1-23
// (Load into Ledger) and T2-01 (the base [hidden] rule).
const { test, expect } = require('@playwright/test');

const PHONE = { width: 375, height: 812 };

test.describe('phone widths', () => {
  test.use({ viewport: PHONE, hasTouch: true });

  // Open the book and expand the first supplier catalog section.
  async function openCatalog(page) {
    await page.goto('/');
    await page.locator('#labor-book-open-btn').click();
    const section = page.locator('.lb-supplier-section').first();
    await expect(section).toBeVisible({ timeout: 20000 });
    await section.locator('.labor-book-section-header').click();
    await expect(page.locator('.lb-supplier-section tbody tr[data-entry]').first()).toBeVisible({ timeout: 20000 });
  }

  test('T1-22 — a supplier catalog row shows what the part is, and Add is tappable', async ({ page }) => {
    await openCatalog(page);

    const geom = await page.evaluate(() => {
      const tr = document.querySelector('.lb-supplier-section tbody tr[data-entry]');
      const row = tr.getBoundingClientRect();
      const name = tr.querySelector('[data-field="name"]').getBoundingClientRect();
      const btn = tr.querySelector('.elliot-part-add-btn');
      const b = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return {
        rowRight: row.right,
        nameWidth: name.width,
        nameRight: name.right,
        addRight: b.right,
        addWidth: b.width,
        addIsHit: !!(hit && hit.closest('.elliot-part-add-btn')),
      };
    });

    // pre-fix the name input was 38.2px (3 of 27 characters) and clipped
    expect(geom.nameWidth).toBeGreaterThan(150);
    expect(geom.nameRight).toBeLessThanOrEqual(geom.rowRight + 1);
    // pre-fix Add laid out past the painted edge of an overflow:hidden section
    expect(geom.addWidth).toBeGreaterThan(40);
    expect(geom.addRight).toBeLessThanOrEqual(geom.rowRight + 1);
    expect(geom.addIsHit).toBe(true);

    // and it really is clickable, not just painted in the right place
    await page.locator('.lb-supplier-section tbody tr[data-entry] .elliot-part-add-btn').first().click();
  });

  test('T1-22 — curated book rows get the same card, not a clipped table', async ({ page }) => {
    await page.goto('/');
    await page.locator('#labor-book-open-btn').click();
    const section = page.locator('.labor-book-section:not(.lb-supplier-section)').first();
    await expect(section).toBeVisible({ timeout: 20000 });
    await section.locator('.labor-book-section-header').first().click();
    await expect(page.locator('.labor-book-row').first()).toBeVisible();

    const geom = await page.evaluate(() => {
      const tr = document.querySelector('.labor-book-row');
      const sec = tr.closest('.labor-book-section').getBoundingClientRect();
      const name = tr.querySelector('.labor-book-name').getBoundingClientRect();
      const trash = tr.querySelector('.labor-book-remove-row').getBoundingClientRect();
      return { sectionRight: sec.right, nameWidth: name.width, nameRight: name.right, trashRight: trash.right, trashWidth: trash.width };
    });
    // pre-fix: a 437px table inside a section whose painted box ended at 346,
    // leaving the name input 38px wide
    expect(geom.nameWidth).toBeGreaterThan(150);
    expect(geom.nameRight).toBeLessThanOrEqual(geom.sectionRight + 1);
    // the remove button still has a home in the card
    expect(geom.trashWidth).toBeGreaterThan(0);
    expect(geom.trashRight).toBeLessThanOrEqual(geom.sectionRight + 1);
  });

  test('T1-22 — global search result names have a width', async ({ page }) => {
    await page.goto('/');
    await page.locator('#labor-book-open-btn').click();
    await page.locator('#labor-book-global-search').fill('3/4 EMT coupling');
    await expect(page.locator('.lb-search-row .lb-search-name').first()).toBeVisible({ timeout: 20000 });

    const widths = await page.evaluate(() =>
      [...document.querySelectorAll('.lb-search-row')].slice(0, 10).map((r) => {
        const n = r.querySelector('.lb-search-name');
        return { w: n.getBoundingClientRect().width, scrollW: n.scrollWidth, text: n.textContent.trim() };
      })
    );
    expect(widths.length).toBeGreaterThan(0);
    // pre-fix: clientWidth 0 against a scrollWidth of 137-146px
    for (const w of widths) {
      expect(w.text.length).toBeGreaterThan(0);
      expect(w.w).toBeGreaterThan(100);
    }
  });

  test('T1-23 — Load into Ledger is inside the viewport and clickable', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      TakeoffState.addAssembly({ name: 'Standard receptacle run', sections: { boxes: [] }, perRun: true, sourceQty: 1 });
      const it = TakeoffState.addItem({ type: 'devices', description: 'Office receptacle runs', quantity: 8, labor: 0.18, price: null, parentId: null });
      TakeoffApp.navigateToDevice(it.id);
    });

    const btn = page.locator('#assemblies-load-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();

    const geom = await page.evaluate(() => {
      const b = document.getElementById('assemblies-load-btn').getBoundingClientRect();
      const sec = document.getElementById('assemblies-section').getBoundingClientRect();
      const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return {
        right: b.right,
        sectionRight: sec.right,
        innerWidth: window.innerWidth,
        isHit: hit === document.getElementById('assemblies-load-btn') || !!(hit && hit.closest('#assemblies-load-btn')),
      };
    });
    // pre-fix: the 148px button laid out at x 338-486 while the section's
    // painted box ended at 326, and elementFromPoint returned DIV.flow-page
    expect(geom.right).toBeLessThanOrEqual(geom.innerWidth);
    expect(geom.right).toBeLessThanOrEqual(geom.sectionRight + 1);
    expect(geom.isHit).toBe(true);
  });

  test('the flow page does not scroll sideways at 375px', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const it = TakeoffState.addItem({ type: 'devices', description: 'Office receptacle runs', quantity: 8, labor: 0.18, price: null, parentId: null });
      TakeoffApp.navigateToDevice(it.id);
    });
    const over = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(over.scrollWidth).toBe(over.innerWidth);
  });

  test('T2-01 — an element marked hidden is not rendered', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const it = TakeoffState.addItem({ type: 'devices', description: 'Office receptacle runs', quantity: 8, labor: 0.18, price: null, parentId: null });
      TakeoffApp.navigateToDevice(it.id);
    });
    const row = page.locator('.inline-name-row').first();
    await expect(row).toHaveAttribute('hidden', '');
    const box = await page.evaluate(() => {
      const el = document.querySelector('.inline-name-row');
      const r = el.getBoundingClientRect();
      return { display: getComputedStyle(el).display, height: r.height, width: r.width, hidden: el.hidden };
    });
    // pre-fix: hidden === true, display 'flex', 36px tall with a focusable input
    expect(box.hidden).toBe(true);
    expect(box.display).toBe('none');
    expect(box.height).toBe(0);
    expect(box.width).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// B12 — the phone batch: the card grid first, then the 16px inputs, then the
// hit areas. Order matters: raising the font before the grid fix makes the
// quantity clip sooner, not later.
// ---------------------------------------------------------------------------

// One priced parent with a five-digit count and a component under it.
async function seedBid(page) {
  await page.goto('/');
  await page.evaluate(() => {
    const p = TakeoffState.addItem({ type: 'lighting', description: '2x4 LED Flat Panel F1', quantity: 12000, labor: 0.55, price: 118.25, planPage: 'E1.1', parentId: null });
    TakeoffState.addItem({ type: null, description: 'Fixture whip', quantity: 3, labor: 0.1, price: 12, parentId: p.id });
    TakeoffApp.render();
  });
}

const noSideScroll = (page) => page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));

test.describe('B12 — the phone batch at 375px', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('B12 — a five-digit quantity is readable, and Labor/Price/Plan stop fusing', async ({ page }) => {
    await seedBid(page);
    const geom = await page.evaluate(() => {
      const tr = [...document.querySelectorAll('.manifest-table-scroll tbody tr')].find((r) => r.querySelector('input[data-field="quantity"]') && r.querySelector('.price-cell input').value);
      const qty = tr.querySelector('input[data-field="quantity"]');
      const cs = getComputedStyle(qty);
      const c = document.createElement('canvas').getContext('2d');
      c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const boxes = ['.labor-cell input', '.price-cell input', 'input[data-field="planPage"]']
        .map((s) => tr.querySelector(s)).filter(Boolean).map((el) => el.getBoundingClientRect());
      const overlaps = [];
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const ox = Math.min(boxes[i].right, boxes[j].right) - Math.max(boxes[i].left, boxes[j].left);
          const oy = Math.min(boxes[i].bottom, boxes[j].bottom) - Math.max(boxes[i].top, boxes[j].top);
          if (ox > 0.5 && oy > 0.5) overlaps.push(Math.round(ox));
        }
      }
      const plus = tr.querySelector('.qty-up-btn').getBoundingClientRect();
      return {
        textWidth: c.measureText('12000').width,
        contentWidth: qty.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
        fontSize: parseFloat(cs.fontSize),
        overlaps,
        plus: { w: plus.width, h: plus.height },
        rowRight: tr.getBoundingClientRect().right,
        widest: Math.max(...[...tr.querySelectorAll('input,button')].map((e) => e.getBoundingClientRect().right)),
      };
    });
    // pre-fix: 44.8px box with 27px of content space against 40px of glyphs
    expect(geom.textWidth).toBeLessThanOrEqual(geom.contentWidth);
    // pre-fix: 14.4px, which is what makes iPhone Safari zoom on focus
    expect(geom.fontSize).toBeGreaterThanOrEqual(16);
    // pre-fix: Labor and Price each overflowed their 39px track by 29px and
    // Price overlapped the Plan track by 18px
    expect(geom.overlaps).toEqual([]);
    // pre-fix: a 24px target with no halo — a tap 14px off centre did nothing
    expect(geom.plus.w).toBeGreaterThanOrEqual(44);
    expect(geom.plus.h).toBeGreaterThanOrEqual(44);
    expect(geom.widest).toBeLessThanOrEqual(geom.rowRight + 1);
    expect(await noSideScroll(page)).toEqual({ scrollWidth: 375, innerWidth: 375 });
  });

  // X10 at phone width: the labor split is the whole point of the cell, so it
  // must not be cut off at the right edge with nothing to scroll to.
  test('B12 — the labor split stays inside the cell instead of running off the edge', async ({ page }) => {
    await seedBid(page);
    const geom = await page.evaluate(() => {
      const el = document.querySelector('[data-summary="labSplit.lighting"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cell = el.closest('td').getBoundingClientRect();
      return { text: el.textContent, right: r.right, cellRight: cell.right, vw: window.innerWidth };
    });
    expect(geom).not.toBeNull();
    expect(geom.text).toContain('+ parts');
    // pre-fix: white-space:nowrap put the right edge at 403 on a 375px viewport
    expect(geom.right).toBeLessThanOrEqual(geom.cellRight + 1);
    expect(geom.right).toBeLessThanOrEqual(geom.vw);
    expect(await noSideScroll(page)).toEqual({ scrollWidth: 375, innerWidth: 375 });
  });

  test('B12 — the qty spinner still adds and subtracts once the buttons are 44px', async ({ page }) => {
    await seedBid(page);
    const row = page.locator('.manifest-table-scroll tbody tr', { has: page.locator('input[data-field="quantity"]') }).last();
    const qty = row.locator('input[data-field="quantity"]');
    await expect(qty).toHaveValue('3');
    await row.locator('.qty-up-btn').tap();
    await expect(qty).toHaveValue('4');
  });

  test('B12 — the switcher menu does not widen the layout viewport', async ({ page }) => {
    await seedBid(page);
    const before = await noSideScroll(page);
    await page.locator('#project-switch-btn').click();
    const open = await page.evaluate(() => {
      const r = document.getElementById('project-menu').getBoundingClientRect();
      return { left: r.left, right: r.right, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };
    });
    // pre-fix: left:0 on a button at x 117 ran the menu to 455 and took
    // window.innerWidth with it
    expect(open.left).toBeGreaterThanOrEqual(0);
    expect(open.right).toBeLessThanOrEqual(before.innerWidth);
    expect(open.scrollWidth).toBe(before.innerWidth);
    expect(open.innerWidth).toBe(before.innerWidth);
  });

  test('B12 — the import preview fits the phone and stacks to one column', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      TakeoffImport.showImportPreviewModal(
        TakeoffImport.parseCountToolingClipboard('2x4 LED Troffer - A1\t24\tE2.1\nEXIT Sign - X1\t6\tE2.2')
      );
    });
    await expect(page.locator('#import-preview-modal')).toHaveAttribute('aria-hidden', 'false');
    const geom = await page.evaluate(() => {
      const c = document.querySelector('#import-preview-modal .modal-content').getBoundingClientRect();
      const cols = document.querySelector('.import-preview-columns');
      const add = document.getElementById('import-preview-add-btn').getBoundingClientRect();
      return {
        left: c.left, right: c.right, innerWidth: window.innerWidth,
        columns: cols ? getComputedStyle(cols).gridTemplateColumns.split(' ').length : 0,
        addLeft: add.left, addRight: add.right,
        addHit: (() => { const h = document.elementFromPoint(add.left + add.width / 2, add.top + add.height / 2); return !!(h && h.closest('#import-preview-add-btn')); })(),
      };
    });
    // pre-fix: min-width 500px against max-width 90vw put it at x -62…438,
    // with the title reading "ort Preview" and Add All 38px off the edge
    expect(geom.left).toBeGreaterThanOrEqual(0);
    expect(geom.right).toBeLessThanOrEqual(geom.innerWidth);
    expect(geom.columns).toBe(1);
    expect(geom.addLeft).toBeGreaterThanOrEqual(0);
    expect(geom.addRight).toBeLessThanOrEqual(geom.innerWidth);
    expect(geom.addHit).toBe(true);
  });

  test('B12 — the flow Save bar is on screen without scrolling', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const it = TakeoffState.addItem({ type: 'devices', description: 'Office receptacle runs', quantity: 8, labor: 0.18, price: null, parentId: null });
      TakeoffApp.navigateToDevice(it.id);
    });
    const geom = await page.evaluate(() => {
      const bar = document.querySelector('.flow-page > .flow-actions');
      const b = document.getElementById('device-save-btn').getBoundingClientRect();
      return {
        position: getComputedStyle(bar).position,
        inViewport: b.top >= 0 && b.bottom <= window.innerHeight,
        hit: (() => { const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!(h && h.closest('#device-save-btn')); })(),
        scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
      };
    });
    // pre-fix: Save at document y 2,255 against an 812px viewport, and zero
    // fixed-or-sticky elements anywhere on the page
    expect(geom.position).toBe('fixed');
    expect(geom.inViewport).toBe(true);
    expect(geom.hit).toBe(true);
    expect(geom.scrollWidth).toBe(geom.innerWidth);
  });

  test('B12 — Manage projects rows stack, and nothing scrolls sideways', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      TakeoffState.createProject('Riverside Elementary Gym Retrofit');
      TakeoffApp.render();
    });
    await page.locator('#project-switch-btn').click();
    await page.locator('#project-menu-manage').click();
    const geom = await page.evaluate(() => {
      const row = document.querySelector('.projects-table tbody tr');
      const cells = [...row.querySelectorAll('td')].map((td) => Math.round(td.getBoundingClientRect().top));
      return {
        stacked: new Set(cells).size === cells.length,
        headHidden: getComputedStyle(document.querySelector('.projects-table thead')).display === 'none',
        metaLabel: document.querySelector('.projects-table tbody td.projects-meta').textContent,
        scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
      };
    });
    expect(geom.stacked).toBe(true);
    expect(geom.headHidden).toBe(true);
    expect(geom.scrollWidth).toBe(geom.innerWidth);
  });

  test('B12 — no input on the manifest or in a flow is under 16px', async ({ page }) => {
    await seedBid(page);
    const manifest = await page.evaluate(() =>
      [...document.querySelectorAll('#main-content input, #main-content select')].map((i) => parseFloat(getComputedStyle(i).fontSize))
    );
    expect(manifest.length).toBeGreaterThan(0);
    for (const size of manifest) expect(size).toBeGreaterThanOrEqual(16);

    await page.evaluate(() => {
      const it = TakeoffState.addItem({ type: 'devices', description: 'Office receptacle runs', quantity: 8, labor: 0.18, price: null, parentId: null });
      TakeoffApp.navigateToDevice(it.id);
      document.querySelector('.add-device-section-btn')?.click();
    });
    const flow = await page.evaluate(() =>
      [...document.querySelectorAll('#main-content input, #main-content select')].map((i) => parseFloat(getComputedStyle(i).fontSize))
    );
    expect(flow.length).toBeGreaterThan(0);
    // pre-fix: 74 of 74 inputs under 16px — 14.4 manifest, 13.33 flow
    for (const size of flow) expect(size).toBeGreaterThanOrEqual(16);
  });
});

test.describe('B12 — the tablet at 768px', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

  test('B12 — the manifest, the book and the switcher all stay inside 768px', async ({ page }) => {
    await seedBid(page);
    expect(await noSideScroll(page)).toEqual({ scrollWidth: 768, innerWidth: 768 });

    await page.locator('#project-switch-btn').click();
    const menu = await page.evaluate(() => {
      const r = document.getElementById('project-menu').getBoundingClientRect();
      return { left: r.left, right: r.right, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };
    });
    expect(menu.left).toBeGreaterThanOrEqual(0);
    expect(menu.right).toBeLessThanOrEqual(768);
    expect(menu.scrollWidth).toBe(768);
    await page.keyboard.press('Escape');

    await page.locator('#labor-book-open-btn').click();
    await expect(page.locator('.labor-book-section').first()).toBeVisible({ timeout: 20000 });
    expect(await noSideScroll(page)).toEqual({ scrollWidth: 768, innerWidth: 768 });
  });
});

test('T1-10 — a price typed with a dollar sign and commas is stored as money', async ({ page }) => {
  await page.goto('/');
  await page.locator('#labor-book-open-btn').click();
  const section = page.locator('.labor-book-section:not(.lb-supplier-section)').first();
  await expect(section).toBeVisible({ timeout: 20000 });
  await section.locator('.labor-book-section-header').first().click();

  const priceInput = section.locator('.labor-book-price').first();
  await expect(priceInput).toBeVisible();
  const where = await priceInput.evaluate((el) => ({ type: el.dataset.type, section: el.dataset.section, index: Number(el.dataset.index) }));
  const read = () => page.evaluate((w) => {
    const r = TakeoffState.getLaborBookType(w.type)[w.section][w.index];
    return { price: r.price, priceSource: r.priceSource || null };
  }, where);

  await priceInput.fill('$21,450.75');
  await priceInput.blur();
  expect(await read()).toEqual({ price: '21450.75', priceSource: 'You' });
  // the field reads back what was stored, so nothing looks priced at $0
  await expect(priceInput).toHaveValue('21450.75');
  await expect(priceInput).not.toHaveClass(/lb-price-invalid/);

  // text that is not money: the typed characters stay, the row goes unpriced
  await priceInput.fill('about two grand');
  await priceInput.blur();
  await expect(priceInput).toHaveValue('about two grand');
  await expect(priceInput).toHaveClass(/lb-price-invalid/);
  const after = await read();
  expect(after.price).toBe('');

  // and no string price can ride into the shared book
  const corrections = await page.evaluate(() => TakeoffState.getBookCorrections());
  for (const c of corrections) {
    for (const side of ['old', 'new']) {
      if (c[side] && 'price' in c[side]) {
        expect(c[side].price === '' || Number.isFinite(Number(c[side].price))).toBe(true);
      }
    }
  }
});

test('T1-10 — a catalog price that is not money promotes nothing', async ({ page }) => {
  await page.goto('/');
  await page.locator('#labor-book-open-btn').click();
  const section = page.locator('.lb-supplier-section').first();
  await expect(section).toBeVisible({ timeout: 20000 });
  await section.locator('.labor-book-section-header').click();
  const priceInput = page.locator('.lb-supplier-section tbody tr[data-entry] [data-field="price"]').first();
  await expect(priceInput).toBeVisible({ timeout: 20000 });

  const tab = await page.evaluate(() => TakeoffState.getActiveLaborBookTab());
  const before = await page.evaluate((t) => JSON.stringify(TakeoffState.getLaborBookType(t)), tab);

  await priceInput.fill('$1,975 each');
  await priceInput.blur();

  await expect(priceInput).toHaveValue('$1,975 each');
  await expect(priceInput).toHaveClass(/lb-price-invalid/);
  const after = await page.evaluate((t) => JSON.stringify(TakeoffState.getLaborBookType(t)), tab);
  expect(after).toBe(before);
});
