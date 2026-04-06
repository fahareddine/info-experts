import { clearAdminSession, requireAdmin, resolveAdminRole, setAdminSession } from './admin.js';
import { logAdminEvent } from './admin-events.js';
import { buildRecordFilters, clampLimit, getEntityConfig } from './admin-records.js';
import { buildCustomerKey, isTestRecord } from './customers.js';
import { createCustomerInteraction, listCustomerInteractions } from './customer-interactions.js';
import {
  sendAppointmentStatusEmail,
  sendInvoiceEmail,
  sendOrderStatusEmail,
  sendPaymentReminderEmail,
  sendPaymentReviewEmail,
} from './email.js';
import { buildInvoiceNumber, generateInvoicePdf } from './invoice.js';
import {
  sendAppointmentStatusSms,
  sendOrderStatusSms,
  sendPaymentReminderSms,
  sendPaymentReviewSms,
} from './sms.js';
import { ApiError, assertOneOf, optionalString, requiredString } from './lib.js';
import { checkRateLimit } from './rate-limit.js';
import { countRows, deleteRows, selectRows, updateRows } from './supabase.js';

const PAGE_SIZE = 1000;

const DETAIL_CONFIG = {
  customers: {
    table: 'customer_profiles',
    linkedFilterField: null,
    eventType: 'customer',
  },
  appointments: {
    table: 'appointments',
    linkedFilterField: 'appointment_id',
    eventType: 'appointment',
  },
  orders: {
    table: 'orders',
    linkedFilterField: 'order_id',
    eventType: 'order',
  },
  payments: {
    table: 'payments',
    linkedFilterField: null,
    eventType: 'payment',
  },
};

const PAYMENT_STATUS_BY_ACTION = {
  validate: 'validated',
  reject: 'failed',
};

const PAYMENT_ACTIONS = {
  validate: { targetStatus: 'validated', allowedStatuses: ['pending_review'] },
  reject:   { targetStatus: 'failed',    allowedStatuses: ['pending_review'] },
  remind:   { targetStatus: null,        allowedStatuses: ['pending_review'] },
};

const LINKED_STATUS_BY_ACTION = {
  validate: {
    orders: 'validated',
    appointments: 'confirmed',
  },
  reject: {
    orders: 'rejected',
    appointments: 'rejected',
  },
};

const APPOINTMENT_ACTIONS = {
  confirm: { targetStatus: 'confirmed', allowedStatuses: ['payment_submitted', 'cash_reserved', 'confirmed'] },
  cancel: { targetStatus: 'cancelled', allowedStatuses: ['payment_submitted', 'cash_reserved', 'confirmed'] },
  complete: { targetStatus: 'completed', allowedStatuses: ['confirmed'] },
};

const ORDER_ACTIONS = {
  validate: { targetStatus: 'validated', allowedStatuses: ['payment_submitted', 'cash_reserved', 'validated'] },
  cancel: { targetStatus: 'cancelled', allowedStatuses: ['payment_submitted', 'cash_reserved', 'validated'] },
  fulfill: { targetStatus: 'fulfilled', allowedStatuses: ['validated', 'cash_reserved'] },
};

const TIMELINE_EVENT_TYPES = {
  customers: 'customer',
  appointments: 'appointment',
  orders: 'order',
  payments: 'payment',
};

const EXPORT_COLUMNS = {
  customers: [
    ['customer_key', 'customer_key'], ['display_name', 'display_name'], ['email', 'email'], ['phone', 'phone'],
    ['lifecycle_status', 'lifecycle_status'], ['is_test', 'is_test'], ['orders_count', 'orders_count'],
    ['appointments_count', 'appointments_count'], ['payments_count', 'payments_count'], ['last_seen_at', 'last_seen_at'],
    ['notes', 'notes'],
  ],
  appointments: [
    ['reference', 'reference'], ['status', 'status'], ['payment_type', 'payment_type'], ['service_name', 'service_name'],
    ['service_price_kmf', 'service_price_kmf'], ['deposit_amount_kmf', 'deposit_amount_kmf'], ['appointment_date', 'appointment_date'],
    ['appointment_time', 'appointment_time'], ['appointment_timezone', 'appointment_timezone'], ['technician_name', 'technician_name'],
    ['location', 'location'], ['customer_full_name', 'customer_full_name'], ['customer_email', 'customer_email'],
    ['customer_phone', 'customer_phone'], ['notes', 'notes'], ['created_at', 'created_at'], ['updated_at', 'updated_at'],
  ],
  orders: [
    ['reference', 'reference'], ['status', 'status'], ['payment_type', 'payment_type'], ['product_name', 'product_name'],
    ['amount_kmf', 'amount_kmf'], ['customer_full_name', 'customer_full_name'], ['customer_email', 'customer_email'],
    ['customer_phone', 'customer_phone'], ['payment_operator', 'payment_operator'], ['payment_reference', 'payment_reference'],
    ['is_test', 'is_test'], ['created_at', 'created_at'], ['updated_at', 'updated_at'],
  ],
  payments: [
    ['reference', 'reference'], ['source', 'source'], ['status', 'status'], ['payment_type', 'payment_type'], ['label', 'label'],
    ['amount_kmf', 'amount_kmf'], ['customer_full_name', 'customer_full_name'], ['customer_email', 'customer_email'],
    ['customer_phone', 'customer_phone'], ['operator', 'operator'], ['client_reference', 'client_reference'],
    ['is_test', 'is_test'], ['created_at', 'created_at'], ['updated_at', 'updated_at'],
  ],
};

function mapAppointment(row) {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    paymentType: row.payment_type,
    serviceName: row.service_name,
    servicePriceKmf: row.service_price_kmf,
    depositAmountKmf: row.deposit_amount_kmf,
    appointmentDate: row.appointment_date,
    appointmentTime: row.appointment_time,
    appointmentTimezone: row.appointment_timezone,
    technicianName: row.technician_name,
    location: row.location,
    customerName: row.customer_full_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    notes: row.notes,
    isTest: row.is_test,
    createdAt: row.created_at,
  };
}

function mapCustomer(row) {
  return {
    customerKey: row.customer_key,
    displayName: row.display_name,
    email: row.email,
    phone: row.phone,
    lifecycleStatus: row.lifecycle_status,
    isTest: row.is_test,
    ordersCount: row.orders_count,
    appointmentsCount: row.appointments_count,
    paymentsCount: row.payments_count,
    lastSeenAt: row.last_seen_at,
    notes: row.notes,
    tags: row.tags || [],
  };
}

function mapCustomerInteraction(row) {
  return {
    id: row.id,
    customerKey: row.customer_key,
    channel: row.channel,
    direction: row.direction,
    summary: row.summary,
    content: row.content,
    relatedEntityType: row.related_entity_type,
    relatedEntityReference: row.related_entity_reference,
    createdByRole: row.created_by_role,
    isTest: row.is_test,
    createdAt: row.created_at,
  };
}

function mapOrder(row) {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    paymentType: row.payment_type,
    productName: row.product_name,
    amountKmf: row.amount_kmf,
    customerName: row.customer_full_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    operator: row.payment_operator,
    paymentReference: row.payment_reference,
    isTest: row.is_test,
    createdAt: row.created_at,
  };
}

function mapPayment(row) {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    source: row.source,
    paymentType: row.payment_type,
    orderId: row.order_id,
    appointmentId: row.appointment_id,
    label: row.label,
    amountKmf: row.amount_kmf,
    customerName: row.customer_full_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    operator: row.operator,
    clientReference: row.client_reference,
    appointmentReference: row.metadata?.appointment_reference || null,
    orderReference: row.metadata?.order_reference || null,
    isTest: row.is_test,
    createdAt: row.created_at,
  };
}

async function fetchAllRows(table, { select = '*', filters = {}, order = 'created_at.desc' } = {}) {
  let offset = 0;
  const rows = [];

  while (true) {
    const batch = await selectRows(table, {
      select,
      filters,
      order,
      limit: PAGE_SIZE,
      offset,
    });

    const normalized = Array.isArray(batch) ? batch : [];
    if (!normalized.length) break;
    rows.push(...normalized);
    if (normalized.length < PAGE_SIZE) break;
    offset += normalized.length;
  }

  return rows;
}

function incrementCount(map, label) {
  const key = label || 'Non renseigné';
  map.set(key, (map.get(key) || 0) + 1);
}

function topEntries(map, limit = 5) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function todayInComoros() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Indian/Comoro',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function isoDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
}

function resolvePeriod(query) {
  const period = String(query?.period || '30d').trim();
  const now = new Date();

  if (period === 'custom') {
    const dateFrom = isoDay(query?.dateFrom);
    const dateTo = isoDay(query?.dateTo);
    if (!dateFrom || !dateTo) {
      throw new ApiError(400, 'dateFrom et dateTo sont requis pour la période custom.');
    }
    return { period, dateFrom, dateTo };
  }

  const dateTo = now.toISOString().slice(0, 10);
  let days = 30;
  if (period === 'today') days = 0;
  else if (period === '7d') days = 6;
  else if (period === '90d') days = 89;
  else if (period !== '30d') throw new ApiError(400, 'Période invalide. Valeurs acceptées : today, 7d, 30d, 90d, custom.');

  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - days);

  return { period, dateFrom: start.toISOString().slice(0, 10), dateTo };
}

function createdAtRangeFilters(dateFrom, dateTo) {
  return [`gte.${dateFrom}T00:00:00.000Z`, `lte.${dateTo}T23:59:59.999Z`];
}

async function sumValidatedPayments(filters) {
  let offset = 0;
  let total = 0;

  while (true) {
    const rows = await selectRows('payments', {
      select: 'amount_kmf',
      filters,
      limit: PAGE_SIZE,
      offset,
      order: 'created_at.desc',
    });

    const batch = Array.isArray(rows) ? rows : [];
    if (!batch.length) break;

    total += batch.reduce((sum, row) => sum + Number(row.amount_kmf || 0), 0);
    if (batch.length < PAGE_SIZE) break;
    offset += batch.length;
  }

  return total;
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n;]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(entity, rows) {
  const columns = EXPORT_COLUMNS[entity];
  const header = columns.map(([name]) => csvEscape(name)).join(';');
  const lines = rows.map((row) => columns.map(([, key]) => csvEscape(row[key])).join(';'));
  return '\uFEFF' + [header].concat(lines).join('\n');
}

function exportFilename(entity) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `info-experts-${entity}-${stamp}.csv`;
}

function timelineCsv(rows) {
  const columns = ['created_at', 'actor_label', 'action', 'from_status', 'to_status', 'note'];
  const header = columns.map(csvEscape).join(';');
  const lines = rows.map((row) => columns.map((column) => csvEscape(row[column])).join(';'));
  return '\uFEFF' + [header].concat(lines).join('\n');
}

function timelineFilename(entity, reference) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `info-experts-timeline-${entity}-${reference}-${stamp}.csv`;
}

async function handleLogin(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée. Utilisez POST.' });
  }

  // Limite : 10 tentatives de connexion par IP par heure
  await checkRateLimit(req, 'admin-login');
  // Délai fixe pour ralentir le brute-force même en cas de bon mot de passe
  await new Promise((r) => setTimeout(r, 300));

  const password = requiredString(req.body?.password, 'password', 200);
  const role = resolveAdminRole(password);
  setAdminSession(res, req, role);
  return res.status(200).json({ success: true, authenticated: true, role });
}

async function handleLogout(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée. Utilisez POST.' });
  }

  try {
    requireAdmin(req);
  } finally {
    clearAdminSession(res, req);
  }

  return res.status(200).json({ success: true });
}

async function handleSession(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée. Utilisez GET.' });
  }

  const session = requireAdmin(req);
  return res.status(200).json({ success: true, authenticated: true, role: session.role });
}

async function handleDashboard(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée. Utilisez GET.' });
  }

  const session = requireAdmin(req);
  const period = resolvePeriod(req.query);
  const today = todayInComoros();
  const overdueCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const createdRange = createdAtRangeFilters(period.dateFrom, period.dateTo);

  const [
    customersTotal,
    testCustomers,
    appointmentsTotal,
    ordersTotal,
    paymentsTotal,
    pendingPayments,
    revenueValidatedKmf,
    overduePendingPayments,
    todayAppointments,
    testAppointments,
    testOrders,
    testPayments,
    periodAppointments,
    periodOrders,
    periodPayments,
    recentCustomers,
    recentAppointments,
    recentOrders,
    recentPayments,
    pendingReminderRows,
  ] = await Promise.all([
    countRows('customer_profiles'),
    countRows('customer_profiles', { filters: { is_test: 'eq.true' } }),
    countRows('appointments', { filters: { created_at: createdRange, is_test: 'eq.false' } }),
    countRows('orders', { filters: { created_at: createdRange, is_test: 'eq.false' } }),
    countRows('payments', { filters: { created_at: createdRange, is_test: 'eq.false' } }),
    countRows('payments', { filters: { status: 'eq.pending_review', created_at: createdRange, is_test: 'eq.false' } }),
    sumValidatedPayments({ status: 'eq.validated', created_at: createdRange, is_test: 'eq.false' }),
    countRows('payments', { filters: { status: 'eq.pending_review', created_at: [`gte.${period.dateFrom}T00:00:00.000Z`, `lte.${overdueCutoff}`], is_test: 'eq.false' } }),
    countRows('appointments', { filters: { appointment_date: `eq.${today}`, status: 'not.in.(cancelled,rejected)', is_test: 'eq.false' } }),
    countRows('appointments', { filters: { is_test: 'eq.true' } }),
    countRows('orders', { filters: { is_test: 'eq.true' } }),
    countRows('payments', { filters: { is_test: 'eq.true' } }),
    fetchAllRows('appointments', { select: 'service_name,status,is_test', filters: { created_at: createdRange, is_test: 'eq.false' }, order: 'created_at.desc' }),
    fetchAllRows('orders', { select: 'product_name,amount_kmf,status,is_test', filters: { created_at: createdRange, is_test: 'eq.false' }, order: 'created_at.desc' }),
    fetchAllRows('payments', { select: 'source,status,amount_kmf,is_test', filters: { created_at: createdRange, is_test: 'eq.false' }, order: 'created_at.desc' }),
    selectRows('customer_profiles', { order: 'last_seen_at.desc', limit: 10 }),
    selectRows('appointments', { order: 'created_at.desc', limit: 10 }),
    selectRows('orders', { order: 'created_at.desc', limit: 10 }),
    selectRows('payments', { order: 'created_at.desc', limit: 10 }),
    selectRows('payments', { filters: { status: 'eq.pending_review', is_test: 'eq.false' }, order: 'created_at.asc', limit: 10 }),
  ]);

  const topServicesMap = new Map();
  const topProductsMap = new Map();
  const paymentSourcesMap = new Map();

  (periodAppointments || []).forEach((row) => incrementCount(topServicesMap, row.service_name));
  (periodOrders || []).forEach((row) => incrementCount(topProductsMap, row.product_name));
  (periodPayments || []).forEach((row) => {
    if (row.status === 'validated') {
      paymentSourcesMap.set(row.source || 'unknown', (paymentSourcesMap.get(row.source || 'unknown') || 0) + Number(row.amount_kmf || 0));
    }
  });

  const completedAppointments = (periodAppointments || []).filter((row) => row.status === 'completed').length;
  const cancelledAppointments = (periodAppointments || []).filter((row) => ['cancelled', 'rejected'].includes(row.status)).length;
  const appointmentCompletionRate = appointmentsTotal > 0 ? Math.round((completedAppointments / appointmentsTotal) * 100) : 0;
  const appointmentCancellationRate = appointmentsTotal > 0 ? Math.round((cancelledAppointments / appointmentsTotal) * 100) : 0;
  const averageOrderValueKmf = ordersTotal > 0
    ? Math.round((periodOrders || []).reduce((sum, row) => sum + Number(row.amount_kmf || 0), 0) / ordersTotal)
    : 0;
  const validatedPaymentsCount = (periodPayments || []).filter((row) => row.status === 'validated').length;
  const averageValidatedPaymentKmf = validatedPaymentsCount > 0 ? Math.round(revenueValidatedKmf / validatedPaymentsCount) : 0;

  return res.status(200).json({
    success: true,
    session: {
      role: session.role,
    },
    summary: {
      customersTotal,
      testCustomers,
      appointmentsTotal,
      ordersTotal,
      paymentsTotal,
      pendingPayments,
      revenueValidatedKmf,
      overduePendingPayments,
      todayAppointments,
      testRecords: testAppointments + testOrders + testPayments,
      averageOrderValueKmf,
      averageValidatedPaymentKmf,
      appointmentCompletionRate,
      appointmentCancellationRate,
      period,
    },
    analytics: {
      topServices: topEntries(topServicesMap),
      topProducts: topEntries(topProductsMap),
      paymentSources: topEntries(paymentSourcesMap),
      pendingReminders: (pendingReminderRows || []).map(mapPayment),
      recentCustomers: (recentCustomers || []).map(mapCustomer),
    },
    recent: {
      appointments: (recentAppointments || []).map(mapAppointment),
      orders: (recentOrders || []).map(mapOrder),
      payments: (recentPayments || []).map(mapPayment),
    },
  });
}

async function handleRecords(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée. Utilisez GET.' });
  }

  requireAdmin(req);
  const entity = String(req.query?.entity || '').trim();
  const config = getEntityConfig(entity);
  const filters = buildRecordFilters(entity, req.query, config.searchFields);
  const limit = clampLimit(req.query?.limit, 50, 200);
  const rows = await selectRows(config.table, { filters, order: config.order, limit });
  return res.status(200).json({ success: true, entity, records: rows || [] });
}

async function handleExport(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée. Utilisez GET.' });
  }

  requireAdmin(req);
  const entity = String(req.query?.entity || '').trim();
  const config = getEntityConfig(entity);
  const filters = buildRecordFilters(entity, req.query, config.searchFields);
  const limit = clampLimit(req.query?.limit, 500, 5000);
  const rows = await selectRows(config.table, { filters, order: config.order, limit });
  const csv = toCsv(entity, rows || []);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${exportFilename(entity)}"`);
  return res.status(200).send(csv);
}

async function loadDetailRecord(entity, reference) {
  const config = DETAIL_CONFIG[entity];
  if (!config) {
    throw new ApiError(400, 'Paramètre entity invalide. Valeurs acceptées : customers, appointments, orders, payments.');
  }

  const keyField = entity === 'customers' ? 'customer_key' : 'reference';
  const rows = await selectRows(config.table, { filters: { [keyField]: `eq.${reference}` }, limit: 1 });
  const record = Array.isArray(rows) ? rows[0] : null;
  if (!record) {
    throw new ApiError(404, 'Enregistrement introuvable.');
  }

  if (entity === 'customers') {
    const email = record.normalized_email || record.email;
    const phone = record.normalized_phone || record.phone;
    const orFilters = [];
    if (email) orFilters.push(`customer_email.eq.${email}`);
    if (phone) orFilters.push(`customer_phone.eq.${phone}`);
    if (!orFilters.length) {
      orFilters.push(`customer_full_name.eq.${record.display_name}`);
    }

    const sharedFilters = { or: `(${orFilters.join(',')})` };
    const [customerAppointments, customerOrders, customerPayments, timeline] = await Promise.all([
      selectRows('appointments', { filters: sharedFilters, order: 'created_at.desc', limit: 50 }),
      selectRows('orders', { filters: sharedFilters, order: 'created_at.desc', limit: 50 }),
      selectRows('payments', { filters: { or: `(${[
        email ? `customer_email.eq.${email}` : null,
        phone ? `customer_phone.eq.${phone}` : null,
        `customer_full_name.eq.${record.display_name}`,
      ].filter(Boolean).join(',')})` }, order: 'created_at.desc', limit: 50 }),
      selectRows('admin_events', {
        filters: { entity_type: 'eq.customer', entity_reference: `eq.${record.customer_key}` },
        order: 'created_at.desc',
        limit: 100,
      }),
    ]);

    return {
      record,
      linkedPayments: customerPayments || [],
      linkedEntity: null,
      timeline: timeline || [],
      customerData: {
        appointments: customerAppointments || [],
        orders: customerOrders || [],
        payments: customerPayments || [],
        interactions: ((await listCustomerInteractions(record.customer_key, 200)) || []).map(mapCustomerInteraction),
      },
    };
  }

  const linkedPayments = config.linkedFilterField
    ? await selectRows('payments', {
        filters: { [config.linkedFilterField]: `eq.${record.id}` },
        order: 'created_at.desc',
        limit: 50,
      })
    : [];

  let linkedEntity = null;
  if (entity === 'payments') {
    if (record.order_id) {
      const linkedOrders = await selectRows('orders', { filters: { id: `eq.${record.order_id}` }, limit: 1 });
      const order = Array.isArray(linkedOrders) ? linkedOrders[0] : null;
      if (order) {
        linkedEntity = { entity: 'orders', reference: order.reference, status: order.status, label: order.product_name, customerName: order.customer_full_name };
      }
    } else if (record.appointment_id) {
      const linkedAppointments = await selectRows('appointments', { filters: { id: `eq.${record.appointment_id}` }, limit: 1 });
      const appointment = Array.isArray(linkedAppointments) ? linkedAppointments[0] : null;
      if (appointment) {
        linkedEntity = { entity: 'appointments', reference: appointment.reference, status: appointment.status, label: appointment.service_name, customerName: appointment.customer_full_name };
      }
    }
  }

  const timeline = await selectRows('admin_events', {
    filters: { entity_type: `eq.${config.eventType}`, entity_reference: `eq.${record.reference}` },
    order: 'created_at.desc',
    limit: 100,
  });

  return { record, linkedPayments: linkedPayments || [], linkedEntity, timeline: timeline || [], customerData: null };
}

async function handleDetail(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée. Utilisez GET.' });
  }

  requireAdmin(req);
  const entity = String(req.query?.entity || '').trim();
  const reference = String(req.query?.reference || '').trim();
  if (!reference) throw new ApiError(400, 'Le paramètre reference est requis.');
  const payload = await loadDetailRecord(entity, reference);
  return res.status(200).json({ success: true, entity, ...payload });
}

async function handleTimelineExport(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée. Utilisez GET.' });
  }

  requireAdmin(req);
  const entity = String(req.query?.entity || '').trim();
  const reference = String(req.query?.reference || '').trim();
  const eventType = TIMELINE_EVENT_TYPES[entity];
  if (!eventType) throw new ApiError(400, 'Paramètre entity invalide. Valeurs acceptées : customers, appointments, orders, payments.');
  if (!reference) throw new ApiError(400, 'Le paramètre reference est requis.');

  const rows = await selectRows('admin_events', {
    filters: { entity_type: `eq.${eventType}`, entity_reference: `eq.${reference}` },
    order: 'created_at.desc',
    limit: 1000,
  });

  const csv = timelineCsv(rows || []);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${timelineFilename(entity, reference)}"`);
  return res.status(200).send(csv);
}

async function handlePaymentAction(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée. Utilisez POST.' });
  }

  requireAdmin(req, ['manager']);
  const paymentReference = requiredString(req.body?.paymentReference, 'paymentReference', 120);
  const action = assertOneOf(requiredString(req.body?.action, 'action', 20), ['validate', 'reject', 'remind'], 'action');
  const note = optionalString(req.body?.note, 4000);

  const payments = await selectRows('payments', { filters: { reference: `eq.${paymentReference}` }, limit: 1 });
  const payment = Array.isArray(payments) ? payments[0] : null;
  if (!payment) throw new ApiError(404, 'Paiement introuvable.');
  const customerKey = buildCustomerKey(payment.customer_email, payment.customer_phone);
  const paymentActionConfig = PAYMENT_ACTIONS[action];
  if (!paymentActionConfig.allowedStatuses.includes(payment.status)) {
    throw new ApiError(400, `Cette action n'est pas autorisée pour un paiement avec statut "${payment.status}".`);
  }

  if (action === 'remind') {
    const updatedRows = await updateRows('payments', {
      metadata: {
        ...(payment.metadata || {}),
        last_reminder_at: new Date().toISOString(),
        reminder_count: Number(payment.metadata?.reminder_count || 0) + 1,
      },
    }, { filters: { reference: `eq.${paymentReference}` } });

    const updatedPayment = updatedRows[0] || payment;
    const remindRecord = {
      entityType: 'payment',
      reference: updatedPayment.reference,
      status: updatedPayment.status,
      paymentType: updatedPayment.payment_type,
      customerName: updatedPayment.customer_full_name,
      customerEmail: updatedPayment.customer_email,
      customerPhone: updatedPayment.customer_phone,
      label: updatedPayment.label,
      amountKmf: updatedPayment.amount_kmf,
      operator: updatedPayment.operator,
      clientReference: updatedPayment.client_reference,
    };
    await Promise.all([
      logAdminEvent({
        entityType: 'payment',
        entityReference: payment.reference,
        action: 'remind',
        fromStatus: payment.status,
        toStatus: payment.status,
        note,
        metadata: { source: payment.source, reminder_count: Number(payment.metadata?.reminder_count || 0) + 1 },
      }),
      sendPaymentReminderEmail(remindRecord),
      sendPaymentReminderSms(remindRecord),
      createCustomerInteraction({
        customerKey,
        channel: 'email',
        direction: 'outbound',
        summary: 'Relance paiement envoyée',
        content: note || 'Relance manuelle ou automatique pour paiement en attente.',
        relatedEntityType: 'payment',
        relatedEntityReference: payment.reference,
        createdByRole: 'manager',
        isTest: payment.is_test,
      }),
    ]);

    return res.status(200).json({ success: true, payment: updatedPayment, message: 'Relance envoyée.' });
  }

  const paymentStatus = PAYMENT_STATUS_BY_ACTION[action];
  const invoiceNumber = action === 'validate' ? buildInvoiceNumber(payment.reference) : null;
  const [updatedPayment] = await updateRows('payments', {
    status: paymentStatus,
    metadata: {
      ...(payment.metadata || {}),
      reviewed_at: new Date().toISOString(),
      reviewed_action: action,
      ...(invoiceNumber ? { invoice_number: invoiceNumber } : {}),
    },
  }, { filters: { reference: `eq.${paymentReference}` } });

  if (payment.order_id) {
    await updateRows('orders', { status: LINKED_STATUS_BY_ACTION[action].orders }, { filters: { id: `eq.${payment.order_id}` } });
  }

  if (payment.appointment_id) {
    await updateRows('appointments', { status: LINKED_STATUS_BY_ACTION[action].appointments }, { filters: { id: `eq.${payment.appointment_id}` } });
  }

  const emailRecord = {
    entityType: 'payment',
    reference: updatedPayment.reference,
    status: updatedPayment.status,
    paymentType: updatedPayment.payment_type,
    customerName: updatedPayment.customer_full_name,
    customerEmail: updatedPayment.customer_email,
    customerPhone: updatedPayment.customer_phone,
    label: updatedPayment.label,
    amountKmf: updatedPayment.amount_kmf,
    operator: updatedPayment.operator,
    clientReference: updatedPayment.client_reference,
  };

  // Génération et envoi de facture PDF si paiement validé avec email client
  if (action === 'validate' && updatedPayment.customer_email) {
    const invoiceRecord = {
      invoiceNumber,
      reference:    updatedPayment.reference,
      source:       updatedPayment.source,
      label:        updatedPayment.label,
      amountKmf:    updatedPayment.amount_kmf,
      paymentType:  updatedPayment.payment_type,
      operator:     updatedPayment.operator,
      clientReference: updatedPayment.client_reference,
      customerName:  updatedPayment.customer_full_name,
      customerEmail: updatedPayment.customer_email,
      customerPhone: updatedPayment.customer_phone,
      createdAt:     updatedPayment.created_at,
      entityType:    'payment',
    };
    generateInvoicePdf(invoiceRecord)
      .then((pdfBuffer) => sendInvoiceEmail(invoiceRecord, pdfBuffer))
      .catch((err) => console.error('[INVOICE] Erreur génération/envoi facture:', err.message));
  }

  await Promise.all([
    logAdminEvent({
      entityType: 'payment',
      entityReference: payment.reference,
      action,
      fromStatus: payment.status,
      toStatus: paymentStatus,
      note,
      metadata: { source: payment.source, order_id: payment.order_id, appointment_id: payment.appointment_id, invoice_number: invoiceNumber },
    }),
    payment.source === 'standalone' ? sendPaymentReviewEmail(emailRecord, action) : Promise.resolve(),
    sendPaymentReviewSms({ ...emailRecord, customerPhone: updatedPayment.customer_phone }, action),
    payment.source === 'standalone' ? createCustomerInteraction({
      customerKey,
      channel: 'email',
      direction: 'outbound',
      summary: action === 'validate' ? 'Validation de paiement envoyée' : 'Rejet de paiement envoyé',
      content: note,
      relatedEntityType: 'payment',
      relatedEntityReference: payment.reference,
      createdByRole: 'manager',
      isTest: payment.is_test,
    }) : Promise.resolve(),
  ]);

  return res.status(200).json({
    success: true,
    payment: updatedPayment,
    message: action === 'validate' ? 'Paiement validé avec succès.' : 'Paiement rejeté avec succès.',
  });
}

async function handleAppointmentAction(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée. Utilisez POST.' });
  }

  requireAdmin(req, ['manager']);
  const appointmentReference = requiredString(req.body?.appointmentReference, 'appointmentReference', 120);
  const action = assertOneOf(requiredString(req.body?.action, 'action', 20), ['confirm', 'cancel', 'complete'], 'action');
  const note = optionalString(req.body?.note, 4000);
  const actionConfig = APPOINTMENT_ACTIONS[action];

  const appointments = await selectRows('appointments', { filters: { reference: `eq.${appointmentReference}` }, limit: 1 });
  const appointment = Array.isArray(appointments) ? appointments[0] : null;
  if (!appointment) throw new ApiError(404, 'Rendez-vous introuvable.');
  const customerKey = buildCustomerKey(appointment.customer_email, appointment.customer_phone);
  if (!actionConfig.allowedStatuses.includes(appointment.status)) {
    throw new ApiError(400, 'Cette action n\'est pas autorisée pour le statut actuel du rendez-vous.');
  }

  const [updatedAppointment] = await updateRows('appointments', {
    status: actionConfig.targetStatus,
    metadata: { ...(appointment.metadata || {}), last_admin_action: action, last_admin_action_at: new Date().toISOString() },
  }, { filters: { reference: `eq.${appointmentReference}` } });

  if (action === 'confirm' && appointment.payment_type === 'mobile_money') {
    await updateRows('payments', { status: 'validated' }, { filters: { appointment_id: `eq.${appointment.id}`, status: 'eq.pending_review' } });
  }
  if (action === 'cancel') {
    await updateRows('payments', { status: 'failed' }, { filters: { appointment_id: `eq.${appointment.id}`, status: 'in.(pending_review,cash_reserved)' } });
  }
  if (action === 'complete' && appointment.payment_type === 'cash') {
    await updateRows('payments', { status: 'validated' }, { filters: { appointment_id: `eq.${appointment.id}`, status: 'eq.cash_reserved' } });
  }

  const emailRecord = {
    entityType: 'appointment',
    reference: updatedAppointment.reference,
    status: updatedAppointment.status,
    paymentType: updatedAppointment.payment_type,
    customerName: updatedAppointment.customer_full_name,
    customerEmail: updatedAppointment.customer_email,
    customerPhone: updatedAppointment.customer_phone,
    label: updatedAppointment.service_name,
    amountKmf: updatedAppointment.deposit_amount_kmf ?? updatedAppointment.service_price_kmf ?? null,
    appointmentDate: updatedAppointment.appointment_date,
    appointmentTime: updatedAppointment.appointment_time,
    appointmentTimezone: updatedAppointment.appointment_timezone,
    technicianName: updatedAppointment.technician_name,
    location: updatedAppointment.location,
  };

  await Promise.all([
    logAdminEvent({
      entityType: 'appointment',
      entityReference: appointment.reference,
      action,
      fromStatus: appointment.status,
      toStatus: actionConfig.targetStatus,
      note,
      metadata: { payment_type: appointment.payment_type, deposit_amount_kmf: appointment.deposit_amount_kmf },
    }),
    sendAppointmentStatusEmail(emailRecord, action),
    sendAppointmentStatusSms(emailRecord, action),
    createCustomerInteraction({
      customerKey,
      channel: 'email',
      direction: 'outbound',
      summary: action === 'confirm' ? 'Confirmation de rendez-vous envoyée' : action === 'cancel' ? 'Annulation de rendez-vous envoyée' : 'Clôture de rendez-vous envoyée',
      content: note,
      relatedEntityType: 'appointment',
      relatedEntityReference: appointment.reference,
      createdByRole: 'manager',
      isTest: appointment.is_test,
    }),
  ]);

  return res.status(200).json({
    success: true,
    appointment: updatedAppointment,
    message: action === 'confirm' ? 'Rendez-vous confirmé.' : action === 'cancel' ? 'Rendez-vous annulé.' : 'Rendez-vous marqué comme terminé.',
  });
}

async function handleOrderAction(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée. Utilisez POST.' });
  }

  requireAdmin(req, ['manager']);
  const orderReference = requiredString(req.body?.orderReference, 'orderReference', 120);
  const action = assertOneOf(requiredString(req.body?.action, 'action', 20), ['validate', 'cancel', 'fulfill'], 'action');
  const note = optionalString(req.body?.note, 4000);
  const actionConfig = ORDER_ACTIONS[action];

  const orders = await selectRows('orders', { filters: { reference: `eq.${orderReference}` }, limit: 1 });
  const order = Array.isArray(orders) ? orders[0] : null;
  if (!order) throw new ApiError(404, 'Commande introuvable.');
  const customerKey = buildCustomerKey(order.customer_email, order.customer_phone);
  if (!actionConfig.allowedStatuses.includes(order.status)) {
    throw new ApiError(400, 'Cette action n\'est pas autorisée pour le statut actuel de la commande.');
  }

  const [updatedOrder] = await updateRows('orders', {
    status: actionConfig.targetStatus,
    metadata: { ...(order.metadata || {}), last_admin_action: action, last_admin_action_at: new Date().toISOString() },
  }, { filters: { reference: `eq.${orderReference}` } });

  if (action === 'validate') {
    await updateRows('payments', { status: 'validated' }, {
      filters: { order_id: `eq.${order.id}`, status: order.payment_type === 'mobile_money' ? 'eq.pending_review' : 'eq.cash_reserved' },
    });
  }
  if (action === 'cancel') {
    await updateRows('payments', { status: 'failed' }, { filters: { order_id: `eq.${order.id}`, status: 'in.(pending_review,cash_reserved)' } });
  }
  if (action === 'fulfill' && order.payment_type === 'cash') {
    await updateRows('payments', { status: 'validated' }, { filters: { order_id: `eq.${order.id}`, status: 'eq.cash_reserved' } });
  }

  const emailRecord = {
    entityType: 'order',
    reference: updatedOrder.reference,
    status: updatedOrder.status,
    paymentType: updatedOrder.payment_type,
    customerName: updatedOrder.customer_full_name,
    customerEmail: updatedOrder.customer_email,
    customerPhone: updatedOrder.customer_phone,
    label: updatedOrder.product_name,
    amountKmf: updatedOrder.amount_kmf,
  };

  await Promise.all([
    logAdminEvent({
      entityType: 'order',
      entityReference: order.reference,
      action,
      fromStatus: order.status,
      toStatus: actionConfig.targetStatus,
      note,
      metadata: { payment_type: order.payment_type, amount_kmf: order.amount_kmf },
    }),
    sendOrderStatusEmail(emailRecord, action),
    sendOrderStatusSms({ ...emailRecord, customerPhone: updatedOrder.customer_phone }, action),
    createCustomerInteraction({
      customerKey,
      channel: 'email',
      direction: 'outbound',
      summary: action === 'validate' ? 'Validation de commande envoyée' : action === 'cancel' ? 'Annulation de commande envoyée' : 'Remise de commande envoyée',
      content: note,
      relatedEntityType: 'order',
      relatedEntityReference: order.reference,
      createdByRole: 'manager',
      isTest: order.is_test,
    }),
  ]);

  return res.status(200).json({
    success: true,
    order: updatedOrder,
    message: action === 'validate' ? 'Commande validée.' : action === 'cancel' ? 'Commande annulée.' : 'Commande marquée comme remise au client.',
  });
}

async function handleNote(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée. Utilisez POST.' });
  }

  requireAdmin(req, ['manager']);
  const entity = requiredString(req.body?.entity, 'entity', 40);
  const entityType = TIMELINE_EVENT_TYPES[entity];
  if (!entityType) throw new ApiError(400, 'Entity invalide. Valeurs acceptées : customers, appointments, orders, payments.');
  const reference = requiredString(req.body?.reference, 'reference', 120);
  const note = optionalString(req.body?.note, 4000);
  if (!note) throw new ApiError(400, 'La note admin ne peut pas être vide.');

  const event = await logAdminEvent({ entityType, entityReference: reference, action: 'note', note });
  if (entityType === 'customer') {
    await createCustomerInteraction({
      customerKey: reference,
      channel: 'admin',
      direction: 'internal',
      summary: 'Note interne',
      content: note,
      relatedEntityType: 'customer',
      relatedEntityReference: reference,
      createdByRole: 'manager',
    });
  }
  return res.status(200).json({ success: true, event });
}

async function handleCustomerAction(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée. Utilisez POST.' });
  }

  requireAdmin(req, ['manager']);
  const customerKey = requiredString(req.body?.customerKey, 'customerKey', 200);
  const lifecycleStatus = assertOneOf(requiredString(req.body?.lifecycleStatus, 'lifecycleStatus', 20), ['lead', 'active', 'vip', 'blocked', 'test'], 'lifecycleStatus');
  const notes = optionalString(req.body?.notes, 5000);
  const tagsInput = req.body?.tags;
  const tags = Array.isArray(tagsInput)
    ? tagsInput.map((value) => String(value).trim()).filter(Boolean)
    : String(tagsInput || '').split(',').map((value) => value.trim()).filter(Boolean);

  const rows = await selectRows('customer_profiles', { filters: { customer_key: `eq.${customerKey}` }, limit: 1 });
  const customer = Array.isArray(rows) ? rows[0] : null;
  if (!customer) throw new ApiError(404, 'Client introuvable.');

  const updatedRows = await updateRows('customer_profiles', {
    lifecycle_status: lifecycleStatus,
    notes,
    tags,
    is_test: lifecycleStatus === 'test' ? true : customer.is_test,
  }, { filters: { customer_key: `eq.${customerKey}` } });

  const updated = updatedRows[0] || customer;
  await logAdminEvent({
    entityType: 'customer',
    entityReference: customerKey,
    action: 'update-profile',
    fromStatus: customer.lifecycle_status,
    toStatus: lifecycleStatus,
    note: notes,
    metadata: { tags },
  });

  return res.status(200).json({ success: true, customer: updated, message: 'Profil client mis à jour.' });
}

async function handleCustomerInteractionAction(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée. Utilisez POST.' });
  }

  requireAdmin(req, ['manager']);
  const customerKey = requiredString(req.body?.customerKey, 'customerKey', 200);
  const channel = assertOneOf(requiredString(req.body?.channel, 'channel', 20), ['email', 'phone', 'whatsapp', 'website', 'admin', 'system'], 'channel');
  const direction = assertOneOf(requiredString(req.body?.direction, 'direction', 20), ['inbound', 'outbound', 'internal'], 'direction');
  const summary = requiredString(req.body?.summary, 'summary', 200);
  const content = optionalString(req.body?.content, 5000);
  const relatedEntityType = optionalString(req.body?.relatedEntityType, 20);
  const relatedEntityReference = optionalString(req.body?.relatedEntityReference, 200);

  const rows = await selectRows('customer_profiles', { filters: { customer_key: `eq.${customerKey}` }, limit: 1 });
  const customer = Array.isArray(rows) ? rows[0] : null;
  if (!customer) throw new ApiError(404, 'Client introuvable.');

  const interaction = await createCustomerInteraction({
    customerKey,
    channel,
    direction,
    summary,
    content,
    relatedEntityType,
    relatedEntityReference,
    createdByRole: 'manager',
    isTest: customer.is_test,
  });

  await logAdminEvent({
    entityType: 'customer',
    entityReference: customerKey,
    action: 'interaction',
    note: summary,
    metadata: { channel, direction },
  });

  return res.status(200).json({ success: true, interaction, message: 'Interaction client ajoutée.' });
}

async function handleCleanupTestData(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée. Utilisez POST.' });
  }

  requireAdmin(req, ['manager']);

  const [testAppointments, testOrders, testPayments, testCustomers] = await Promise.all([
    selectRows('appointments', { select: 'id,reference', filters: { is_test: 'eq.true' }, limit: 5000 }),
    selectRows('orders', { select: 'id,reference', filters: { is_test: 'eq.true' }, limit: 5000 }),
    selectRows('payments', { select: 'id,reference', filters: { is_test: 'eq.true' }, limit: 5000 }),
    selectRows('customer_profiles', { select: 'customer_key', filters: { is_test: 'eq.true' }, limit: 5000 }),
  ]);

  const appointmentRefs = (testAppointments || []).map((row) => row.reference);
  const orderRefs = (testOrders || []).map((row) => row.reference);
  const paymentRefs = (testPayments || []).map((row) => row.reference);
  const customerKeys = (testCustomers || []).map((row) => row.customer_key);

  if (paymentRefs.length) {
    await deleteRows('admin_events', { filters: { entity_type: 'eq.payment', entity_reference: `in.(${paymentRefs.join(',')})` } });
  }
  if (appointmentRefs.length) {
    await deleteRows('admin_events', { filters: { entity_type: 'eq.appointment', entity_reference: `in.(${appointmentRefs.join(',')})` } });
  }
  if (orderRefs.length) {
    await deleteRows('admin_events', { filters: { entity_type: 'eq.order', entity_reference: `in.(${orderRefs.join(',')})` } });
  }
  if (customerKeys.length) {
    await deleteRows('admin_events', { filters: { entity_type: 'eq.customer', entity_reference: `in.(${customerKeys.join(',')})` } });
  }

  if (paymentRefs.length) {
    await deleteRows('payments', { filters: { reference: `in.(${paymentRefs.join(',')})` } });
  }
  if (appointmentRefs.length) {
    await deleteRows('appointments', { filters: { reference: `in.(${appointmentRefs.join(',')})` } });
  }
  if (orderRefs.length) {
    await deleteRows('orders', { filters: { reference: `in.(${orderRefs.join(',')})` } });
  }
  if (customerKeys.length) {
    await deleteRows('customer_profiles', { filters: { customer_key: `in.(${customerKeys.join(',')})` } });
  }

  return res.status(200).json({
    success: true,
    deleted: {
      appointments: appointmentRefs.length,
      orders: orderRefs.length,
      payments: paymentRefs.length,
      customers: customerKeys.length,
    },
    message: 'Données de test supprimées.',
  });
}

export async function runAdminRoute(route, req, res) {
  switch (route) {
    case 'login': return handleLogin(req, res);
    case 'logout': return handleLogout(req, res);
    case 'session': return handleSession(req, res);
    case 'dashboard': return handleDashboard(req, res);
    case 'records': return handleRecords(req, res);
    case 'export': return handleExport(req, res);
    case 'detail': return handleDetail(req, res);
    case 'timeline-export': return handleTimelineExport(req, res);
    case 'payment-action': return handlePaymentAction(req, res);
    case 'appointment-action': return handleAppointmentAction(req, res);
    case 'order-action': return handleOrderAction(req, res);
    case 'note': return handleNote(req, res);
    case 'customer-action': return handleCustomerAction(req, res);
    case 'customer-interaction-action': return handleCustomerInteractionAction(req, res);
    case 'cleanup-test-data': return handleCleanupTestData(req, res);
    default:
      throw new ApiError(404, 'Route admin introuvable.');
  }
}
