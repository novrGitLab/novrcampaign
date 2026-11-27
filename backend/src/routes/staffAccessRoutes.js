import { Router } from 'express';
import jwt from 'jsonwebtoken';
import Joi from 'joi';
import { config } from '../config/env.js';
import { prisma } from '../utils/prisma.js';
import { cookieOptions } from '../services/staffSession.js';
import { submitStaffRequest, decideStaffRequest, requestFields } from '../services/staffProfile.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { BadRequest, Forbidden, Unauthorized } from '../utils/AppError.js';
import { authLimiter } from '../middleware/rateLimiter.js';

const cookie = 'pulse_access_request';
const options = { ...cookieOptions, path: '/api/auth/access' };
export function setRequestCookie(res, id) {
  res.cookie(cookie, jwt.sign({ sub: id }, config.jwt.secret, { audience: cookie, expiresIn: '30m' }), {
    ...options,
    maxAge: 1800000,
  });
}
export function clearRequestCookie(res) {
  res.clearCookie(cookie, options);
}
export const applicantRoutes = Router();
applicantRoutes.use(authLimiter, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    req.requestId = jwt.verify(req.cookies[cookie], config.jwt.secret, {
      algorithms: ['HS256'],
      audience: cookie,
    }).sub;
  } catch {
    return next(Unauthorized('Sign in with Zoho to request access'));
  }
  return next();
});
applicantRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    const request = await prisma.staffAccessRequest.findUnique({
      where: { id: req.requestId },
      select: requestFields,
    });
    if (!request) throw Unauthorized('Sign in with Zoho to request access');
    return res.json(request);
  }),
);
applicantRoutes.post(
  '/',
  asyncHandler(async (req, res) => res.json(await submitStaffRequest(req.requestId))),
);

export const reviewRoutes = Router();
reviewRoutes.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  return req.user.role === 'ADMIN' ? next() : next(Forbidden('Administrator access required'));
});
reviewRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    const { value, error } = Joi.object({
      status: Joi.string().valid('PENDING', 'APPROVED', 'DECLINED').default('PENDING'),
      page: Joi.number().integer().min(1).max(100000).default(1),
    }).validate(req.query);
    if (error) throw BadRequest('Invalid request filter');
    const where = { status: value.status };
    const [items, total] = await prisma.$transaction([
      prisma.staffAccessRequest.findMany({
        where,
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        skip: (value.page - 1) * 20,
        take: 20,
        select: requestFields,
      }),
      prisma.staffAccessRequest.count({ where }),
    ]);
    return res.json({ items, total, page: value.page, pages: Math.ceil(total / 20) });
  }),
);
reviewRoutes.post(
  '/:id/decision',
  asyncHandler(async (req, res) => {
    const { value, error } = Joi.object({
      action: Joi.string().valid('approve', 'decline').required(),
      role: Joi.when('action', {
        is: 'approve',
        then: Joi.string().valid('ADMIN', 'SENDER', 'VIEWER').required(),
        otherwise: Joi.forbidden(),
      }),
    })
      .required()
      .validate(req.body);
    if (error || Joi.string().uuid().validate(req.params.id).error)
      throw BadRequest('Invalid access decision');
    return res.json(await decideStaffRequest(req.params.id, req.user, value.action, value.role));
  }),
);
