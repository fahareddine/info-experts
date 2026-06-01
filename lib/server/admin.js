import { createHmac, timingSafeEqual } from 'node:crypto';

import { ApiError } from './lib.js';

const SESSION_COOKIE = 'ie_admin_session';
const SESSION_TTL_SECONDS = 60 * 60 * 8;

function getViewerPassword() {
  const password = process.env.ADMIN_VIEWER_PASSWORD;
  if (!password) return null;
  if (password.length < 12) {
    throw new ApiError(500, 'ADMIN_VIEWER_PASSWORD doit contenir au moins 12 caractères.');
  }
  return password;
}

function getSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new ApiError(500, 'ADMIN_SESSION_SECRET n\'est pas configuré.');
  }
  return secret;
}

function getAdminPassword() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new ApiError(500, 'ADMIN_PASSWORD n\'est pas configuré.');
  }
  if (password.length < 12) {
    throw new ApiError(500, 'ADMIN_PASSWORD doit contenir au moins 12 caractères.');
  }
  return password;
}

function base64urlEncode(input) {
  return Buffer.from(input).toString('base64url');
}

function base64urlDecode(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function parseCookies(headerValue = '') {
  return headerValue.split(';').reduce((acc, chunk) => {
    const [rawName, ...rest] = chunk.trim().split('=');
    if (!rawName) return acc;
    acc[rawName] = rest.join('=');
    return acc;
  }, {});
}

function secureCookie(req) {
  return process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';
}

function cookieParts(value, req, maxAge = SESSION_TTL_SECONDS) {
  return [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
    secureCookie(req) ? 'Secure' : '',
  ].filter(Boolean);
}

function buildSessionToken(role = 'manager') {
  const payload = {
    role,
    exp: Date.now() + SESSION_TTL_SECONDS * 1000,
  };

  const encoded = base64urlEncode(JSON.stringify(payload));
  const signature = sign(encoded, getSecret());
  return `${encoded}.${signature}`;
}

function verifySessionToken(token) {
  if (!token || !token.includes('.')) return null;
  const [encoded, providedSignature] = token.split('.');
  if (!encoded || !providedSignature) return null;

  const expectedSignature = sign(encoded, getSecret());
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (providedBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(providedBuffer, expectedBuffer)) return null;

  try {
    const payload = JSON.parse(base64urlDecode(encoded));
    if (payload.exp <= Date.now()) return null;
    if (!['manager', 'viewer'].includes(payload.role)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function setAdminSession(res, req, role = 'manager') {
  const token = buildSessionToken(role);
  res.setHeader('Set-Cookie', cookieParts(token, req).join('; '));
}

export function clearAdminSession(res, req) {
  res.setHeader('Set-Cookie', cookieParts('', req, 0).join('; '));
}

export function requireAdmin(req, allowedRoles = ['manager', 'viewer']) {
  const cookies = parseCookies(req.headers.cookie || '');
  const payload = verifySessionToken(cookies[SESSION_COOKIE]);
  if (!payload) {
    throw new ApiError(401, 'Authentification administrateur requise.');
  }
  if (!allowedRoles.includes(payload.role)) {
    throw new ApiError(403, 'Droits insuffisants pour cette action.');
  }
  return payload;
}

export function resolveAdminRole(password) {
  const provided = Buffer.from(String(password ?? ''));

  const manager = Buffer.from(getAdminPassword());
  if (provided.length === manager.length && timingSafeEqual(provided, manager)) {
    return 'manager';
  }

  const viewerPassword = getViewerPassword();
  if (viewerPassword) {
    const viewer = Buffer.from(viewerPassword);
    if (provided.length === viewer.length && timingSafeEqual(provided, viewer)) {
      return 'viewer';
    }
  }

  throw new ApiError(401, 'Mot de passe administrateur invalide.');
}
