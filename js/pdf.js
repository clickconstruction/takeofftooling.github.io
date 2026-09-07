/**
 * PDF exports for Takeoff Tooling (jsPDF, vendored in vendor/).
 *
 * Three prints share one table engine (`drawTable`): columns are sized to the
 * letter page's printable width and text WRAPS inside its column instead of
 * overprinting the next one; every page carries the project name, the date
 * and "page n of N"; long manifests paginate with the header row repeated.
 *   - Review: type, description, quantity (with unit), labor, price, extended,
 *     plan page; totals block (materials, tax, labor, other, grand total).
 *   - Purchase Order: material and quantity (the purchase list — identical
 *     descriptions merged, other charges left out).
 *   - With Form: description + quantity, then the permit form block
 *     (address, permit no, builder or occupant, electrical count).
 * Unscaled (px) rows print with a "px · unscaled" quantity and no money.
 */

const TakeoffPDF = (function () {
  const PAGE = { w: 612, h: 792, margin: 40 };
  const PRINTABLE = PAGE.w - PAGE.margin * 2; // 532pt
  const LINE = 12;
  const FONT = 9;

  function lib() {
    if (typeof jspdf === 'undefined' || !jspdf.jsPDF) {
      TakeoffUtils.toast('The PDF library did not load. Reload the page and try again.', { kind: 'error' });
      return null;
    }
    return jspdf.jsPDF;
  }

  function money(n) {
    return '$' + (Number(n) || 0).toFixed(2);
  }

  function qtyText(item) {
    const q = Number(item.quantity) || 0;
    if (item.unit === 'ft') return q.toFixed(2) + ' ft';
    if (item.unit === 'px') return Math.round(q) + ' px · unscaled';
    return String(Math.round(q * 100) / 100);
  }

  const TYPE_LABELS = {
    lighting: 'Lighting', gear: 'Gear', devices: 'Devices', conduit: 'Conduit', wire: 'Wire', specialSystems: 'Special Sys.',
    permits: 'Permits', powerCoCharges: 'Power Co.', temporaryPower: 'Temp Power',
    outletsAndSwitches: 'Outlet/Switch', box: 'Box', backBoxSupport: 'Box Support', cover: 'Cover', screws: 'Screws', misc: 'Misc.',
    trenching: 'Trenching', trenchingAddon: 'Trench Add-on', fitting: 'Fitting', overage: 'Overage', macAdapter: 'MAC Adapter',
  };

  /**
   * Document scaffold: title + project line, and a footer stamped on every
   * page at the end (page n of N needs the final count).
   */
  function startDoc(title) {
    const JsPDF = lib();
    if (!JsPDF) return null;
    const doc = new JsPDF({ unit: 'pt', format: 'letter' });
    const project = TakeoffState.getCurrentProject();
    const state = { doc, y: PAGE.margin, title, project };
    drawTitle(state);
    return state;
  }

  function drawTitle(s) {
    const { doc } = s;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(s.title, PAGE.margin, s.y + 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(110);
    doc.text(s.project.name || 'Untitled project', PAGE.margin, s.y + 20);
    doc.text(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }), PAGE.w - PAGE.margin, s.y + 20, { align: 'right' });
    doc.setTextColor(0);
    s.y += 38;
  }

  function finishDoc(s, filename) {
    const { doc } = s;
    const n = doc.getNumberOfPages();
    doc.setFontSize(8);
    doc.setTextColor(130);
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.text(`${s.project.name || 'Untitled project'} — Takeoff Tooling`, PAGE.margin, PAGE.h - 22);
      doc.text(`Page ${i} of ${n}`, PAGE.w - PAGE.margin, PAGE.h - 22, { align: 'right' });
    }
    doc.setTextColor(0);
    doc.save(filename);
  }

  function newPageIfNeeded(s, needed) {
    if (s.y + needed <= PAGE.h - PAGE.margin - 20) return false;
    s.doc.addPage();
    s.y = PAGE.margin;
    return true;
  }

  /**
   * Draw a table. columns: [{ key, label, width, align?: 'right', indentKey? }]
   * — widths in pt (sum ≤ PRINTABLE). rows: objects keyed by column key
   * (strings). Text wraps within its column; a row's height is its tallest
   * cell. The header repeats after a page break.
   */
  function drawTable(s, columns, rows) {
    const { doc } = s;
    const xs = [];
    let x = PAGE.margin;
    for (const c of columns) { xs.push(x); x += c.width; }

    const header = () => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(FONT);
      columns.forEach((c, i) => doc.text(c.label, c.align === 'right' ? xs[i] + c.width - 2 : xs[i] + 2, s.y, { align: c.align === 'right' ? 'right' : 'left' }));
      s.y += 4;
      doc.setDrawColor(160);
      doc.line(PAGE.margin, s.y, PAGE.margin + PRINTABLE, s.y);
      s.y += LINE - 2;
      doc.setFont('helvetica', 'normal');
    };
    header();

    for (const row of rows) {
      doc.setFontSize(FONT);
      const cells = columns.map((c) => {
        const indent = c.indentKey ? (Number(row[c.indentKey]) || 0) * 10 : 0;
        const text = row[c.key] == null ? '' : String(row[c.key]);
        return { lines: doc.splitTextToSize(text, Math.max(10, c.width - 4 - indent)), indent };
      });
      const height = Math.max(1, ...cells.map((c) => c.lines.length)) * LINE;
      if (newPageIfNeeded(s, height)) header();
      cells.forEach((cell, i) => {
        const c = columns[i];
        const tx = c.align === 'right' ? xs[i] + c.width - 2 : xs[i] + 2 + cell.indent;
        doc.text(cell.lines, tx, s.y, { align: c.align === 'right' ? 'right' : 'left' });
      });
      s.y += height;
    }
    s.y += 6;
  }

  function drawTotals(s) {
    const { doc } = s;
    const b = TakeoffState.getSummaryBreakdown();
    const laborRate = TakeoffState.getLaborRate() || 0;
    const laborDollars = b.laborTotal * laborRate;
    const grand = b.materialsTotal + laborDollars + b.otherTotal;
    const lines = [
      ['Materials subtotal', money(b.materialsSubtotal)],
      [`Sales tax (${(b.taxRate * 100).toFixed(2).replace(/\.?0+$/, '')}%)`, money(b.salesTax)],
      ['Materials total', money(b.materialsTotal)],
      ['Labor', `${b.laborTotal.toFixed(1)} hrs${laborRate ? ` × ${money(laborRate)} = ${money(laborDollars)}` : ''}`],
      ['Other charges', money(b.otherTotal)],
      ['Total cost', money(grand)],
    ];
    newPageIfNeeded(s, lines.length * LINE + 20);
    doc.setFontSize(FONT);
    const labelX = PAGE.margin + PRINTABLE - 260;
    lines.forEach(([k, v], i) => {
      const last = i === lines.length - 1;
      doc.setFont('helvetica', last ? 'bold' : 'normal');
      doc.text(k, labelX, s.y);
      doc.text(v, PAGE.margin + PRINTABLE - 2, s.y, { align: 'right' });
      s.y += LINE;
    });
    doc.setFont('helvetica', 'normal');
    if (b.unscaledCount) {
      s.y += 4;
      doc.setTextColor(180, 60, 40);
      doc.text(`${b.unscaledCount} unscaled row${b.unscaledCount === 1 ? '' : 's'} (px) excluded from totals — set the scale in CountTooling and re-import.`, PAGE.margin, s.y);
      doc.setTextColor(0);
      s.y += LINE;
    }
    doc.setFontSize(8);
    doc.setTextColor(130);
    s.y += 2;
    doc.text('Cost summary only — margin, markup and the bid price are set in PipeTooling.', PAGE.margin, s.y);
    doc.setTextColor(0);
    s.y += LINE;
  }

  function reviewRows() {
    return TakeoffState.getFlattenedItems().map((item) => {
      const px = item.unit === 'px';
      const q = Number(item.quantity) || 0;
      const price = item.price != null && item.price !== '' && !isNaN(Number(item.price)) ? Number(item.price) : null;
      return {
        _depth: item._depth || 0,
        type: TYPE_LABELS[item.type] || item.type || '',
        description: (item.group && !item._depth ? `[${item.group}] ` : '') + (item.description || ''),
        quantity: qtyText(item),
        labor: px || !(Number(item.labor) > 0) ? '' : Number(item.labor).toFixed(2),
        price: px || price == null ? '' : money(price),
        extended: px || price == null ? '' : money(price * (q > 0 ? q : 1)),
        planPage: item.planPage || '',
      };
    });
  }

  function printForReview() {
    const s = startDoc('Takeoff — Review');
    if (!s) return;
    drawTable(s, [
      { key: 'type', label: 'Type', width: 58 },
      { key: 'description', label: 'Description', width: 196, indentKey: '_depth' },
      { key: 'quantity', label: 'Qty', width: 66, align: 'right' },
      { key: 'labor', label: 'Hrs/unit', width: 44, align: 'right' },
      { key: 'price', label: 'Unit $', width: 54, align: 'right' },
      { key: 'extended', label: 'Ext. $', width: 60, align: 'right' },
      { key: 'planPage', label: 'Page / Location', width: 54 },
    ], reviewRows());
    drawTotals(s);
    finishDoc(s, 'takeoff-review.pdf');
  }

  function printForPurchaseOrder() {
    const s = startDoc('Takeoff — Purchase Order');
    if (!s) return;
    const report = TakeoffState.getPurchaseList();
    const rows = report.lines.map((l) => ({
      quantity: String(l.quantity),
      description: l.description,
      unitPrice: l.unitPrice != null ? money(l.unitPrice) + (l.priceVaries ? ' *' : '') : '',
      extended: l.extended ? money(l.extended) : '',
    }));
    drawTable(s, [
      { key: 'quantity', label: 'Qty', width: 60, align: 'right' },
      { key: 'description', label: 'Material', width: 332 },
      { key: 'unitPrice', label: 'Unit $', width: 70, align: 'right' },
      { key: 'extended', label: 'Extended $', width: 70, align: 'right' },
    ], rows);
    s.doc.setFontSize(FONT);
    s.doc.setFont('helvetica', 'bold');
    s.doc.text('Materials total (before tax)', PAGE.margin + PRINTABLE - 260, s.y);
    s.doc.text(money(report.totalCost), PAGE.margin + PRINTABLE - 2, s.y, { align: 'right' });
    s.doc.setFont('helvetica', 'normal');
    s.y += LINE;
    if (report.lines.some((l) => l.priceVaries)) {
      s.doc.setFontSize(8);
      s.doc.setTextColor(130);
      s.doc.text('* appears at more than one unit price; the highest is shown and the extended amount is exact per line.', PAGE.margin, s.y);
      s.doc.setTextColor(0);
    }
    finishDoc(s, 'takeoff-purchase-order.pdf');
  }

  function printWithForm(formData) {
    const s = startDoc('Takeoff — Permit Form');
    if (!s) return;
    const rows = TakeoffState.getFlattenedItems().map((item) => ({
      _depth: item._depth || 0,
      description: (item.group && !item._depth ? `[${item.group}] ` : '') + (item.description || ''),
      quantity: qtyText(item),
    }));
    drawTable(s, [
      { key: 'description', label: 'Description', width: 432, indentKey: '_depth' },
      { key: 'quantity', label: 'Qty', width: 100, align: 'right' },
    ], rows);
    const form = [
      ['Address', formData.address || ''],
      ['Permit No.', formData.permitNo || ''],
      ['Builder or Occupant', formData.builderOrOccupant || ''],
      ['Electrical Count', formData.electricalCount || ''],
    ];
    newPageIfNeeded(s, form.length * (LINE + 6) + 30);
    s.y += 8;
    s.doc.setFont('helvetica', 'bold');
    s.doc.setFontSize(11);
    s.doc.text('Form Details', PAGE.margin, s.y);
    s.y += LINE + 4;
    s.doc.setFontSize(FONT + 1);
    for (const [k, v] of form) {
      s.doc.setFont('helvetica', 'bold');
      s.doc.text(k + ':', PAGE.margin, s.y);
      s.doc.setFont('helvetica', 'normal');
      const lines = s.doc.splitTextToSize(v, PRINTABLE - 130);
      s.doc.text(lines, PAGE.margin + 120, s.y);
      s.y += Math.max(1, lines.length) * LINE + 4;
    }
    finishDoc(s, 'takeoff-form.pdf');
  }

  return { printForReview, printForPurchaseOrder, printWithForm };
})();
