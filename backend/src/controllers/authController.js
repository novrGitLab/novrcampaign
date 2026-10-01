import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import Joi from 'joi';
import { config } from '../config/env.js';
import { prisma } from '../utils/prisma.js';
import { Unauthorized } from '../utils/AppError.js';

// Single-team gate: accounts are seeded (npm run db:seed), never self-registered.
const EMAIL = Joi.string().email({ tlds: false });

const loginSchema = Joi.object({
  email: EMAIL.required(),
  password: Joi.string().required(),
});

function signToken(userId) {
  return jwt.sign({ sub: userId }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
}

export async function login(req, res) {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) throw Unauthorized('Invalid email or password');

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw Unauthorized('Invalid email or password');

  const safe = { id: user.id, email: user.email, name: user.name, role: user.role };
  return res.json({ user: safe, token: signToken(user.id) });
}

export async function me(req, res) {
  return res.json({ user: req.user, plunkConnected: Boolean(config.plunk.apiKey) });
}

export const schemas = { loginSchema };
