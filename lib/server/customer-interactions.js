import { insertRow, selectRows } from './supabase.js';

async function resolveCustomerKey(customerKey) {
  if (!customerKey) return null;

  // Cherche d'abord par customer_key exact
  const directRows = await selectRows('customer_profiles', {
    filters: { customer_key: `eq.${customerKey}` },
    limit: 1,
  });
  const direct = Array.isArray(directRows) ? directRows[0] : null;
  if (direct) return direct.customer_key;

  // Fallback : le profil existe peut-être sous une autre clé (email vs phone)
  const [type, value] = String(customerKey).split(':');
  if (!type || !value) return null;

  const filterField = type === 'email' ? 'normalized_email' : 'normalized_phone';
  const fallbackRows = await selectRows('customer_profiles', {
    filters: { [filterField]: `eq.${value}` },
    limit: 1,
  });
  const fallback = Array.isArray(fallbackRows) ? fallbackRows[0] : null;
  if (fallback) return fallback.customer_key;

  console.warn('[INTERACTION] Profil client introuvable pour la clé:', customerKey);
  return null;
}

export async function createCustomerInteraction({
  customerKey,
  channel = 'admin',
  direction = 'internal',
  summary,
  content = null,
  relatedEntityType = null,
  relatedEntityReference = null,
  createdByRole = 'system',
  isTest = false,
}) {
  if (!customerKey || !summary) return null;

  const actualKey = await resolveCustomerKey(customerKey);
  if (!actualKey) return null;

  return insertRow('customer_interactions', {
    customer_key: actualKey,
    channel,
    direction,
    summary,
    content,
    related_entity_type: relatedEntityType,
    related_entity_reference: relatedEntityReference,
    created_by_role: createdByRole,
    is_test: Boolean(isTest),
  });
}

export function listCustomerInteractions(customerKey, limit = 100) {
  return selectRows('customer_interactions', {
    filters: { customer_key: `eq.${customerKey}` },
    order: 'created_at.desc',
    limit,
  });
}
