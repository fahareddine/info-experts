/**
 * Rate limiting simple via Supabase — max LIMIT requêtes par IP par heure
 */

import { createHash } from 'crypto';
import { countRows, insertRow } from './supabase.js';
import { ApiError } from './lib.js';

const WINDOW_SECONDS = 3600;
const LIMIT = 20;

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.headers['x-real-ip'] || 'unknown';
}

function hashIp(ip) {
  // Nécessite RATE_LIMIT_SECRET (ou ADMIN_SESSION_SECRET en fallback).
  // Sans secret configuré, on ne hache pas l'IP (pas de fausse sécurité).
  const salt = process.env.RATE_LIMIT_SECRET || process.env.ADMIN_SESSION_SECRET;
  if (!salt) return createHash('sha256').update(ip).digest('hex').slice(0, 20);
  return createHash('sha256').update(ip + salt).digest('hex').slice(0, 20);
}

export async function checkRateLimit(req, endpoint) {
  const ip = getClientIp(req);
  const ipHash = hashIp(ip);
  const windowStart = new Date(Date.now() - WINDOW_SECONDS * 1000).toISOString();

  try {
    const count = await countRows('rate_limit_requests', {
      filters: {
        ip_hash: `eq.${ipHash}`,
        endpoint: `eq.${endpoint}`,
        created_at: `gte.${windowStart}`,
      },
    });

    if (count >= LIMIT) {
      throw new ApiError(429, 'Trop de requêtes. Merci de patienter avant de réessayer.');
    }

    insertRow('rate_limit_requests', { ip_hash: ipHash, endpoint }).catch(() => {});
  } catch (error) {
    // Ne bloquer la requête que si c'est bien un dépassement de limite (429)
    // Toute autre erreur (table manquante, Supabase indispo...) = dégradation silencieuse
    if (error instanceof ApiError && error.status === 429) throw error;
    console.warn('[RATE LIMIT] Vérification impossible:', error.message);
  }
}
