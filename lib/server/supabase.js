import { ApiError } from './lib.js';

function getConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new ApiError(
      500,
      'Supabase n\'est pas configuré. Renseignez SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans Vercel.'
    );
  }

  return { url: `${url}/rest/v1`, key };
}

async function supabaseRequest(path, { method = 'GET', query = null, body = null, headers = {} } = {}) {
  const { url, key } = getConfig();
  const requestUrl = new URL(`${url}/${path}`);

  if (query) {
    Object.entries(query).forEach(([name, value]) => {
      if (Array.isArray(value)) {
        value.forEach((entry) => {
          if (entry !== undefined && entry !== null) {
            requestUrl.searchParams.append(name, entry);
          }
        });
        return;
      }

      if (value !== undefined && value !== null) {
        requestUrl.searchParams.set(name, value);
      }
    });
  }

  const response = await fetch(requestUrl, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === null ? undefined : JSON.stringify(body),
  });

  const raw = await response.text();
  let data = null;

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  }

  if (!response.ok) {
    // Ne jamais exposer les détails internes (hint, schema, contraintes) au client
    const internalMessage = data?.message || data?.hint || raw || 'Erreur Supabase.';
    console.error('[SUPABASE] Erreur:', response.status, internalMessage, data?.details || '');
    const publicMessage = response.status === 409
      ? 'Cette opération est en conflit avec une entrée existante.'
      : response.status >= 500
        ? 'Erreur interne du serveur. Veuillez réessayer.'
        : 'Requête invalide.';
    const error = new ApiError(response.status, publicMessage);
    error.code = data?.code;
    throw error;
  }

  return data;
}

export function selectRows(table, { select = '*', filters = {}, limit = null, offset = null, order = null } = {}) {
  const query = { select, ...filters };
  if (limit !== null) query.limit = String(limit);
  if (offset !== null) query.offset = String(offset);
  if (order) query.order = order;
  return supabaseRequest(table, { query });
}

export async function countRows(table, { filters = {} } = {}) {
  const { url, key } = getConfig();
  const requestUrl = new URL(`${url}/${table}`);

  Object.entries({ select: '*', ...filters }).forEach(([name, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry !== undefined && entry !== null) {
          requestUrl.searchParams.append(name, entry);
        }
      });
      return;
    }

    if (value !== undefined && value !== null) {
      requestUrl.searchParams.set(name, value);
    }
  });

  const response = await fetch(requestUrl, {
    method: 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new ApiError(response.status, raw || 'Erreur Supabase.');
  }

  const contentRange = response.headers.get('content-range') || '*/0';
  const total = Number(contentRange.split('/')[1] || 0);
  return Number.isFinite(total) ? total : 0;
}

export async function insertRow(table, row) {
  const data = await supabaseRequest(table, {
    method: 'POST',
    body: row,
    headers: {
      Prefer: 'return=representation',
    },
  });

  if (Array.isArray(data)) {
    return data[0] || null;
  }

  return data;
}

export async function updateRows(table, patch, { filters = {}, select = '*' } = {}) {
  const data = await supabaseRequest(table, {
    method: 'PATCH',
    body: patch,
    query: {
      select,
      ...filters,
    },
    headers: {
      Prefer: 'return=representation',
    },
  });

  return Array.isArray(data) ? data : [data].filter(Boolean);
}

export async function deleteRows(table, { filters = {}, select = '*' } = {}) {
  const data = await supabaseRequest(table, {
    method: 'DELETE',
    query: {
      select,
      ...filters,
    },
    headers: {
      Prefer: 'return=representation',
    },
  });

  return Array.isArray(data) ? data : [data].filter(Boolean);
}
