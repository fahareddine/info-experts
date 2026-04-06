import { insertRow, selectRows, updateRows } from './supabase.js';

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email || null;
}

function normalizePhone(value) {
  const phone = String(value || '').trim();
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, '');
  return digits || null;
}

export function buildCustomerKey(email, phone) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);
  if (normalizedEmail) return `email:${normalizedEmail}`;
  if (normalizedPhone) return `phone:${normalizedPhone}`;
  return null;
}

export function isTestRecord(values = {}) {
  const haystack = [
    values.customerName,
    values.customerEmail,
    values.customerPhone,
    values.label,
    values.reference,
    values.notes,
    values.displayName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!haystack) return false;
  if (haystack.includes('@example.com')) return true;
  if (haystack.includes('noreply@example.com')) return true;
  if (haystack.includes('test')) return true;
  if (haystack.includes('demo')) return true;
  if (haystack.includes('dummy')) return true;
  return false;
}

async function findExistingProfile(customerKey, normalizedEmail, normalizedPhone) {
  // 1. Cherche par customer_key exact
  let rows = await selectRows('customer_profiles', {
    filters: { customer_key: `eq.${customerKey}` },
    limit: 1,
  });
  let found = Array.isArray(rows) ? rows[0] : null;
  if (found) return found;

  // 2. Cherche par email normalisé
  if (normalizedEmail) {
    rows = await selectRows('customer_profiles', {
      filters: { normalized_email: `eq.${normalizedEmail}` },
      limit: 1,
    });
    found = Array.isArray(rows) ? rows[0] : null;
    if (found) return found;
  }

  // 3. Cherche par téléphone normalisé
  if (normalizedPhone) {
    rows = await selectRows('customer_profiles', {
      filters: { normalized_phone: `eq.${normalizedPhone}` },
      limit: 1,
    });
    found = Array.isArray(rows) ? rows[0] : null;
    if (found) return found;
  }

  return null;
}

export async function touchCustomerProfile({
  customerName,
  customerEmail,
  customerPhone,
  kind,
  isTest = false,
}) {
  const customerKey = buildCustomerKey(customerEmail, customerPhone);
  if (!customerKey) return null;

  const normalizedEmail = normalizeEmail(customerEmail);
  const normalizedPhone = normalizePhone(customerPhone);

  const existing = await findExistingProfile(customerKey, normalizedEmail, normalizedPhone);
  const nowIso = new Date().toISOString();

  const patch = {
    display_name: customerName || existing?.display_name || 'Client Info Experts',
    email: normalizedEmail || existing?.email,
    phone: normalizedPhone || existing?.phone,
    normalized_email: normalizedEmail || existing?.normalized_email,
    normalized_phone: normalizedPhone || existing?.normalized_phone,
    is_test: Boolean(isTest || existing?.is_test),
    lifecycle_status: existing?.lifecycle_status || (isTest ? 'test' : 'lead'),
    tags: existing?.tags || [],
    notes: existing?.notes || null,
    orders_count: Number(existing?.orders_count || 0) + (kind === 'order' ? 1 : 0),
    appointments_count: Number(existing?.appointments_count || 0) + (kind === 'appointment' ? 1 : 0),
    payments_count: Number(existing?.payments_count || 0) + (kind === 'payment' ? 1 : 0),
    first_seen_at: existing?.first_seen_at || nowIso,
    last_seen_at: nowIso,
    last_order_at: kind === 'order' ? nowIso : existing?.last_order_at || null,
    last_appointment_at: kind === 'appointment' ? nowIso : existing?.last_appointment_at || null,
    last_payment_at: kind === 'payment' ? nowIso : existing?.last_payment_at || null,
  };

  if (existing) {
    // Utilise le customer_key RÉEL du profil trouvé (peut différer du customerKey dérivé)
    const updatedRows = await updateRows('customer_profiles', patch, {
      filters: { customer_key: `eq.${existing.customer_key}` },
    });
    return updatedRows[0] || null;
  }

  // Aucun profil trouvé — insertion avec gestion de la race condition
  try {
    return await insertRow('customer_profiles', {
      customer_key: customerKey,
      ...patch,
    });
  } catch (error) {
    if (error?.code === '23505') {
      // Race condition : un autre process vient de créer ce profil simultanément
      const retryExisting = await findExistingProfile(customerKey, normalizedEmail, normalizedPhone);
      if (retryExisting) {
        const updatedRows = await updateRows('customer_profiles', patch, {
          filters: { customer_key: `eq.${retryExisting.customer_key}` },
        });
        return updatedRows[0] || null;
      }
    }
    throw error;
  }
}
