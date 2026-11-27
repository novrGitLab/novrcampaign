import Joi from 'joi';
import { prisma } from '../utils/prisma.js';
import { Conflict, Forbidden, NotFound } from '../utils/AppError.js';

const address = Joi.string().trim().lowercase().email({ tlds: false }).max(254).required();
const userFields = { id: true, email: true, name: true, role: true, oidcSubject: true };
export const requestFields = {
  id: true,
  email: true,
  name: true,
  status: true,
  role: true,
  requestedAt: true,
  decidedAt: true,
};

function domains() {
  return (process.env.OIDC_ALLOWED_EMAIL_DOMAINS ?? 'cybernovr.com')
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
function internal(email) {
  return domains().includes(email.split('@').at(-1));
}

async function lockIdentity(tx, subject, email) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'pulse-subject:' + subject}, 0))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'pulse-email:' + email}, 0))`;
}
async function matchingProfile(tx, subject, email) {
  const bound = await tx.user.findUnique({ where: { oidcSubject: subject }, select: userFields });
  const matching = await tx.user.findMany({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: userFields,
    take: 2,
  });
  const existing = bound ?? matching[0];
  if (
    matching.some((user) => user.id !== existing?.id) ||
    (existing?.oidcSubject && existing.oidcSubject !== subject)
  ) {
    throw Conflict('Staff profile belongs to another identity');
  }
  return existing;
}

export async function resolveStaffLogin(issuer, identity) {
  const { value: email, error } = address.validate(identity.email);
  if (
    error ||
    identity.email_verified !== true ||
    !internal(email) ||
    typeof identity.sub !== 'string' ||
    !identity.sub.trim()
  ) {
    throw Forbidden('Verified staff identity required');
  }
  const oidcSubject = issuer + '#' + identity.sub;
  const name =
    typeof identity.name === 'string' && identity.name.trim() ? identity.name.trim().slice(0, 200) : email;
  return prisma.$transaction(async (tx) => {
    await lockIdentity(tx, oidcSubject, email);
    const profile = await matchingProfile(tx, oidcSubject, email);
    if (profile?.oidcSubject === oidcSubject) {
      const user =
        profile.name === name && profile.email === email
          ? profile
          : await tx.user.update({ where: { id: profile.id }, data: { name, email }, select: userFields });
      return { user };
    }
    const request = await tx.staffAccessRequest.upsert({
      where: { oidcSubject },
      create: { oidcSubject, email, name, notices: { create: { kind: 'WELCOME', recipient: email } } },
      update: { email, name },
      select: requestFields,
    });
    return { request };
  });
}

export async function submitStaffRequest(id) {
  return prisma.$transaction(async (tx) => {
    const transition = await tx.staffAccessRequest.updateMany({
      where: { id, status: 'NEW' },
      data: { status: 'PENDING', requestedAt: new Date() },
    });
    const request = await tx.staffAccessRequest.findUniqueOrThrow({ where: { id }, select: requestFields });
    if (!transition.count) return request;
    const admins = await tx.user.findMany({
      where: { role: 'ADMIN', oidcSubject: { not: null } },
      select: { email: true },
    });
    const recipients = admins.filter(
      (admin) => internal(admin.email.toLowerCase()) && admin.email.toLowerCase() !== request.email,
    );
    if (!recipients.length) throw Conflict('No newsroom administrator is available to review requests');
    await tx.staffAccessNotice.createMany({
      data: [
        { requestId: id, recipient: request.email, kind: 'RECEIVED' },
        ...recipients.map((admin) => ({ requestId: id, recipient: admin.email, kind: 'REVIEW' })),
      ],
      skipDuplicates: true,
    });
    return request;
  });
}

export async function decideStaffRequest(id, actor, action, role) {
  if (actor.role !== 'ADMIN') throw Forbidden('Administrator access required');
  return prisma.$transaction(async (tx) => {
    const row = await tx.staffAccessRequest.findUnique({ where: { id } });
    if (!row) throw NotFound('Access request not found');
    await lockIdentity(tx, row.oidcSubject, row.email);
    if (actor.email.toLowerCase() === row.email || !internal(row.email))
      throw Forbidden('This request cannot be reviewed by this account');
    const status = action === 'approve' ? 'APPROVED' : action === 'decline' ? 'DECLINED' : null;
    if (!status || (status === 'APPROVED' && !['ADMIN', 'SENDER', 'VIEWER'].includes(role)))
      throw Conflict('Choose a decision and a valid role');
    const change = await tx.staffAccessRequest.updateMany({
      where: { id, email: row.email, status: 'PENDING' },
      data: {
        status,
        role: status === 'APPROVED' ? role : null,
        decidedBy: actor.id,
        decidedAt: new Date(),
      },
    });
    if (!change.count) throw Conflict('This request is no longer awaiting review');
    if (status === 'APPROVED') {
      const existing = await matchingProfile(tx, row.oidcSubject, row.email);
      const profile = { name: row.name, email: row.email, oidcSubject: row.oidcSubject, role };
      if (existing) await tx.user.update({ where: { id: existing.id }, data: profile });
      else await tx.user.create({ data: profile });
    }
    await tx.staffAccessNotice.create({ data: { requestId: id, recipient: row.email, kind: status } });
    return tx.staffAccessRequest.findUniqueOrThrow({ where: { id }, select: requestFields });
  });
}
