#!/usr/bin/env node
/**
 * Convert mc-assemblies/*.csv to a single JSON file.
 * Parses assembly rows (Assm #, Assm Name, Material, Labor, Unit Price) and
 * their child item rows (Item #, Item Name, BPQty, Price 1, Bid Lbr).
 */

const fs = require('fs');
const path = require('path');

const MC_DIR = path.join(__dirname, '../mc-assemblies');
const OUTPUT_PATH = path.join(__dirname, '../mc-assemblies/mc-assemblies.json');

const CSV_FILES = [
  'mc1to10000.csv',
  'mc10001to20000.csv',
  'mc20001to30000.csv',
  'mc30001to34810.csv',
];

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}

function parseMoney(val) {
  if (!val || typeof val !== 'string') return null;
  const cleaned = val.replace(/[$,]/g, '').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function parseNum(val) {
  if (val == null || val === '') return null;
  const n = parseFloat(String(val).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

// Format 1 (mc1to10000): leading empty column - Assm # in col 1, Name in col 3
// Format 2 (mc10001+): no leading empty - Assm # in col 0, Name in col 2
function detectFormat(cells) {
  const c0 = (cells[0] || '').trim();
  const c1 = (cells[1] || '').trim();
  if (c1 === 'Assm #' || c1 === 'Item #') return 1;
  if (c0 === 'Assm #' || c0 === 'Item #') return 2;
  const num0 = parseNum(c0);
  const num1 = parseNum(c1);
  const name1 = (cells[3] || '').trim();
  const name2 = (cells[2] || '').trim();
  if (num1 !== null && name1.length > 0) return 1;
  if (num0 !== null && name2.length > 0) return 2;
  return 1; // default
}

function isAssemblyRow(cells, fmt) {
  if (fmt === 1) {
    const col1 = cells[1];
    const col3 = (cells[3] || '').trim();
    if (!col3) return false;
    if (col1 === 'Item #' || col1 === 'Assm #') return false;
    return parseNum(col1) !== null && col3.length > 0;
  }
  const col0 = cells[0];
  const col2 = (cells[2] || '').trim();
  if (!col2) return false;
  if (col0 === 'Item #' || col0 === 'Assm #') return false;
  return parseNum(col0) !== null && col2.length > 0;
}

function isItemHeaderRow(cells, fmt) {
  return fmt === 1
    ? (cells[1] || '').trim() === 'Item #'
    : (cells[0] || '').trim() === 'Item #';
}

function isItemDataRow(cells, fmt) {
  if (fmt === 1) {
    const col1 = cells[1];
    const col2 = (cells[2] || '').trim();
    return parseNum(col1) !== null && col2.length > 0;
  }
  const col0 = cells[0];
  const col1 = (cells[1] || '').trim();
  return parseNum(col0) !== null && col1.length > 0;
}

function parseCSVFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  const assemblies = [];
  let currentAssembly = null;
  let expectItems = false;
  let fmt = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cells = parseCSVLine(line);

    // Skip empty rows
    if (cells.every((c) => !c || c.trim() === '')) continue;
    if ((cells[1] || '').trim() === 'Assm #' || (cells[0] || '').trim() === 'Assm #') continue;

    // Detect format from first data row
    if (currentAssembly === null && isAssemblyRow(cells, 1)) fmt = 1;
    else if (currentAssembly === null && isAssemblyRow(cells, 2)) fmt = 2;

    if (isAssemblyRow(cells, fmt)) {
      if (currentAssembly) assemblies.push(currentAssembly);
      let assmNum, assmName, material, laborHours, unitPrice1, unitPrice2;
      if (fmt === 1) {
        assmNum = parseNum(cells[1]) || cells[1];
        assmName = (cells[3] || '').trim();
        material = parseMoney(cells[7]);
        laborHours = parseNum(cells[10]);
        unitPrice1 = parseMoney(cells[13]);
        unitPrice2 = parseMoney(cells[18]);
      } else {
        assmNum = parseNum(cells[0]) || cells[0];
        assmName = (cells[2] || '').trim();
        material = parseMoney(cells[6]);
        laborHours = parseNum(cells[9]);
        unitPrice1 = parseMoney(cells[12]);
        unitPrice2 = parseMoney(cells[17]);
      }
      currentAssembly = {
        assmNum,
        assmName,
        material,
        laborHours,
        unitPrice1,
        unitPrice2,
        items: [],
      };
      expectItems = true;
    } else if (expectItems && isItemHeaderRow(cells, fmt)) {
      continue;
    } else if (expectItems && isItemDataRow(cells, fmt)) {
      let itemNum, itemName, bpQty, bpConst, price1, bidLbr, bidLbrUnit;
      if (fmt === 1) {
        itemNum = parseNum(cells[1]) || cells[1];
        itemName = (cells[2] || '').trim();
        bpQty = parseNum(cells[6]);
        bpConst = parseNum(cells[9]);
        price1 = parseMoney(cells[11]);
        bidLbrUnit = (cells[14] || '').trim() || null;
        bidLbr = parseNum(cells[15]);
      } else {
        itemNum = parseNum(cells[0]) || cells[0];
        itemName = (cells[1] || '').trim();
        bpQty = parseNum(cells[5]);
        bpConst = parseNum(cells[8]);
        price1 = parseMoney(cells[10]);
        bidLbrUnit = (cells[13] || '').trim() || null;
        bidLbr = parseNum(cells[14]);
      }
      if (currentAssembly) {
        currentAssembly.items.push({
          itemNum,
          itemName,
          bpQty,
          bpConst,
          price1,
          bidLbr,
          bidLbrUnit,
        });
      }
    } else {
      expectItems = false;
    }
  }

  if (currentAssembly) assemblies.push(currentAssembly);
  return assemblies;
}

function main() {
  const allAssemblies = [];
  const byFile = {};

  for (const file of CSV_FILES) {
    const filePath = path.join(MC_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`Skipping ${file} (not found)`);
      continue;
    }
    console.log(`Parsing ${file}...`);
    const assemblies = parseCSVFile(filePath);
    byFile[file] = assemblies.length;
    allAssemblies.push(...assemblies);
  }

  const result = {
    meta: {
      source: 'mc-assemblies/*.csv',
      generatedAt: new Date().toISOString(),
      totalAssemblies: allAssemblies.length,
      byFile,
    },
    assemblies: allAssemblies,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\nWrote ${OUTPUT_PATH}`);
  console.log(`Total assemblies: ${allAssemblies.length}`);
  console.log('By file:', byFile);
}

main();
