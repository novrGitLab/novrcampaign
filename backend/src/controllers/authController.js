import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config/env.js';
import { resolveStaffProfile } from '../services/staffProfile.js';
import { prisma } from '../utils/prisma.js';
import { cookieOptions, sessionName, digest, issueSession, opaqueToken } from '../services/staffSession.js';

const flowName = 'pulse_oidc';
const flowCookie = { ...cookieOptions, path: '/api/auth/oidc' };
const issuer = (process.env.OIDC_ISSUER_URL || 'https://accounts.zoho.com').replace(/\/$/, '');
const clientId = process.env.OIDC_CLIENT_ID;
const redirectUri = process.env.OIDC_REDIRECT_URI;
let provider;

async function discover() {
  if (provider && provider.expires > Date.now()) return provider;
  const discovery = await fetch(issuer + '/.well-known/openid-configuration', {
    signal: AbortSignal.timeout(8000),
  });
  if (!discovery.ok) throw new Error('Discovery unavailable');
  const doc = await discovery.json();
  if (
    new URL(doc.issuer.includes('://') ? doc.issuer : 'https://' + doc.issuer).origin !==
    new URL(issuer).origin
  )
    throw new Error('Unexpected issuer');
  const endpoints = [doc.authorization_endpoint, doc.token_endpoint, doc.jwks_uri];
  if (config.isProd && endpoints.some((url) => new URL(url).protocol !== 'https:'))
    throw new Error('HTTPS required');
  provider = { ...doc, keys: createRemoteJWKSet(new URL(doc.jwks_uri)), expires: Date.now() + 3600000 };
  return provider;
}

export async function start(_req, res) {
  if (!clientId || !redirectUri || !process.env.OIDC_CLIENT_SECRET)
    return res.redirect('/login?sso=unavailable');
  try {
    const doc = await discover();
    const state = opaqueToken(),
      nonce = opaqueToken(),
      verifier = opaqueToken();
    const flow = jwt.sign({ state, nonce, verifier }, config.jwt.secret, {
      audience: flowName,
      expiresIn: '10m',
    });
    res.cookie(flowName, flow, { ...flowCookie, maxAge: 600000 });
    const url = new URL(doc.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    });
    return res.redirect(url.href);
  } catch {
    return res.redirect('/login?sso=unavailable');
  }
}

export async function callback(req, res) {
  res.clearCookie(flowName, flowCookie);
  try {
    const flow = jwt.verify(req.cookies[flowName], config.jwt.secret, {
      audience: flowName,
      algorithms: ['HS256'],
    });
    if (req.query.state !== flow.state || typeof req.query.code !== 'string')
      throw new Error('Invalid callback');
    const doc = await discover();
    const token = await fetch(doc.token_endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: req.query.code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: process.env.OIDC_CLIENT_SECRET,
        code_verifier: flow.verifier,
      }),
    });
    if (!token.ok) throw new Error('Exchange failed');
    const { id_token: idToken } = await token.json();
    const { payload } = await jwtVerify(idToken, doc.keys, {
      issuer: doc.issuer,
      audience: clientId,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'sub', 'nonce'],
    });
    if (
      (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId) ||
      payload.nonce !== flow.nonce ||
      (payload.azp && payload.azp !== clientId) ||
      payload.email_verified !== true
    )
      throw new Error('Identity unverified');
    const user = await resolveStaffProfile(issuer, payload);
    await issueSession(res, user.id);
    return res.redirect('/pulse');
  } catch {
    return res.redirect('/login?sso=failed');
  }
}

export async function logout(req, res) {
  const token = req.cookies[sessionName];
  if (token) await prisma.staffSession.deleteMany({ where: { hash: digest(token) } });
  res.clearCookie(sessionName, cookieOptions);
  return res.sendStatus(204);
}

export function me(req, res) {
  return res.json({ user: req.user, plunkConnected: Boolean(config.plunk.apiKey) });
}
