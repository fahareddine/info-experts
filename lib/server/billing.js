/**
 * Billing business logic — Info Experts
 * Handles invoices, proformas and reminders.
 */

import { ApiError, assert, optionalString, optionalEmail, optionalPhone } from './lib.js';
import { selectRows, insertRow, updateRows, deleteRows } from './supabase.js';

// ── Doc number generation ─────────────────────────────────────────────────────

export function generateDocNumber(type) {
  const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = Date.now().toString(36).toUpperCase().slice(-5);
  const prefixes = { invoice: 'INV', proforma: 'PRO', reminder: 'REL' };
  const prefix = prefixes[type] || 'DOC';
  return `${prefix}-${yyyymmdd}-${suffix}`;
}

// ── Status helpers ─────────────────────────────────────────────────────────────

const VALID_STATUSES = {
  invoice:  ['draft', 'ready', 'sent', 'paid', 'partial', 'overdue', 'cancelled'],
  proforma: ['draft', 'sent', 'accepted', 'expired', 'converted'],
  reminder: ['draft', 'sent', 'paid', 'cancelled'],
};

const VALID_TYPES = ['invoice', 'proforma', 'reminder'];
const VALID_REMINDER_LEVELS = ['friendly', 'firm', 'final'];

// ── Totals computation ────────────────────────────────────────────────────────

function computeTotals({ items = [], discountKmf = 0, taxRate = 0 }) {
  const subtotal = items.reduce((acc, item) => {
    const qty = Number(item.quantity || 1);
    const price = Math.round(Number(item.unitPriceKmf || 0));
    return acc + Math.round(qty * price);
  }, 0);

  const discount = Math.round(Number(discountKmf || 0));
  const rate = Math.round(Number(taxRate || 0));
  const taxKmf = Math.round((subtotal - discount) * rate / 100);
  const total = subtotal - discount + taxKmf;

  return { subtotal_kmf: subtotal, discount_kmf: discount, tax_rate: rate, tax_kmf: taxKmf, total_kmf: Math.max(0, total) };
}

// ── Validate and build document row ──────────────────────────────────────────

function buildDocRow(data, isNew = true) {
  const docType = String(data.docType || data.doc_type || '').trim();
  assert(VALID_TYPES.includes(docType), `Type de document invalide. Valeurs : ${VALID_TYPES.join(', ')}.`);

  const statusList = VALID_STATUSES[docType];
  const status = String(data.status || 'draft').trim();
  assert(statusList.includes(status), `Statut invalide pour ce type. Valeurs : ${statusList.join(', ')}.`);

  const clientName = String(data.clientName || data.client_name || '').trim();
  assert(clientName, 'Le nom du client est requis.');

  const items = Array.isArray(data.items) ? data.items : [];
  const totals = computeTotals({ items, discountKmf: data.discountKmf, taxRate: data.taxRate });

  const reminderLevel = data.reminderLevel || data.reminder_level || null;
  if (reminderLevel) {
    assert(VALID_REMINDER_LEVELS.includes(reminderLevel), `Niveau de relance invalide. Valeurs : ${VALID_REMINDER_LEVELS.join(', ')}.`);
  }

  const row = {
    doc_type: docType,
    status,
    client_id: data.clientId || data.client_id || null,
    client_name: clientName,
    client_first_name: optionalString(data.clientFirstName || data.client_first_name),
    client_last_name: optionalString(data.clientLastName || data.client_last_name),
    client_email: optionalEmail(data.clientEmail || data.client_email),
    client_phone: optionalPhone(data.clientPhone || data.client_phone),
    client_address: optionalString(data.clientAddress || data.client_address),
    client_city: optionalString(data.clientCity || data.client_city),
    client_country: optionalString(data.clientCountry || data.client_country) || 'Comores',
    client_company: optionalString(data.clientCompany || data.client_company),
    issue_date: data.issueDate || data.issue_date || new Date().toISOString().slice(0, 10),
    due_date: data.dueDate || data.due_date || null,
    validity_date: data.validityDate || data.validity_date || null,
    payment_method: optionalString(data.paymentMethod || data.payment_method),
    payment_reference: optionalString(data.paymentReference || data.payment_reference),
    notes: optionalString(data.notes, 5000),
    message: optionalString(data.message, 5000),
    reminder_level: reminderLevel,
    linked_document_id: data.linkedDocumentId || data.linked_document_id || null,
    paid_kmf: Math.round(Number(data.paidKmf || data.paid_kmf || 0)),
    ...totals,
  };

  if (isNew) {
    row.doc_number = generateDocNumber(docType);
  }

  return { row, items };
}

// ── Document CRUD ─────────────────────────────────────────────────────────────

export async function listDocuments({ type = '', status = '', search = '', limit = 50, offset = 0 } = {}) {
  const filters = {};

  if (type) filters['doc_type'] = `eq.${type}`;
  if (status) filters['status'] = `eq.${status}`;

  const rows = await selectRows('billing_documents', {
    select: '*',
    filters,
    limit: Math.min(Number(limit) || 50, 500),
    offset: Number(offset) || 0,
    order: 'created_at.desc',
  });

  const docs = Array.isArray(rows) ? rows : [];

  // Client-side search filter (Supabase REST ilike requires specific syntax)
  if (search) {
    const q = search.toLowerCase();
    return docs.filter((d) =>
      (d.doc_number || '').toLowerCase().includes(q) ||
      (d.client_name || '').toLowerCase().includes(q) ||
      (d.client_email || '').toLowerCase().includes(q) ||
      (d.client_company || '').toLowerCase().includes(q)
    );
  }

  return docs;
}

export async function getDocument(id) {
  assert(id, 'ID de document requis.', 400);

  const docs = await selectRows('billing_documents', {
    filters: { id: `eq.${id}` },
    limit: 1,
  });

  const doc = Array.isArray(docs) ? docs[0] : null;
  if (!doc) throw new ApiError(404, 'Document introuvable.');

  const [items, logs] = await Promise.all([
    selectRows('billing_document_items', {
      filters: { document_id: `eq.${id}` },
      order: 'sort_order.asc',
    }),
    selectRows('billing_document_logs', {
      filters: { document_id: `eq.${id}` },
      order: 'created_at.desc',
    }),
  ]);

  return {
    ...doc,
    items: Array.isArray(items) ? items : [],
    logs: Array.isArray(logs) ? logs : [],
  };
}

export async function createDocument(data) {
  const { row, items } = buildDocRow(data, true);

  const doc = await insertRow('billing_documents', row);
  if (!doc?.id) throw new ApiError(500, 'Échec de la création du document.');

  // Insert items
  if (items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const qty = Number(item.quantity || 1);
      const price = Math.round(Number(item.unitPriceKmf || item.unit_price_kmf || 0));
      await insertRow('billing_document_items', {
        document_id: doc.id,
        sort_order: i,
        description: String(item.description || '').trim() || 'Prestation',
        details: optionalString(item.details),
        quantity: qty,
        unit_price_kmf: price,
        total_kmf: Math.round(qty * price),
      });
    }
  }

  await logDocumentAction(doc.id, 'created', `Document ${doc.doc_number} créé`);

  return doc;
}

export async function updateDocument(id, data) {
  assert(id, 'ID de document requis.', 400);

  const { row, items } = buildDocRow(data, false);

  const updated = await updateRows('billing_documents', row, {
    filters: { id: `eq.${id}` },
  });

  const doc = Array.isArray(updated) ? updated[0] : updated;
  if (!doc) throw new ApiError(404, 'Document introuvable.');

  // Replace all items
  await deleteRows('billing_document_items', { filters: { document_id: `eq.${id}` } });

  if (items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const qty = Number(item.quantity || 1);
      const price = Math.round(Number(item.unitPriceKmf || item.unit_price_kmf || 0));
      await insertRow('billing_document_items', {
        document_id: id,
        sort_order: i,
        description: String(item.description || '').trim() || 'Prestation',
        details: optionalString(item.details),
        quantity: qty,
        unit_price_kmf: price,
        total_kmf: Math.round(qty * price),
      });
    }
  }

  await logDocumentAction(id, 'updated', `Document mis à jour`);

  return doc;
}

export async function deleteDocument(id) {
  assert(id, 'ID de document requis.', 400);
  await deleteRows('billing_documents', { filters: { id: `eq.${id}` } });
}

export async function updateStatus(id, status) {
  assert(id, 'ID de document requis.', 400);
  assert(status, 'Statut requis.', 400);

  const docs = await selectRows('billing_documents', { filters: { id: `eq.${id}` }, limit: 1 });
  const doc = Array.isArray(docs) ? docs[0] : null;
  if (!doc) throw new ApiError(404, 'Document introuvable.');

  const statusList = VALID_STATUSES[doc.doc_type] || [];
  assert(statusList.includes(status), `Statut invalide pour ce type. Valeurs : ${statusList.join(', ')}.`);

  const updated = await updateRows('billing_documents', { status }, { filters: { id: `eq.${id}` } });
  await logDocumentAction(id, 'status_changed', `Statut changé en "${status}"`);

  return Array.isArray(updated) ? updated[0] : updated;
}

export async function convertToInvoice(proformaId) {
  assert(proformaId, 'ID du document pro forma requis.', 400);

  const proforma = await getDocument(proformaId);
  if (!proforma) throw new ApiError(404, 'Pro forma introuvable.');
  assert(proforma.doc_type === 'proforma', 'Le document source doit être de type pro forma.');

  // Build new invoice data from proforma
  const invoiceData = {
    docType: 'invoice',
    status: 'draft',
    clientId: proforma.client_id,
    clientName: proforma.client_name,
    clientFirstName: proforma.client_first_name,
    clientLastName: proforma.client_last_name,
    clientEmail: proforma.client_email,
    clientPhone: proforma.client_phone,
    clientAddress: proforma.client_address,
    clientCity: proforma.client_city,
    clientCountry: proforma.client_country,
    clientCompany: proforma.client_company,
    issueDate: new Date().toISOString().slice(0, 10),
    paymentMethod: proforma.payment_method,
    notes: proforma.notes,
    message: proforma.message,
    discountKmf: proforma.discount_kmf,
    taxRate: proforma.tax_rate,
    linkedDocumentId: proformaId,
    items: (proforma.items || []).map((item) => ({
      description: item.description,
      details: item.details,
      quantity: item.quantity,
      unitPriceKmf: item.unit_price_kmf,
    })),
  };

  const invoice = await createDocument(invoiceData);
  await logDocumentAction(proformaId, 'converted', `Converti en facture ${invoice.doc_number}`);
  await updateStatus(proformaId, 'converted');

  return invoice;
}

export async function logDocumentAction(documentId, action, detail = null) {
  try {
    await insertRow('billing_document_logs', {
      document_id: documentId,
      action,
      detail: detail || null,
    });
  } catch (err) {
    console.warn('[BILLING LOG]', err.message);
  }
}

// ── Clients CRUD ──────────────────────────────────────────────────────────────

export async function listClients({ search = '', limit = 100 } = {}) {
  const rows = await selectRows('billing_clients', {
    select: '*',
    limit: Math.min(Number(limit) || 100, 500),
    order: 'display_name.asc',
  });

  const clients = Array.isArray(rows) ? rows : [];

  if (search) {
    const q = search.toLowerCase();
    return clients.filter((c) =>
      (c.display_name || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.company || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q)
    );
  }

  return clients;
}

export async function getClient(id) {
  assert(id, 'ID client requis.', 400);
  const rows = await selectRows('billing_clients', { filters: { id: `eq.${id}` }, limit: 1 });
  const client = Array.isArray(rows) ? rows[0] : null;
  if (!client) throw new ApiError(404, 'Client introuvable.');
  return client;
}

export async function saveClient(data) {
  const displayName = String(data.displayName || data.display_name || '').trim();
  assert(displayName, 'Le nom affiché du client est requis.');

  const row = {
    display_name: displayName,
    first_name: optionalString(data.firstName || data.first_name),
    last_name: optionalString(data.lastName || data.last_name),
    email: optionalEmail(data.email),
    phone: optionalPhone(data.phone),
    address: optionalString(data.address),
    city: optionalString(data.city),
    country: optionalString(data.country) || 'Comores',
    company: optionalString(data.company),
    notes: optionalString(data.notes, 5000),
  };

  const id = data.id || null;

  if (id) {
    const updated = await updateRows('billing_clients', row, { filters: { id: `eq.${id}` } });
    const client = Array.isArray(updated) ? updated[0] : updated;
    if (!client) throw new ApiError(404, 'Client introuvable.');
    return client;
  }

  return insertRow('billing_clients', row);
}

export async function deleteClient(id) {
  assert(id, 'ID client requis.', 400);
  await deleteRows('billing_clients', { filters: { id: `eq.${id}` } });
}
