#!/usr/bin/env node
/**
 * Extract hierarchy (level1, level2, level3, assmName) from UI screenshots using LLaVA via Ollama.
 * Sends each image to Ollama, parses the response, and appends to hierarchy-staging.jsonl.
 *
 * Usage:
 *   node scripts/extract-hierarchy-from-images.js [images-dir]
 *   node scripts/extract-hierarchy-from-images.js [images-dir] --limit N
 *
 * Default images dir: hierarchy-images/
 * Requires: Ollama running with LLaVA (ollama run llava)
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

const IMAGES_DIR = path.resolve(process.cwd(), args[0] || 'source-data/hierarchy-images');
const STAGING_PATH = path.join(__dirname, '../source-data/hierarchy-staging.jsonl');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'llava:13b';
const DELAY_MS = parseInt(process.env.DELAY_MS || '500', 10);

const PROMPT = `CRITICAL: This task is ONLY for an ELECTRICAL ESTIMATING / MC ASSEMBLY picker. REJECT and return [] if you see: bathroom, kitchen, sink, fuel, household, sports, vehicles, food, laundry, plumbing, or any non-electrical category picker.

Each image is different. Extract ONLY what you see in THIS image. Do not guess, infer, or reuse values from other images. Never output the same level1/level2/level3 for multiple different images.

The UI has 4 columns. Follow these steps exactly:

STEP 1 - Blue row (level1, level2, level3):
Find the ONE row highlighted in blue across columns 1, 2, 3. That row gives you:
- level1 = exact text in column 1 of that blue row. Copy character-for-character.
- level2 = exact text in column 2 of that blue row. Copy character-for-character.
- level3 = exact text in column 3 of that blue row.

The blue row has a blue background; other rows in the same column have white/light background. Use ONLY the text from the blue-background row.

level1 and level2 MUST be the exact text in the blue cells. If you cannot clearly read the blue row, return [].

Do NOT use column headers. Do NOT put column 4 content into level3. Do NOT mix values from different rows.

STEP 2 - Target column for assmName:
- If column 4 (rightmost) has visible text rows: extract EVERY row of text from column 4. Each row becomes one assmName.
- If column 4 is empty: output ONE record with level1, level2, level3 from the blue row and assmName="". It is acceptable for assmName to be empty when level3 is populated. Do NOT fabricate assmName from column 3 if you are uncertain.

STEP 3 - Output:
Return one JSON object per row in the target column (or one object with assmName="" when column 4 is empty). Each object has the SAME level1, level2, level3 (from step 1) and a DIFFERENT assmName (from step 2, or "" when column 4 is empty).

The examples below show OUTPUT FORMAT only. Do NOT copy their values. Your level1, level2, level3 must come from the blue row in THIS image.

Example (column 4 has 3 items):
[{"level1":"Branch with Constants","level2":"EMT Drops","level3":"D/S Drops Strap","assmName":"5' drop emt d/s strap"},{"level1":"Branch with Constants","level2":"EMT Drops","level3":"D/S Drops Strap","assmName":"5' drop n14 emt d/s strap"},{"level1":"Branch with Constants","level2":"EMT Drops","level3":"D/S Drops Strap","assmName":"11' drop n14 emt d/s strap"}]

Example (column 4 empty):
[{"level1":"Branch with Constants","level2":"EMT Branch Parts","level3":"emt d/c branch parts","assmName":""}]

If both column 4 and column 3 are empty, return: []
Return ONLY valid JSON. No other text.`;

const IMAGE_EXT = /\.(png|jpg|jpeg|webp)$/i;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getImageFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => IMAGE_EXT.test(f))
    .map((f) => path.join(dir, f))
    .sort();
}

function extractJson(text) {
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  const objectMatch = text.match(/\{[\s\S]*\}/);
  const raw = arrayMatch ? arrayMatch[0] : objectMatch ? objectMatch[0] : null;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return null;
  }
}

async function callOllama(imagePath) {
  const imageBuffer = fs.readFileSync(imagePath);
  const base64 = imageBuffer.toString('base64');

  const body = {
    model: MODEL,
    messages: [
      {
        role: 'user',
        content: PROMPT,
        images: [base64],
      },
    ],
    stream: false,
    options: { temperature: 0 },
  };

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama ${res.status}: ${err}`);
  }

  const data = await res.json();
  const content = data.message?.content || '';
  return extractJson(content);
}

const ELECTRICAL_PATTERN = /emt|grc|pvc|strap|wire|branch|feeder|conduit|n\d|d\/s|const|elbow|hub|box|receptacle|switch/i;

function looksElectrical(record) {
  const s = (record.assmName || '') + ' ' + (record.level1 || '') + ' ' + (record.level2 || '') + (record.level3 || '');
  return ELECTRICAL_PATTERN.test(s) && !/^\.\.\.$|^[123]$|bathroom|kitchen|sink|fuel|laundry|sport|vehicle|food|shampoo|soap/i.test(s);
}

function hasRequiredLevels(record) {
  return record && record.level1 && record.level2;
}

function appendStaging(record, sourceFile) {
  const line = JSON.stringify({ ...record, source_image: path.basename(sourceFile) }) + '\n';
  fs.appendFileSync(STAGING_PATH, line, 'utf8');
}

async function main() {
  let images = getImageFiles(IMAGES_DIR);
  if (images.length === 0) {
    console.error(`No images found in ${IMAGES_DIR}`);
    console.error('Put PNG/JPG/JPEG/WEBP screenshots in hierarchy-images/ or pass a path.');
    process.exit(1);
  }

  if (limit) {
    images = images.slice(0, limit);
    console.log(`Limiting to first ${limit} images.`);
  }

  console.log(`Found ${images.length} images. Processing with ${MODEL}...`);
  console.log(`Output: ${STAGING_PATH}`);
  console.log('');

  let ok = 0;
  let fail = 0;

  for (let i = 0; i < images.length; i++) {
    const imgPath = images[i];
    const name = path.basename(imgPath);
    process.stdout.write(`[${i + 1}/${images.length}] ${name} ... `);

    try {
      const result = await callOllama(imgPath);
      if (!result || result.length === 0) {
        console.log('SKIP (empty/not electrical)');
        fail++;
      } else {
        let count = 0;
        for (const record of result) {
          const assms = Array.isArray(record.assmName)
            ? record.assmName
            : record.assmName !== undefined && record.assmName !== null
              ? [record.assmName]
              : [''];
          for (const assm of assms) {
            if (!hasRequiredLevels(record)) continue;
            const r = {
              level1: record.level1,
              level2: record.level2,
              level3: record.level3 || '',
              assmName: assm === undefined || assm === null ? '' : String(assm),
            };
            if (looksElectrical(r)) {
              appendStaging(r, imgPath);
              count++;
            }
          }
        }
        if (count > 0) {
          console.log(`OK (${count})`);
          ok += count;
        } else {
          console.log('SKIP (no valid rows)');
          fail++;
        }
      }
    } catch (err) {
      console.log('FAIL:', err.message);
      fail++;
    }

    if (i < images.length - 1) await sleep(DELAY_MS);
  }

  console.log('');
  console.log(`Done. ${ok} rows extracted, ${fail} images skipped.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
