/**
 * Push the built-in CyberNovr newsletter starters to Plunk as templates.
 *
 * Usage (from backend/):  npm run seed:templates
 * Requires PLUNK_API_KEY in backend/.env. Safe to re-run — it skips
 * templates whose name already exists.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config/env.js';
import { getTemplates, createTemplate } from '../src/services/plunkService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, '../../frontend/src/templates');

async function main() {
  if (!config.plunk.apiKey) {
    console.error('PLUNK_API_KEY is not set in backend/.env — cannot seed templates.');
    process.exit(1);
  }

  const starters = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, 'starters.json'), 'utf8'));
  const existing = await getTemplates();
  const existingNames = new Set((Array.isArray(existing) ? existing : (existing?.data ?? [])).map((t) => t.name));

  const out = (msg) => process.stdout.write(`${msg}\n`);
  for (const s of starters) {
    if (existingNames.has(s.name)) {
      out(`skip  "${s.name}" (already exists)`);
      continue;
    }
    const body = fs.readFileSync(path.join(TEMPLATES_DIR, s.file), 'utf8');
    const created = await createTemplate({ name: s.name, subject: s.subject, body, type: s.type });
    out(`created "${created.name}" (${created.id})`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
