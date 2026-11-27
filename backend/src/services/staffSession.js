import { randomBytes, createHash } from 'node:crypto';
import { prisma } from '../utils/prisma.js';
import { config } from '../config/env.js';

export const sessionName = 'pulse_staff';
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const opaqueToken = () => randomBytes(32).toString('base64url');
export const cookieOptions = { httpOnly: true, secure: config.isProd, sameSite: 'lax', path: '/' };

export async function issueSession(res, userId) {
  const token = opaqueToken();
  const maxAge = 8 * 60 * 60 * 1000;
  await prisma.staffSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.staffSession.create({
    data: { hash: digest(token), userId, expiresAt: new Date(Date.now() + maxAge) },
  });
  res.cookie(sessionName, token, { ...cookieOptions, maxAge });
}

export async function sessionUser(req) {
  const token = req.cookies?.[sessionName];
  if (!token) return null;
  const session = await prisma.staffSession.findFirst({
    where: { hash: digest(token), expiresAt: { gt: new Date() } },
    select: { user: { select: { id: true, email: true, name: true, role: true } } },
  });
  return session?.user ?? null;
}
