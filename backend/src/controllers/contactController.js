import Joi from 'joi';
import { BadRequest } from '../utils/AppError.js';
import logger from '../utils/logger.js';
import * as plunk from '../services/plunkService.js';
import { validateCsv } from '../services/emailService.js';

// Vercel Hobby request bodies cap at ~4.5 MB — set CSV_MAX_BYTES=4194304 there
const MAX_CSV_BYTES = Number(process.env.CSV_MAX_BYTES ?? 5 * 1024 * 1024);

const contactSchema = Joi.object({
  email: Joi.string().email().required(),
  subscribed: Joi.boolean().default(true),
  data: Joi.object().unknown(true).optional(),
});

const bulkSchema = Joi.object({
  ids: Joi.array().items(Joi.string()).max(1000).required(),
});

/**
 * GET /api/contacts — cursor-paginated contact list straight from Plunk.
 */
export async function getContacts(req, res) {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
  const { cursor, search } = req.query;

  const result = await plunk.getContacts({ limit, cursor, search });
  return res.json(result);
}

/**
 * GET /api/contacts/:id — single contact (Contact 360 detail).
 */
export async function getContact(req, res) {
  const contact = await plunk.getContact(req.params.id);
  return res.json({ contact });
}

/**
 * PATCH /api/contacts/:id — update email / subscription / data fields.
 */
export async function updateContact(req, res) {
  const value = await Joi.object({
    email: Joi.string().email().optional(),
    subscribed: Joi.boolean().optional(),
    data: Joi.object().unknown(true).optional(),
  }).validateAsync(req.body, { stripUnknown: true });
  const contact = await plunk.updateContact(req.params.id, value);
  return res.json({ contact });
}

/**
 * POST /api/contacts — create or upsert a single contact in Plunk.
 */
export async function createContact(req, res) {
  const value = await contactSchema.validateAsync(req.body, { stripUnknown: true });
  const contact = await plunk.createContact(value);
  return res.status(201).json(contact);
}

/**
 * POST /api/contacts/bulk-subscribe
 */
export async function bulkSubscribe(req, res) {
  const { ids } = await bulkSchema.validateAsync(req.body, { stripUnknown: true });
  const jobId = await plunk.bulkSubscribe(ids);
  return res.status(202).json({ jobId });
}

/**
 * POST /api/contacts/bulk-unsubscribe
 */
export async function bulkUnsubscribe(req, res) {
  const { ids } = await bulkSchema.validateAsync(req.body, { stripUnknown: true });
  const jobId = await plunk.bulkUnsubscribe(ids);
  return res.status(202).json({ jobId });
}

/**
 * POST /api/contacts/bulk-delete
 */
export async function bulkDelete(req, res) {
  const { ids } = await bulkSchema.validateAsync(req.body, { stripUnknown: true });
  const jobId = await plunk.bulkDelete(ids);
  return res.status(202).json({ jobId });
}

/**
 * GET /api/contacts/bulk/:jobId — poll a bulk job
 */
export async function getBulkJob(req, res) {
  const job = await plunk.getBulkJob(req.params.jobId);
  return res.json(job);
}

/**
 * POST /api/contacts/import — validate locally, then hand the CSV to Plunk.
 * Plunk is the source of truth; we only add a pre-flight report.
 */
export async function importContacts(req, res) {
  const file = req.file;

  if (!file) throw BadRequest('No CSV file uploaded');
  if (file.size > MAX_CSV_BYTES) {
    throw BadRequest(`CSV exceeds the ${MAX_CSV_BYTES / 1024 / 1024} MB importer limit`);
  }

  const checkMx = req.body.checkMx !== 'false';

  const report = await validateCsv(file.buffer, { checkMx }).catch((err) => {
    logger.error({ err: err.message }, 'CSV validation failed');
    throw BadRequest(`Could not parse CSV: ${err.message}`);
  });

  // Forward the untouched buffer; Plunk does the real import
  const jobId = await plunk.importContactsCsv(file.buffer);

  return res.status(202).json({
    jobId,
    report,
    message: `Importing ${report.valid} valid contact(s); ${report.invalid.length} rejected`,
  });
}

/**
 * GET /api/contacts/import/:jobId — poll an import job
 */
export async function getImportJob(req, res) {
  const job = await plunk.getImportJob(req.params.jobId);
  return res.json(job);
}
