#!/usr/bin/env node
/**
 * Merge hierarchy mapping (level1, level2, level3) into mc-assemblies.json.
 * Reads mc-hierarchy-mapping.csv and adds level1, level2, level3 to each assembly.
 */

const fs = require('fs');
const path = require('path');

const MAPPING_PATH = path.join(__dirname, '../mc-assemblies/mc-hierarchy-mapping.csv');
const JSON_PATH = path.join(__dirname, '../mc-assemblies/mc-assemblies.json');

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

function loadMapping() {
  const map = new Map();
  if (!fs.existsSync(MAPPING_PATH)) return map;
  const text = fs.readFileSync(MAPPING_PATH, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return map;
  const header = parseCSVLine(lines[0]);
  const assmNameIdx = header.indexOf('assmName');
  const level1Idx = header.indexOf('level1');
  const level2Idx = header.indexOf('level2');
  const level3Idx = header.indexOf('level3');
  if (assmNameIdx < 0 || level1Idx < 0 || level2Idx < 0 || level3Idx < 0) return map;
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i]);
    const assmName = (cells[assmNameIdx] || '').trim();
    if (!assmName) continue;
    map.set(assmName, {
      level1: (cells[level1Idx] || '').trim(),
      level2: (cells[level2Idx] || '').trim(),
      level3: (cells[level3Idx] || '').trim(),
    });
  }
  return map;
}

function main() {
  const mapping = loadMapping();
  const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const assemblies = data.assemblies || [];
  let updated = 0;
  for (const a of assemblies) {
    const assmName = (a.assmName || '').trim();
    const entry = mapping.get(assmName);
    a.level1 = entry ? entry.level1 : '';
    a.level2 = entry ? entry.level2 : '';
    a.level3 = entry ? entry.level3 : '';
    if (entry) updated++;
  }
  fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Updated ${updated} of ${assemblies.length} assemblies with hierarchy.`);
}

main();
