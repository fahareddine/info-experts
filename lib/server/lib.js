import { randomBytes } from 'crypto';

export class ApiError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export const PHONE_RE = /^[+\d\s().-]{6,20}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const BOUTIQUE_OPERATORS = ['Huri Money', 'MVola'];
export const STANDALONE_PAYMENT_OPERATORS = ['Huri', 'MVola', 'Telma'];

const ALLOWED_ORIGINS = [
  'https://info-experts.fr',
  'https://www.info-experts.fr',
];

export function applyCors(req, res) {
  const origin = req.headers.origin || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }

  return false;
}

export function assert(condition, message, status = 400, details = null) {
  if (!condition) {
    throw new ApiError(status, message, details);
  }
}

export function requiredString(value, fieldName, maxLength = 250) {
  const normalized = String(value ?? '').trim();
  assert(normalized, `Le champ "${fieldName}" est requis.`);
  assert(normalized.length <= maxLength, `Le champ "${fieldName}" est trop long.`);
  return normalized;
}

export function optionalString(value, maxLength = 5000) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  assert(normalized.length <= maxLength, 'Un champ texte dépasse la longueur maximale autorisée.');
  return normalized;
}

export function optionalEmail(value, required = false) {
  const normalized = optionalString(value, 320);
  if (!normalized) {
    if (required) {
      throw new ApiError(400, 'Le champ "email" est requis.');
    }
    return null;
  }
  assert(EMAIL_RE.test(normalized), 'Adresse email invalide.');
  return normalized.toLowerCase();
}

export function optionalPhone(value, required = false) {
  const normalized = optionalString(value, 30);
  if (!normalized) {
    if (required) {
      throw new ApiError(400, 'Le champ "telephone" est requis.');
    }
    return null;
  }
  assert(PHONE_RE.test(normalized), 'Numéro de téléphone invalide.');
  return normalized;
}

export function integerAmount(value, fieldName = 'montant') {
  const normalized = Number(value ?? 0);
  assert(Number.isFinite(normalized), `Le champ "${fieldName}" doit être un nombre.`);
  assert(normalized >= 0, `Le champ "${fieldName}" ne peut pas être négatif.`);
  return Math.round(normalized);
}

export function assertOneOf(value, allowedValues, fieldName) {
  assert(allowedValues.includes(value), `${fieldName} invalide. Valeurs acceptées : ${allowedValues.join(', ')}.`);
  return value;
}

export function generateReference(prefix) {
  const timestamp = Date.now().toString(36).toUpperCase();
  // randomBytes synchrone — cryptographiquement sûr contrairement à Math.random()
  const random = randomBytes(4).toString('hex').toUpperCase().slice(0, 5);
  return `${prefix}-${timestamp}-${random}`;
}

export function splitFullName(fullName) {
  const normalized = requiredString(fullName, 'nom', 160);
  const parts = normalized.split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || normalized,
    lastName: parts.slice(1).join(' ') || null,
    fullName: normalized,
  };
}

export function normalizeTimeInput(value) {
  const raw = requiredString(value, 'appointmentTime', 20)
    .replace(/\s+/g, '')
    .replace('H', 'h');

  const match = raw.match(/^(\d{1,2})(?:h|:)(\d{2})(?::(\d{2}))?$/);
  assert(match, 'Heure de rendez-vous invalide.');

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);

  assert(hours >= 0 && hours <= 23, 'Heure de rendez-vous invalide.');
  assert(minutes >= 0 && minutes <= 59, 'Heure de rendez-vous invalide.');
  assert(seconds >= 0 && seconds <= 59, 'Heure de rendez-vous invalide.');

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function normalizeDateInput(value) {
  const raw = requiredString(value, 'appointmentDate', 20);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(raw), 'Date de rendez-vous invalide.');
  return raw;
}

export function durationToMinutes(value) {
  if (typeof value === 'number') {
    assert(Number.isFinite(value) && value > 0, 'Durée de service invalide.');
    return Math.round(value);
  }

  const raw = requiredString(value, 'serviceDuration', 60).toLowerCase();
  const number = parseInt(raw, 10);
  assert(Number.isFinite(number) && number > 0, 'Durée de service invalide.');
  return raw.includes('min') ? number : number * 60;
}

export function formatDateLabel(dateValue) {
  try {
    return new Date(`${dateValue}T12:00:00Z`).toLocaleDateString('fr-FR', {
      dateStyle: 'full',
      timeZone: 'UTC',
    });
  } catch {
    return dateValue;
  }
}

export function formatAppointmentLabel(dateValue, timeValue, timezone = 'Indian/Comoro') {
  if (!dateValue || !timeValue) return 'non précisé';
  const hhmm = String(timeValue).slice(0, 5).replace(':', 'h');
  return `${formatDateLabel(dateValue)} à ${hhmm} (${timezone})`;
}

export function sendError(res, error) {
  if (error instanceof ApiError) {
    return res.status(error.status).json({ success: false, error: error.message, details: error.details || undefined });
  }

  console.error('[API] Erreur inattendue:', error);
  return res.status(500).json({ success: false, error: 'Erreur interne du serveur.' });
}
