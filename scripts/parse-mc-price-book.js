/**
 * Parse file1.htm (Excel-exported HTML) into mcPriceBook.json
 * Run: node scripts/parse-mc-price-book.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INPUT = path.join(ROOT, 'file1.htm');
const OUTPUT = path.join(ROOT, 'js', 'data', 'mcPriceBook.json');

function extractText(html) {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function parseRow(rowHtml) {
  const cells = [];
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let match;
  while ((match = tdRegex.exec(rowHtml)) !== null) {
    cells.push(extractText(match[1]));
  }
  return cells;
}

function parsePrice(val) {
  if (!val) return null;
  const cleaned = val.replace(/[$,]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseNum(val) {
  if (!val) return null;
  const num = parseFloat(String(val).replace(/,/g, ''));
  return isNaN(num) ? null : num;
}

function main() {
  const html = fs.readFileSync(INPUT, 'utf8');
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows = [];
  let match;

  while ((match = rowRegex.exec(html)) !== null) {
    const cells = parseRow(match[1]);
    if (cells.length < 15) continue;
    if (cells[1] === 'Item #') continue; // skip header
    if (!cells[1] && !cells[2]) continue; // skip empty rows

    const itemNo = cells[1] || '';
    const itemName = cells[2] || '';
    const bookPrice = parsePrice(cells[4]);
    const bookPriceUom = (cells[5] || '').trim().toUpperCase() || null;
    const pAdj1 = parseNum(cells[6]);
    const price1 = parsePrice(cells[8]);
    const price1Uom = (cells[9] || '').trim().toUpperCase() || null;
    const bidLbr = parseNum(cells[10]);
    const bidLbrUom = (cells[11] || '').trim().toUpperCase() || null;
    const neca1 = parseNum(cells[12]);
    const neca1Uom = (cells[13] || '').trim().toUpperCase() || null;
    const dciUpc = (cells[14] || '').trim() || null;

    rows.push({
      itemNo,
      itemName,
      bookPrice,
      bookPriceUom,
      pAdj1,
      price1,
      price1Uom,
      bidLbr,
      bidLbrUom,
      neca1,
      neca1Uom,
      dciUpc,
    });
  }

  fs.writeFileSync(OUTPUT, JSON.stringify(rows), 'utf8');
  console.log(`Parsed ${rows.length} rows to ${OUTPUT}`);
}

main();
