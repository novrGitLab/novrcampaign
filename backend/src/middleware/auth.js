import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { prisma } from '../utils/prisma.js';
import { Unauthorized } from '../utils/AppError.js';

/**
 * Verify the Bearer token and attach the user to the request.
 */
export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw Unauthorized('Missing authorization token');

    const token = header.slice('Bearer '.length).trim();
    const payload = jwt.verify(token, config.jwt.secret);

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, role: true },
    });

    if (!user) throw Unauthorized('User no longer exists');

    req.user = user;
    return next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return next(Unauthorized(err.message === 'jwt expired' ? 'Token expired' : 'Invalid token'));
    }
    return next(err);
  }
}


