import { ApiError } from './lib.js';

export const ENTITY_CONFIG = {
  customers: {
    table: 'customer_profiles',
    order: 'last_seen_at.desc',
    searchFields: ['customer_key', 'display_name', 'email', 'phone', 'normalized_email', 'normalized_phone', 'notes'],
  },
  appointments: {
    table: 'appointments',
    order: 'appointment_date.desc,appointment_time.desc',
    searchFields: ['reference', 'customer_full_name', 'customer_email', 'customer_phone', 'service_name', 'technician_name', 'location'],
  },
  orders: {
    table: 'orders',
    order: 'created_at.desc',
    searchFields: ['reference', 'product_name', 'customer_full_name', 'customer_email', 'customer_phone', 'payment_operator'],
  },
  payments: {
    table: 'payments',
    order: 'created_at.desc',
    searchFields: ['reference', 'label', 'customer_full_name', 'customer_email', 'customer_phone', 'operator', 'client_reference'],
  },
};

function escapeSearch(value) {
  return String(value || '').replace(/[(),]/g, ' ').trim();
}

export function getEntityConfig(entity) {
  const config = ENTITY_CONFIG[entity];
  if (!config) {
    throw new ApiError(400, 'Paramètre entity invalide. Valeurs acceptées : customers, appointments, orders, payments.');
  }
  return config;
}

export function buildRecordFilters(entity, query, searchFields) {
  const filters = {};

  if (query?.status) {
    filters.status = `eq.${query.status}`;
  }

  if (query?.reference) {
    filters.reference = `eq.${query.reference}`;
  }

  if (query?.paymentType) {
    filters.payment_type = `eq.${query.paymentType}`;
  }

  if (query?.source) {
    filters.source = `eq.${query.source}`;
  }

  if (query?.lifecycleStatus && entity === 'customers') {
    filters.lifecycle_status = `eq.${query.lifecycleStatus}`;
  }

  if (query?.customerKey && entity === 'customers') {
    filters.customer_key = `eq.${query.customerKey}`;
  }

  if (query?.technicianName && entity === 'appointments') {
    filters.technician_name = `eq.${query.technicianName}`;
  }

  if (query?.isTest === 'true') {
    filters.is_test = 'eq.true';
  }

  if (query?.isTest === 'false') {
    filters.is_test = 'eq.false';
  }

  if (entity === 'appointments') {
    const dateFilters = [];
    if (query?.dateFrom) dateFilters.push(`gte.${query.dateFrom}`);
    if (query?.dateTo) dateFilters.push(`lte.${query.dateTo}`);
    if (dateFilters.length) filters.appointment_date = dateFilters;
  } else if (entity === 'customers') {
    const dateFilters = [];
    if (query?.dateFrom) dateFilters.push(`gte.${query.dateFrom}T00:00:00.000Z`);
    if (query?.dateTo) dateFilters.push(`lte.${query.dateTo}T23:59:59.999Z`);
    if (dateFilters.length) filters.last_seen_at = dateFilters;
  } else {
    const dateFilters = [];
    if (query?.dateFrom) dateFilters.push(`gte.${query.dateFrom}T00:00:00.000Z`);
    if (query?.dateTo) dateFilters.push(`lte.${query.dateTo}T23:59:59.999Z`);
    if (dateFilters.length) filters.created_at = dateFilters;
  }

  const search = escapeSearch(query?.search);
  if (search) {
    filters.or = `(${searchFields.map((field) => `${field}.ilike.*${search}*`).join(',')})`;
  }

  return filters;
}

export function clampLimit(value, defaultValue = 50, maxValue = 200) {
  const limitValue = Number(value || defaultValue);
  return Number.isFinite(limitValue) ? Math.max(1, Math.min(limitValue, maxValue)) : defaultValue;
}
