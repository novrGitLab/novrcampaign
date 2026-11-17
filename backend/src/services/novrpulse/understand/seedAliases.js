import { prisma } from '../../../utils/prisma.js';
import logger from '../../../utils/logger.js';
import { normaliseAlias } from '../analysers.js';

/**
 * Curated Nigerian entity seed (plan §3.2, "the moat").
 *
 * These are the aliases that MUST resolve to one node from day one. They are
 * drafted from the register's regulators plus the obvious bank/fintech/telco
 * members, and are marked `approvedBy: 'seed'` so it is explicit that a human
 * authored the list rather than the model.
 *
 * This is a starting set, not the finished table. It should grow from the golden
 * set (Phase 0), not from imagination — the plan is clear that entity resolution
 * is where accuracy needs humans.
 */

/** Each entry: canonical name, type, country, and the surface forms that map to it. */
export const ENTITY_SEED = [
  { name: 'Central Bank of Nigeria', type: 'agency', country: 'NG', aliases: ['CBN', 'the apex bank', 'central bank'] },
  { name: 'Nigerian Communications Commission', type: 'agency', country: 'NG', aliases: ['NCC'] },
  { name: 'National Information Technology Development Agency', type: 'agency', country: 'NG', aliases: ['NITDA'] },
  { name: 'Nigeria Data Protection Commission', type: 'agency', country: 'NG', aliases: ['NDPC', 'NDPB'] },
  { name: 'ngCERT', type: 'agency', country: 'NG', aliases: ['ngCERT', 'Nigerian CERT', 'CERT.gov.ng'] },
  { name: 'Economic and Financial Crimes Commission', type: 'agency', country: 'NG', aliases: ['EFCC'] },
  { name: 'Nigeria Police Force', type: 'agency', country: 'NG', aliases: ['NPF', 'NPF-NCCC', 'Nigeria Police'] },
  { name: 'Guaranty Trust Holding Company', type: 'org', country: 'NG', aliases: ['GTCO', 'GTBank', 'Guaranty Trust Bank', 'Guaranty Trust'] },
  { name: 'Zenith Bank', type: 'org', country: 'NG', aliases: ['Zenith'] },
  { name: 'Access Holdings', type: 'org', country: 'NG', aliases: ['Access Bank', 'Access Holdings Plc'] },
  { name: 'United Bank for Africa', type: 'org', country: 'NG', aliases: ['UBA'] },
  { name: 'First Bank of Nigeria', type: 'org', country: 'NG', aliases: ['FirstBank', 'First Bank'] },
  { name: 'Opay', type: 'org', country: 'NG', aliases: ['OPay', 'OPay Digital Services'] },
  { name: 'Flutterwave', type: 'org', country: 'NG', aliases: ['Flutterwave Inc'] },
  { name: 'Paystack', type: 'org', country: 'NG', aliases: ['Paystack Inc'] },
  { name: 'MTN Nigeria', type: 'org', country: 'NG', aliases: ['MTN'] },
  { name: 'Airtel Africa', type: 'org', country: 'NG', aliases: ['Airtel', 'Airtel Nigeria'] },
  { name: 'Glo', type: 'org', country: 'NG', aliases: ['Globacom', 'Globacom Nigeria'] },
  { name: 'Nigeria', type: 'location', country: 'NG', aliases: ['Nigerian', 'Federal Republic of Nigeria'] },
];

/**
 * Seed entities and their aliases. Idempotent: an alias already present is left
 * alone (so a curated override is never clobbered by the seed).
 *
 * @returns {Promise<{ entities:number, aliases:number }>}
 */
export async function seedAliases() {
  let entities = 0;
  let aliases = 0;

  for (const entry of ENTITY_SEED) {
    let entity = await prisma.npEntity.findFirst({
      where: { canonicalName: entry.name, type: entry.type },
    });
    if (!entity) {
      entity = await prisma.npEntity.create({
        data: { type: entry.type, canonicalName: entry.name, country: entry.country ?? null },
      });
      entities += 1;
    }

    for (const surface of [entry.name, ...entry.aliases]) {
      const alias = normaliseAlias(surface);
      const exists = await prisma.npEntityAlias.findUnique({ where: { alias } });
      if (exists) continue;
      await prisma.npEntityAlias.create({
        data: { alias, entityId: entity.id, approvedBy: 'seed' },
      });
      aliases += 1;
    }
  }

  logger.info({ entities, aliases }, 'NovrPulse entity seed applied');
  return { entities, aliases };
}

export default { seedAliases, ENTITY_SEED };
