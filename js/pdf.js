/**
 * PDF generation for Takeoff Tooling
 */

const TakeoffPDF = (function () {
  function getFlattenedItems() {
    return TakeoffState.getFlattenedItems();
  }

  function getTotalLabor() {
    return TakeoffState.getTotalLabor();
  }

  function printForReview() {
    if (typeof jspdf === 'undefined' || !jspdf.jsPDF) {
      alert('PDF library not loaded. Please refresh the page.');
      return;
    }
    const jsPDF = jspdf.jsPDF;
    const doc = new jspdf.jsPDF();
    const margin = 40;
    let y = margin;

    doc.setFontSize(18);
    doc.text('Takeoff Tooling - Review', margin, y);
    y += 30;

    const items = getFlattenedItems();
    const totalLabor = getTotalLabor();

    doc.setFontSize(10);
    const colWidths = [25, 80, 35, 35, 40, 35];
    const headers = ['Type', 'Description', 'Quantity', 'Labor', 'Plan Page / Location', 'Price'];
    doc.setFont(undefined, 'bold');
    doc.text(headers[0], margin, y);
    doc.text(headers[1], margin + colWidths[0], y);
    doc.text(headers[2], margin + colWidths[0] + colWidths[1], y);
    doc.text(headers[3], margin + colWidths[0] + colWidths[1] + colWidths[2], y);
    doc.text(headers[4], margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], y);
    doc.text(headers[5], margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], y);
    y += 15;
    doc.setFont(undefined, 'normal');

    for (const item of items) {
      if (y > 700) {
        doc.addPage();
        y = margin;
      }
      const indent = (item._depth || 0) * 10;
      const typeLabel = item.type || '-';
      const desc = (item.description || '').substring(0, 45);
      const qty = String(item.quantity ?? 0);
      const labor = ((item.labor || 0)).toFixed(1);
      const planPage = (item.planPage || '').substring(0, 15);
      const price = item.price != null ? String(item.price) : '';

      doc.text(typeLabel.substring(0, 8), margin + indent, y);
      doc.text(desc, margin + colWidths[0] + indent, y);
      doc.text(qty, margin + colWidths[0] + colWidths[1], y);
      doc.text(labor, margin + colWidths[0] + colWidths[1] + colWidths[2], y);
      doc.text(planPage, margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], y);
      doc.text(price, margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], y);
      y += 14;
    }

    y += 10;
    doc.setFont(undefined, 'bold');
    doc.text('Total Labor: ' + totalLabor.toFixed(1) + ' hrs', margin, y);

    doc.save('takeoff-review.pdf');
  }

  function printForPurchaseOrder() {
    if (typeof jspdf === 'undefined' || !jspdf.jsPDF) {
      alert('PDF library not loaded. Please refresh the page.');
      return;
    }
    const doc = new jspdf.jsPDF();
    const margin = 40;
    let y = margin;

    doc.setFontSize(18);
    doc.text('Takeoff Tooling - Purchase Order', margin, y);
    y += 30;

    const items = getFlattenedItems();
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text('Item', margin, y);
    doc.text('Quantity', margin + 350, y);
    y += 15;
    doc.setFont(undefined, 'normal');

    for (const item of items) {
      if (y > 700) {
        doc.addPage();
        y = margin;
      }
      const indent = (item._depth || 0) * 10;
      const desc = (item.description || '-').substring(0, 80);
      doc.text(desc, margin + indent, y);
      doc.text(String(item.quantity ?? 0), margin + 350, y);
      y += 14;
    }

    doc.save('takeoff-purchase-order.pdf');
  }

  function printWithForm(formData) {
    if (typeof jspdf === 'undefined' || !jspdf.jsPDF) {
      alert('PDF library not loaded. Please refresh the page.');
      return;
    }
    const doc = new jspdf.jsPDF();
    const margin = 40;
    let y = margin;

    doc.setFontSize(18);
    doc.text('Takeoff Tooling - Form', margin, y);
    y += 30;

    const items = getFlattenedItems();
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text('Description', margin, y);
    doc.text('Quantity', margin + 350, y);
    y += 15;
    doc.setFont(undefined, 'normal');

    for (const item of items) {
      if (y > 550) {
        doc.addPage();
        y = margin;
      }
      const indent = (item._depth || 0) * 10;
      const desc = (item.description || '-').substring(0, 80);
      doc.text(desc, margin + indent, y);
      doc.text(String(item.quantity ?? 0), margin + 350, y);
      y += 14;
    }

    y += 30;
    doc.setFont(undefined, 'bold');
    doc.text('Form Details', margin, y);
    y += 20;
    doc.setFont(undefined, 'normal');
    doc.text('Address: ' + (formData.address || ''), margin, y);
    y += 16;
    doc.text('Permit NO: ' + (formData.permitNo || ''), margin, y);
    y += 16;
    doc.text('Builder or Occupant: ' + (formData.builderOrOccupant || ''), margin, y);
    y += 16;
    doc.text('Electrical Count: ' + (formData.electricalCount || ''), margin, y);

    doc.save('takeoff-form.pdf');
  }

  return {
    printForReview,
    printForPurchaseOrder,
    printWithForm,
  };
})();
