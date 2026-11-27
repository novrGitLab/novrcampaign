import { sessionUser } from '../services/staffSession.js';
import { Unauthorized, Forbidden } from '../utils/AppError.js';

export async function requireAuth(req, _res, next) {
  try {
    req.user = await sessionUser(req);
    if (!req.user) throw Unauthorized('Staff sign-in required');
    if (req.user.role === 'VIEWER' && !['GET','HEAD','OPTIONS'].includes(req.method)) throw Forbidden('Editing access required');
    return next();
  } catch (error) { return next(error); }
}
