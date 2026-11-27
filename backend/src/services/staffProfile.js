import Joi from 'joi';
import { prisma } from '../utils/prisma.js';

const emailAddress = Joi.string().trim().lowercase().email({ tlds: false }).max(254).required();
const roles = new Set(['ADMIN', 'SENDER', 'VIEWER']);
const profileFields = { id: true, name: true, email: true, role: true, oidcSubject: true };

export async function resolveStaffProfile(issuer, identity) {
  const { value: email, error } = emailAddress.validate(identity.email);
  const domains = (process.env.OIDC_ALLOWED_EMAIL_DOMAINS ?? 'cybernovr.com')
    .toLowerCase().split(',').map(domain => domain.trim()).filter(Boolean);
  if (error || identity.email_verified !== true || !domains.includes(email.split('@').at(-1))) {
    throw new Error('Staff identity required');
  }
  if (typeof identity.sub !== 'string' || !identity.sub.trim()) throw new Error('Subject required');
  const oidcSubject = issuer + '#' + identity.sub;
  const name = typeof identity.name === 'string' && identity.name.trim() ? identity.name.trim().slice(0, 200) : undefined;

  return prisma.$transaction(async tx => {
    // Lock both identity keys in a consistent order so concurrent callbacks can safely create or link one profile.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'pulse-subject:' + oidcSubject}, 0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'pulse-email:' + email}, 0))`;
    const bound = await tx.user.findUnique({ where: { oidcSubject }, select: profileFields });
    const matching = await tx.user.findMany({ where: { email: { equals: email, mode: 'insensitive' } }, select: profileFields, take: 2 });
    const existing = bound ?? matching[0];
    if (matching.some(user => user.id !== existing?.id) || (existing?.oidcSubject && existing.oidcSubject !== oidcSubject)) {
      throw new Error('Staff identity conflict');
    }
    if (existing) {
      if (existing.oidcSubject === oidcSubject && email === existing.email && (!name || name === existing.name)) return existing;
      return tx.user.update({ where: { id: existing.id }, data: { oidcSubject, email, ...(name && { name }) }, select: profileFields });
    }
    const role = process.env.OIDC_DEFAULT_ROLE ?? 'ADMIN';
    if (!roles.has(role)) throw new Error('Invalid initial staff role');
    return tx.user.create({ data: { oidcSubject, email, name: name ?? email, role }, select: profileFields });
  });
}

