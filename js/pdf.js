/**
 * PDF generation for Takeoff Tooling
 *
 * Three artifacts, one layout engine. Letter, 40 pt margins: 532 pt of usable
 * width. Every column is a measured box — text is wrapped to it with jsPDF's
 * own getTextWidth, so nothing can run into its neighbour whatever the
 * estimator typed.
 *
 * Money and hours come from TakeoffUtils, and every type label from
 * TakeoffManifestView's maps, so a PDF never prints a number or a word the
 * screen would not print. Quantities print with their unit (ft, px); an
 * unscaled (px) row prints "px · unscaled" and no hours or money, the way
 * the screen keeps it out of every total. Every page carries the project
 * name, the date and "Page n of N" (stampPages), and long tables repeat
 * their header after a page break.
 */

const TakeoffPDF = (function () {
  function getFlattenedItems() {
    return TakeoffState.getFlattenedItems();
  }

  const MARGIN = 40;
  const PAGE_W = 612;
  const PAGE_H = 792;
  const CONTENT_W = PAGE_W - MARGIN * 2; // 532
  const BODY_SIZE = 9;
  const LINE_H = 11;
  const GUTTER = 6;
  const PAGE_BOTTOM = PAGE_H - MARGIN;

  const REVIEW_COLUMNS = [
    { key: 'type', label: 'Type', w: 52, align: 'left' },
    { key: 'description', label: 'Description', w: 190, align: 'left' },
    { key: 'quantity', label: 'Qty', w: 34, align: 'right' },
    { key: 'labor', label: 'Hrs each', w: 40, align: 'right' },
    { key: 'extLabor', label: 'Hrs total', w: 42, align: 'right' },
    { key: 'price', label: 'Price each', w: 56, align: 'right' },
    { key: 'extPrice', label: 'Price total', w: 62, align: 'right' },
    { key: 'planPage', label: 'Plan page', w: 56, align: 'left' },
  ];

  // The purchase list, in the screen's own column order and words.
  const PURCHASE_COLUMNS = [
    { key: 'quantity', label: 'Qty', w: 50, align: 'right' },
    { key: 'description', label: 'Material', w: 330, align: 'left' },
    { key: 'unitPrice', label: 'Unit $', w: 70, align: 'right' },
    { key: 'extended', label: 'Extended $', w: 82, align: 'right' },
  ];

  const FORM_COLUMNS = [
    { key: 'description', label: 'Description', w: 452, align: 'left' },
    { key: 'quantity', label: 'Qty', w: 80, align: 'right' },
  ];

  function labelMaps() {
    const v = typeof TakeoffManifestView !== 'undefined' ? TakeoffManifestView : null;
    return {
      type: (v && v.TYPE_LABELS) || {},
      child: (v && v.CHILD_TYPE_LABELS) || {},
      summary: (v && v.SUMMARY_LABELS) || {},
    };
  }

  // One money formatter and one hours formatter for the screen and the PDFs.
  function money(n, opts) {
    const s = TakeoffUtils.formatMoney(n, opts);
    return s.charAt(0) === '-' ? '-$' + s.slice(1) : '$' + s;
  }

  function hours(n) {
    return TakeoffUtils.formatHours(n);
  }

  // A file named after the job and the day it was printed, so a folder of
  // these is sortable: "cedar-ridge-clinic-review-2026-09-07.pdf".
  function slug(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'takeoff';
  }

  function fileName(kind) {
    const d = new Date();
    const stamp = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
    return `${slug(TakeoffState.getCurrentProject().name)}-${kind}-${stamp}.pdf`;
  }

  function todayLong() {
    return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  // The quantity the way the screen shows it: a count bare, a length with
  // its unit, an unscaled row named as such (pixels, not feet).
  function quantityText(item) {
    const qty = Number(item.quantity) || 0;
    if (!qty) return '';
    const n = String(Math.round(qty * 100) / 100);
    if (item.unit === 'px') return n + ' px · unscaled';
    if (item.unit === 'ft') return n + ' ft';
    return n;
  }

  // Cut a run to a width by character, with an ellipsis — for the one-line
  // footer, where wrapping would collide with the page number.
  function fitToWidth(doc, text, width) {
    let str = String(text == null ? '' : text);
    if (doc.getTextWidth(str) <= width) return str;
    while (str.length > 1 && doc.getTextWidth(str + '…') > width) str = str.slice(0, -1);
    return str + '…';
  }

  // Every page, once the document is complete: the project name and the date
  // on the left, "Page n of N" on the right, below the table area so a page
  // pulled out of a stack still says which job and where it belongs.
  function stampPages(doc, projectName) {
    const total = doc.getNumberOfPages ? doc.getNumberOfPages() : 1;
    const footerY = PAGE_H - MARGIN + 18;
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(120);
      const pageText = `Page ${i} of ${total}`;
      const pageW = doc.getTextWidth(pageText);
      doc.text(pageText, MARGIN + CONTENT_W, footerY, { align: 'right' });
      doc.text(fitToWidth(doc, `${projectName || 'Untitled project'}  ·  ${todayLong()}`, CONTENT_W - pageW - 12), MARGIN, footerY);
      doc.setTextColor(0);
      doc.setFontSize(BODY_SIZE);
    }
  }

  // Wrap to a measured width. Words first; a single token wider than the box
  // (a long catalog number) is broken by character rather than allowed out.
  function wrapToWidth(doc, text, width) {
    const str = String(text == null ? '' : text).trim();
    if (!str) return [''];
    const box = Math.max(width, 10);
    const lines = [];
    let line = '';
    const flush = () => {
      if (line) lines.push(line);
      line = '';
    };
    for (const raw of str.split(/\s+/)) {
      let word = raw;
      while (doc.getTextWidth(word) > box) {
        let cut = word.length;
        while (cut > 1 && doc.getTextWidth(word.slice(0, cut)) > box) cut--;
        flush();
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      if (!word) continue;
      const candidate = line ? line + ' ' + word : word;
      if (line && doc.getTextWidth(candidate) > box) {
        flush();
        line = word;
      } else {
        line = candidate;
      }
    }
    flush();
    return lines.length ? lines : [''];
  }

  // values: { <column key>: string }. indent shifts the description only.
  function layoutRow(doc, cols, values, indent) {
    return cols.map((col) => {
      const pad = col.key === 'description' ? indent : 0;
      return wrapToWidth(doc, values[col.key], col.w - GUTTER - pad);
    });
  }

  function drawRow(doc, cols, cellLines, y, indent) {
    let x = MARGIN;
    cols.forEach((col, i) => {
      const pad = col.key === 'description' ? indent : 0;
      cellLines[i].forEach((line, li) => {
        if (!line) return;
        const ly = y + li * LINE_H;
        if (col.align === 'right') doc.text(line, x + col.w - GUTTER, ly, { align: 'right' });
        else doc.text(line, x + pad, ly);
      });
      x += col.w;
    });
    return cellLines.reduce((m, l) => Math.max(m, l.length), 1) * LINE_H;
  }

  function drawTableHeader(doc, cols, y) {
    doc.setFont(undefined, 'bold');
    const cells = cols.map((c) => wrapToWidth(doc, c.label, c.w - GUTTER));
    const h = drawRow(doc, cols, cells, y, 0);
    doc.setFont(undefined, 'normal');
    doc.setDrawColor(170);
    doc.line(MARGIN, y + h - 6, MARGIN + CONTENT_W, y + h - 6);
    return h + 6;
  }

  function pageTitle(doc, title, subtitle) {
    let y = MARGIN;
    doc.setFontSize(18);
    doc.setFont(undefined, 'normal');
    doc.text(title, MARGIN, y);
    y += 16;
    doc.setFontSize(11);
    doc.setTextColor(110);
    doc.text(subtitle, MARGIN, y);
    doc.setTextColor(0);
    return y;
  }

  function ensureDoc() {
    if (typeof jspdf === 'undefined' || !jspdf.jsPDF) {
      if (typeof TakeoffToast !== 'undefined') TakeoffToast.show('The PDF library did not load. Reload the page and try again.', { kind: 'warn', timeout: 9000 });
      return null;
    }
    return new jspdf.jsPDF({ unit: 'pt', format: 'letter' });
  }

  // The three blocks the manifest screen shows, in the same order and words.
  function drawSummary(doc, breakdown, laborRate) {
    const labels = labelMaps().summary;
    const matTypes = ['lighting', 'gear', 'devices', 'conduit', 'wire', 'specialSystems', 'misc'];
    // includes the site work (trenching, rentals) the summary keeps out of materials
    const otherTypes = (typeof TakeoffSelectors !== 'undefined' && TakeoffSelectors.OTHER_CHARGE_KEYS) || ['permits', 'powerCoCharges', 'temporaryPower'];
    const labelOf = (t) => labels[t] || t;
    const valueX = MARGIN + 300;
    let y = MARGIN + 60;

    const line = (label, value, bold) => {
      if (y > PAGE_BOTTOM - LINE_H) {
        doc.addPage();
        y = MARGIN + 12;
      }
      doc.setFont(undefined, bold ? 'bold' : 'normal');
      doc.text(label, MARGIN, y);
      doc.text(value, valueX, y, { align: 'right' });
      doc.setFont(undefined, 'normal');
      y += 14;
    };
    const heading = (text) => {
      y += 10;
      doc.setFontSize(11);
      doc.setFont(undefined, 'bold');
      doc.text(text, MARGIN, y);
      doc.setFont(undefined, 'normal');
      doc.setFontSize(BODY_SIZE + 1);
      y += 6;
      doc.setDrawColor(170);
      doc.line(MARGIN, y, valueX, y);
      y += 14;
    };

    doc.setFontSize(BODY_SIZE + 1);
    heading('MATERIALS');
    matTypes.forEach((t) => line(labelOf(t), money(breakdown.materials[t], { fixed2: true })));
    line('Sub Total', money(breakdown.materialsSubtotal, { fixed2: true }), true);
    // the project's own rate, not a constant (js/selectors.js)
    const taxPct = breakdown.taxRate;
    line(`SALES TAX (${taxPct}%)`, money(breakdown.salesTax, { fixed2: true }));
    line('Materials TOTAL $', money(breakdown.materialsTotal, { fixed2: true }), true);

    heading('LABOR');
    // same rows as the screen: the material types, then hours typed on
    // Other-charges rows (they bill under Other but the crew still works them)
    [...matTypes, 'other'].forEach((t) => line(labelOf(t), hours(breakdown.labor[t])));
    line('Labor TOTAL (hrs)', hours(breakdown.laborTotal), true);
    line('Labor Rate ($/Hr)', money(laborRate, { fixed2: true }));
    const laborDollars = breakdown.laborTotal * laborRate;
    line('Labor Total $', money(laborDollars, { fixed2: true }), true);

    heading('OTHER CHARGES');
    otherTypes.forEach((t) => line(labelOf(t), money(breakdown.otherCharges[t], { fixed2: true })));
    line('Other TOTAL $', money(breakdown.otherTotal, { fixed2: true }), true);

    y += 14;
    doc.setFontSize(13);
    doc.setFont(undefined, 'bold');
    doc.text('Grand Total', MARGIN, y);
    doc.text(money(breakdown.materialsTotal + laborDollars + breakdown.otherTotal, { fixed2: true }), valueX, y, { align: 'right' });
    doc.setFont(undefined, 'normal');
    doc.setFontSize(BODY_SIZE);
  }

  function printForReview() {
    const doc = ensureDoc();
    if (!doc) return; // ensureDoc said why
    const project = TakeoffState.getCurrentProject();
    const breakdown = TakeoffState.getSummaryBreakdown();
    const laborRate = Number(TakeoffState.getLaborRate()) || 0;
    const labels = labelMaps();

    // Page 1 — the summary the estimator reads on screen.
    pageTitle(doc, 'Takeoff Tooling - Review', project.name + '  ·  ' + todayLong());
    drawSummary(doc, breakdown, laborRate);

    // Page 2 on — the line items behind it.
    doc.addPage();
    pageTitle(doc, 'Takeoff Tooling - Review', project.name + '  ·  Line items');
    doc.setFontSize(BODY_SIZE);
    let y = MARGIN + 40;
    y += drawTableHeader(doc, REVIEW_COLUMNS, y);

    for (const item of getFlattenedItems()) {
      const depth = item._depth || 0;
      const indent = depth * 10;
      const rawType = item.type || '';
      const typeLabel = depth > 0
        ? labels.child[rawType] || labels.type[rawType] || rawType
        : labels.type[rawType] || rawType;
      // Extended columns use the same rule as the summary (quantity 0 means
      // none of it; a px row is pixels, not feet, so it has no hours and no
      // money), so the columns add up to the totals on page 1.
      const unscaled = item.unit === 'px';
      const qty = Number(item.quantity) || 0;
      const unitLabor = unscaled ? 0 : Number(item.labor) || 0;
      const unitPrice = Number(item.price);
      const priced = !unscaled && item.price != null && item.price !== '' && !isNaN(unitPrice) && unitPrice > 0;

      const values = {
        type: typeLabel,
        description: item.description || '',
        quantity: quantityText(item),
        labor: unitLabor ? hours(unitLabor) : '',
        extLabor: unitLabor && qty ? hours(unitLabor * qty) : '',
        price: priced ? money(unitPrice) : '',
        extPrice: priced && qty ? money(unitPrice * qty, { fixed2: true }) : '',
        planPage: item.planPage || '',
      };
      const cells = layoutRow(doc, REVIEW_COLUMNS, values, indent);
      const h = cells.reduce((m, l) => Math.max(m, l.length), 1) * LINE_H;
      if (y + h > PAGE_BOTTOM) {
        doc.addPage();
        doc.setFontSize(BODY_SIZE);
        y = MARGIN;
        y += drawTableHeader(doc, REVIEW_COLUMNS, y);
      }
      drawRow(doc, REVIEW_COLUMNS, cells, y, indent);
      y += h;
    }

    if (y + 30 > PAGE_BOTTOM) {
      doc.addPage();
      doc.setFontSize(BODY_SIZE);
      y = MARGIN;
    }
    y += 16;
    doc.setDrawColor(170);
    doc.line(MARGIN, y - 10, MARGIN + CONTENT_W, y - 10);
    doc.setFont(undefined, 'bold');
    // The same number the screen's Labor TOTAL (hrs) shows.
    doc.text('Labor TOTAL (hrs): ' + hours(breakdown.laborTotal), MARGIN, y);
    doc.text('Grand Total: ' + money(breakdown.materialsTotal + breakdown.laborTotal * laborRate + breakdown.otherTotal, { fixed2: true }), MARGIN + CONTENT_W, y, { align: 'right' });
    doc.setFont(undefined, 'normal');

    stampPages(doc, project.name);
    TakeoffEvents.log('pdf_exported', { variant: 'review', rows: getFlattenedItems().length, pages: doc.getNumberOfPages?.() ?? 0 });
    doc.save(fileName('review'));
  }

  // A material bought at two prices shows both, not one of them. The Extended
  // column stays a single number — that is the column that gets summed.
  function unitPriceText(l) {
    if (l.priceVaries) return money(l.unitPriceLow) + '-' + money(l.unitPriceHigh);
    return l.unitPrice != null ? money(l.unitPrice) : '-';
  }

  /**
   * Purchase list (PO) — the same report the screen shows, on paper: merged
   * lines, a price on every one it can price, an Extended column and a
   * materials total the supply house can quote against.
   */
  function printForPurchaseOrder() {
    const doc = ensureDoc();
    if (!doc) return; // ensureDoc said why
    const project = TakeoffState.getCurrentProject();
    const report = TakeoffState.getPurchaseList();

    pageTitle(doc, 'Takeoff Tooling - Purchase list (PO)', project.name + '  ·  ' + todayLong());
    doc.setFontSize(BODY_SIZE);
    let y = MARGIN + 34;
    doc.setTextColor(110);
    doc.text(
      `${report.lines.length} materials` + (report.unpricedCount ? ` · ${report.unpricedCount} without a price` : ''),
      MARGIN,
      y
    );
    doc.setTextColor(0);
    y += 18;
    y += drawTableHeader(doc, PURCHASE_COLUMNS, y);

    for (const l of report.lines) {
      const values = {
        quantity: String(l.quantity),
        description: l.description,
        unitPrice: unitPriceText(l),
        extended: l.extended ? money(l.extended, { fixed2: true }) : '-',
      };
      const cells = layoutRow(doc, PURCHASE_COLUMNS, values, 0);
      const h = cells.reduce((m, c) => Math.max(m, c.length), 1) * LINE_H;
      if (y + h > PAGE_BOTTOM - 30) {
        doc.addPage();
        doc.setFontSize(BODY_SIZE);
        y = MARGIN;
        y += drawTableHeader(doc, PURCHASE_COLUMNS, y);
      }
      drawRow(doc, PURCHASE_COLUMNS, cells, y, 0);
      y += h;
    }

    if (!report.lines.length) {
      doc.text('No materials on the manifest yet.', MARGIN, y);
      y += LINE_H;
    }

    if (y + 40 > PAGE_BOTTOM) {
      doc.addPage();
      doc.setFontSize(BODY_SIZE);
      y = MARGIN;
    }
    y += 16;
    doc.setDrawColor(170);
    doc.line(MARGIN, y - 10, MARGIN + CONTENT_W, y - 10);
    doc.setFont(undefined, 'bold');
    doc.text('Materials total (before tax)', MARGIN, y);
    doc.text(money(report.totalCost, { fixed2: true }), MARGIN + CONTENT_W, y, { align: 'right' });
    doc.setFont(undefined, 'normal');
    if (report.unpricedCount) {
      y += 16;
      doc.setTextColor(110);
      doc.text(`${report.unpricedCount} without a price — not in the total.`, MARGIN, y);
      doc.setTextColor(0);
    }

    stampPages(doc, project.name);
    TakeoffEvents.log('pdf_exported', { variant: 'purchase-list', rows: report.lines.length, pages: doc.getNumberOfPages?.() ?? 0 });
    doc.save(fileName('purchase-list'));
  }

  // The job's own details, printed under the project name on page 1 — only
  // the ones that were filled in.
  const DETAIL_ROWS = [
    ['client', 'Client'],
    ['address', 'Address'],
    ['permitNo', 'Permit no.'],
    ['builderOrOccupant', 'Builder or occupant'],
    ['dueDate', 'Due date'],
  ];

  function drawDetails(doc, details, y) {
    const filled = DETAIL_ROWS.filter(([key]) => (details && details[key] ? String(details[key]).trim() : ''));
    if (!filled.length) return y;
    doc.setFontSize(BODY_SIZE + 1);
    for (const [key, label] of filled) {
      doc.setFont(undefined, 'bold');
      doc.text(label, MARGIN, y);
      doc.setFont(undefined, 'normal');
      const lines = wrapToWidth(doc, details[key], CONTENT_W - 130);
      lines.forEach((line, i) => doc.text(line, MARGIN + 130, y + i * (LINE_H + 1)));
      y += Math.max(lines.length, 1) * (LINE_H + 1) + 3;
    }
    doc.setFontSize(BODY_SIZE);
    return y + 8;
  }

  function printWithForm(details) {
    const doc = ensureDoc();
    if (!doc) return; // ensureDoc said why
    const project = TakeoffState.getCurrentProject();
    pageTitle(doc, 'Takeoff Tooling - Form', project.name + '  ·  ' + todayLong());
    doc.setFontSize(BODY_SIZE);
    let y = MARGIN + 40;
    y = drawDetails(doc, details || {}, y);
    y += drawTableHeader(doc, FORM_COLUMNS, y);

    for (const item of getFlattenedItems()) {
      const indent = (item._depth || 0) * 10;
      const values = {
        description: item.description || '',
        quantity: quantityText(item) || '0',
      };
      const cells = layoutRow(doc, FORM_COLUMNS, values, indent);
      const h = cells.reduce((m, c) => Math.max(m, c.length), 1) * LINE_H;
      if (y + h > PAGE_BOTTOM) {
        doc.addPage();
        doc.setFontSize(BODY_SIZE);
        y = MARGIN;
        y += drawTableHeader(doc, FORM_COLUMNS, y);
      }
      drawRow(doc, FORM_COLUMNS, cells, y, indent);
      y += h;
    }

    stampPages(doc, project.name);
    TakeoffEvents.log('pdf_exported', { variant: 'form', rows: getFlattenedItems().length, pages: doc.getNumberOfPages?.() ?? 0 });
    doc.save(fileName('form'));
  }

  return {
    printForReview,
    printForPurchaseOrder,
    printWithForm,
    slug,
    fileName,
  };
})();
