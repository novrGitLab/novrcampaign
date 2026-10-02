import { parse } from 'csv-parse';
import logger from '../utils/logger.js';

// Possible header spellings → canonical field
const FIELD_ALIASES = {
  email: ['email', 'emailaddress', 'email_address', 'e-mail', 'emailid', 'email_id', 'contact_email'],
  firstName: ['firstname', 'first_name', 'fname', 'givenname', 'given_name'],
  lastName: ['lastname', 'last_name', 'lname', 'familyname', 'family_name', 'surname'],
  name: ['name', 'fullname', 'full_name'],
};

/** @type {Set<string>} */
const CANONICAL = new Set(Object.keys(FIELD_ALIASES));

function normalizeHeader(header) {
  return String(header).trim().toLowerCase().replace(/[\s_-]+/g, '').replace(/[^a-z0-9@.]/g, '');
}

/**
 * Brevo/Mailchimp-style exports are often semicolon-delimited — sniff the
 * first line and use whichever delimiter actually appears.
 * @param {string} text
 */
function detectDelimiter(text) {
  const firstLine = String(text).split(/\r?\n/, 1)[0] ?? '';
  const semis = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return semis > commas ? ';' : ',';
}

/**
 * Build a header → canonical-field index.
 * @param {string[]} headers
 */
function buildHeaderMap(headers) {
  const map = new Map();
  headers.forEach((header, index) => {
    const key = normalizeHeader(header);
    for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.includes(key)) {
        map.set(index, canonical);
        return;
      }
    }
  });
  return map;
}

/**
 * Parse CSV into a normalized contact list.
 *
 * @param {Buffer|string} input
 * @param {{ maxRows?: number }} [opts]
 * @returns {Promise<{
 *   contacts: Array<{ email: string, firstName?: string, lastName?: string, attributes: object }>,
 *   stats: { total: number, parsed: number, skipped: number, duplicates: number }
 * }>}
 */
export async function parseContactsCsv(input, { maxRows = 100_000 } = {}) {
  const text = Buffer.isBuffer(input) ? input.toString('utf-8') : String(input);
  return new Promise((resolve, reject) => {
    const contacts = [];
    const seenEmails = new Set();
    let total = 0;
    let skipped = 0;
    let duplicates = 0;
    let headerMap = null;

    const parser = parse({
      columns: true,
      delimiter: detectDelimiter(text),
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_quotes: true,
      relax_column_count: true,
      max_records: maxRows,
    });

    parser.on('error', (err) => reject(err));

    parser.on('readable', () => {
      let record;
      while ((record = parser.read())) {
        total += 1;

        const headers = Object.keys(record);
        if (!headerMap) headerMap = buildHeaderMap(headers);

        /** @type {any} */
        const contact = { attributes: {} };
        let hasEmail = false;

        headers.forEach((header, index) => {
          const value = record[header];
          if (value === undefined || value === '') return;

          const canonical = headerMap.get(index);
          if (canonical === 'email') {
            contact.email = String(value).trim().toLowerCase();
            hasEmail = true;
          } else if (canonical === 'firstName') {
            contact.firstName = value;
          } else if (canonical === 'lastName') {
            contact.lastName = value;
          } else if (canonical === 'name' && !contact.firstName) {
            // Split a full name when no explicit first/last columns exist
            const [first, ...rest] = value.split(/\s+/);
            contact.firstName = first;
            contact.lastName = rest.join(' ') || undefined;
          } else if (!CANONICAL.has(canonical)) {
            // Preserve custom columns (e.g. Company, Plan) as attributes
            contact.attributes[normalizeHeader(header)] = value;
          }
        });

        if (!hasEmail || !contact.email) {
          skipped += 1;
          return;
        }

        if (seenEmails.has(contact.email)) {
          duplicates += 1;
          return;
        }
        seenEmails.add(contact.email);
        contacts.push(contact);
      }
    });

    parser.on('end', () => {
      const stats = { total, parsed: contacts.length, skipped, duplicates };
      logger.info(stats, 'CSV parsed');
      resolve({ contacts, stats });
    });

    parser.write(text);
    parser.end();
  });
}

export default { parseContactsCsv };
