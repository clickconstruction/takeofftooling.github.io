#!/usr/bin/env node
/**
 * Extract section-head assemblies from mc-assemblies.json to CSV.
 * Section heads have empty items and zero material/labor/prices.
 */

const fs = require('fs');
const path = require('path');

const INPUT_PATH = path.join(__dirname, '../source-data/mc-assemblies.json');
const OUTPUT_PATH = path.join(__dirname, '../source-data/mc-section-heads.csv');

function isSectionHead(a) {
  return (
    a.items &&
    a.items.length === 0 &&
    (!a.material || a.material === 0) &&
    (!a.laborHours || a.laborHours === 0) &&
    (!a.unitPrice1 || a.unitPrice1 === 0) &&
    (!a.unitPrice2 || a.unitPrice2 === 0)
  );
}

function escapeCsvValue(val) {
  if (val == null) return '';
  const s = String(val);
  if (/[,"\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function main() {
  const data = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));
  const sectionHeads = (data.assemblies || []).filter(isSectionHead);

  const header = 'level1,level2,level3,assmNum,assmName';
  const rows = sectionHeads.map((a) => {
    const level1 = escapeCsvValue(a.level1);
    const level2 = escapeCsvValue(a.level2);
    const level3 = escapeCsvValue(a.level3);
    const num = a.assmNum;
    const name = escapeCsvValue(a.assmName);
    return `${level1},${level2},${level3},${num},${name}`;
  });
  const csv = [header, ...rows].join('\n');

  fs.writeFileSync(OUTPUT_PATH, csv, 'utf8');
  console.log(`Wrote ${sectionHeads.length} section heads to mc-section-heads.csv`);
}

main();
