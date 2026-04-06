import { selectRows, insertRow, deleteRows } from './supabase.js';
import { ApiError } from './lib.js';

const VALID_CATEGORIES = [
  'materiel', 'logiciels', 'hebergement', 'marketing', 'transport',
  'telephone', 'sous-traitance', 'fournitures', 'divers',
];

const FRENCH_MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

function comoroDateBounds(period, dateFrom, dateTo) {
  const OFFSET = 3 * 3600000; // UTC+3
  const now = new Date();
  const comoroNow = new Date(now.getTime() + OFFSET);

  if (period === 'today') {
    const todayStart = new Date(Date.UTC(comoroNow.getUTCFullYear(), comoroNow.getUTCMonth(), comoroNow.getUTCDate()) - OFFSET);
    return { start: todayStart.toISOString(), end: new Date(todayStart.getTime() + 86400000).toISOString() };
  }
  if (period === 'year') {
    const start = new Date(Date.UTC(comoroNow.getUTCFullYear(), 0, 1) - OFFSET);
    const end = new Date(Date.UTC(comoroNow.getUTCFullYear() + 1, 0, 1) - OFFSET);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  if (period === 'custom' && dateFrom && dateTo) {
    return { start: dateFrom + 'T00:00:00.000Z', end: dateTo + 'T23:59:59.999Z' };
  }
  // default: month
  const start = new Date(Date.UTC(comoroNow.getUTCFullYear(), comoroNow.getUTCMonth(), 1) - OFFSET);
  const end = new Date(Date.UTC(comoroNow.getUTCFullYear(), comoroNow.getUTCMonth() + 1, 1) - OFFSET);
  return { start: start.toISOString(), end: end.toISOString() };
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function sumAmounts(rows) {
  return rows.reduce((acc, r) => acc + (Number(r.amount_kmf) || 0), 0);
}

async function safeSelectExpenses(filters = {}, limit = null, order = null) {
  try {
    return await selectRows('accounting_expenses', { filters, limit, order });
  } catch (err) {
    // Table doesn't exist yet
    if (err && (err.code === '42P01' || String(err.message).includes('does not exist') || String(err.message).includes('relation'))) {
      return [];
    }
    throw err;
  }
}

export async function getAccountingDashboard(period = 'month', dateFrom, dateTo) {
  const { start, end } = comoroDateBounds(period, dateFrom, dateTo);

  // Validated payments in period
  let revenueRows = [];
  try {
    revenueRows = await selectRows('payments', {
      filters: {
        status: 'eq.validated',
        is_test: 'eq.false',
        created_at: [`gte.${start}`, `lte.${end}`],
      },
      select: 'amount_kmf',
    });
  } catch (_) { revenueRows = []; }

  // Pending review payments (all, not just period)
  let pendingRows = [];
  try {
    pendingRows = await selectRows('payments', {
      filters: {
        status: 'eq.pending_review',
        is_test: 'eq.false',
      },
      select: 'amount_kmf,created_at',
    });
  } catch (_) { pendingRows = []; }

  // Overdue: pending_review older than 24h / urgent: older than 48h
  const cutoff24 = new Date(Date.now() - 86400000).toISOString();
  const cutoff48 = new Date(Date.now() - 172800000).toISOString();
  const overdueRows = pendingRows.filter(r => r.created_at < cutoff24);
  const urgentRows = pendingRows.filter(r => r.created_at < cutoff48);

  // Expenses in period — expense_date is a date column (YYYY-MM-DD)
  const dateStartStr = start.slice(0, 10);
  const dateEndStr = end.slice(0, 10);
  const expenseRows = await safeSelectExpenses(
    { expense_date: [`gte.${dateStartStr}`, `lte.${dateEndStr}`] },
    null,
    null
  );

  const revTotal = sumAmounts(revenueRows);
  const expTotal = sumAmounts(expenseRows);

  // 6-month chart
  const OFFSET = 3 * 3600000;
  const nowComoro = new Date(new Date().getTime() + OFFSET);
  const chartMonths = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(nowComoro.getUTCFullYear(), nowComoro.getUTCMonth() - i, 1));
    chartMonths.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() }); // 0-based
  }

  const chartStart = new Date(Date.UTC(chartMonths[0].year, chartMonths[0].month, 1) - OFFSET).toISOString();
  let chartPayments = [];
  try {
    chartPayments = await selectRows('payments', {
      filters: {
        status: 'eq.validated',
        is_test: 'eq.false',
        created_at: `gte.${chartStart}`,
      },
      select: 'amount_kmf,created_at',
    });
  } catch (_) { chartPayments = []; }

  const chartMap = {};
  for (const r of chartPayments) {
    const d = new Date(new Date(r.created_at).getTime() + OFFSET);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    chartMap[key] = (chartMap[key] || 0) + (Number(r.amount_kmf) || 0);
  }

  const chart = chartMonths.map(({ year, month }) => {
    const key = `${year}-${String(month + 1).padStart(2, '0')}`;
    return { label: FRENCH_MONTHS[month], amount: chartMap[key] || 0 };
  });

  return {
    revenue: { total: revTotal, count: revenueRows.length },
    pending: { total: sumAmounts(pendingRows), count: pendingRows.length },
    overdue: { count: overdueRows.length, urgent: urgentRows.length },
    expenses: { total: expTotal, count: expenseRows.length },
    profit: revTotal - expTotal,
    chart,
  };
}

export async function getRevenuePayments(filters = {}) {
  const { period = 'month', dateFrom, dateTo, status = '', search = '', limit = 100 } = filters;
  const { start, end } = comoroDateBounds(period, dateFrom, dateTo);

  const q = {
    created_at: [`gte.${start}`, `lte.${end}`],
    is_test: 'eq.false',
  };

  if (status) {
    q.status = `eq.${status}`;
  }

  if (search && search.trim()) {
    const s = search.trim();
    q['or'] = `(customer_full_name.ilike.*${s}*,reference.ilike.*${s}*)`;
  }

  try {
    return await selectRows('payments', { filters: q, limit, order: 'created_at.desc' });
  } catch (_) {
    return [];
  }
}

export async function getExpenses(filters = {}) {
  const { period = 'month', dateFrom, dateTo, category = '', limit = 200 } = filters;
  const { start, end } = comoroDateBounds(period, dateFrom, dateTo);
  const dateStartStr = start.slice(0, 10);
  const dateEndStr = end.slice(0, 10);

  const q = {
    expense_date: [`gte.${dateStartStr}`, `lte.${dateEndStr}`],
  };

  if (category) {
    q.category = `eq.${category}`;
  }

  return safeSelectExpenses(q, limit, 'expense_date.desc');
}

export async function addExpense(data) {
  const { expense_date, category, description, amount_kmf, supplier, payment_method, notes } = data || {};

  if (!expense_date || !/^\d{4}-\d{2}-\d{2}$/.test(String(expense_date))) {
    throw new ApiError(400, 'La date de la dépense est requise (format YYYY-MM-DD).');
  }
  if (!category || !VALID_CATEGORIES.includes(String(category).trim())) {
    throw new ApiError(400, `Catégorie invalide. Valeurs acceptées : ${VALID_CATEGORIES.join(', ')}.`);
  }
  const descNorm = String(description ?? '').trim();
  if (!descNorm) {
    throw new ApiError(400, 'La description est requise.');
  }
  if (descNorm.length > 500) {
    throw new ApiError(400, 'La description est trop longue (max 500 caractères).');
  }
  const amount = Number(amount_kmf);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, 'Le montant doit être un entier positif.');
  }

  const row = {
    expense_date: String(expense_date).trim(),
    category: String(category).trim(),
    description: descNorm,
    amount_kmf: Math.round(amount),
    supplier: supplier ? String(supplier).trim().slice(0, 200) || null : null,
    payment_method: payment_method ? String(payment_method).trim().slice(0, 100) || null : null,
    notes: notes ? String(notes).trim().slice(0, 2000) || null : null,
  };

  return insertRow('accounting_expenses', row);
}

export async function deleteExpense(id) {
  if (!id) throw new ApiError(400, 'ID de dépense requis.');
  const deleted = await deleteRows('accounting_expenses', {
    filters: { id: `eq.${id}` },
  });
  if (!deleted || deleted.length === 0) {
    throw new ApiError(404, 'Dépense introuvable.');
  }
  return deleted[0];
}

export async function getOverduePayments() {
  const cutoff = new Date(Date.now() - 86400000).toISOString();
  try {
    return await selectRows('payments', {
      filters: {
        status: 'eq.pending_review',
        is_test: 'eq.false',
        created_at: `lt.${cutoff}`,
      },
      order: 'created_at.asc',
    });
  } catch (_) {
    return [];
  }
}

export async function exportRevenueCsv(filters = {}) {
  const payments = await getRevenuePayments({ ...filters, limit: 5000 });

  const headers = [
    'reference', 'source', 'status', 'payment_type', 'label',
    'amount_kmf', 'customer_full_name', 'customer_email', 'customer_phone',
    'operator', 'is_test', 'created_at',
  ];

  const lines = [
    '\uFEFF' + headers.join(';'),
    ...payments.map(r =>
      headers.map(h => csvEscape(r[h])).join(';')
    ),
  ];

  return lines.join('\r\n');
}

export async function exportExpensesCsv(filters = {}) {
  const expenses = await getExpenses({ ...filters, limit: 10000 });

  const headers = [
    'expense_date', 'category', 'supplier', 'description',
    'amount_kmf', 'payment_method', 'notes', 'created_at',
  ];

  const lines = [
    '\uFEFF' + headers.join(';'),
    ...expenses.map(r =>
      headers.map(h => csvEscape(r[h])).join(';')
    ),
  ];

  return lines.join('\r\n');
}

export async function getCashFlow() {
  const OFFSET = 3 * 3600000;
  const nowComoro = new Date(new Date().getTime() + OFFSET);
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(nowComoro.getUTCFullYear(), nowComoro.getUTCMonth() - i, 1));
    months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() });
  }

  const chartStart = new Date(Date.UTC(months[0].year, months[0].month, 1) - OFFSET).toISOString();
  let payments = [];
  try {
    payments = await selectRows('payments', {
      filters: { status: 'eq.validated', is_test: 'eq.false', created_at: `gte.${chartStart}` },
      select: 'amount_kmf,created_at',
      limit: 10000,
    });
  } catch (_) {}

  const startDateStr = new Date(Date.UTC(months[0].year, months[0].month, 1)).toISOString().slice(0, 10);
  const expenses = await safeSelectExpenses({ expense_date: `gte.${startDateStr}` }, 10000, null);

  const revenueMap = {};
  for (const r of payments) {
    const d = new Date(new Date(r.created_at).getTime() + OFFSET);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    revenueMap[key] = (revenueMap[key] || 0) + (Number(r.amount_kmf) || 0);
  }

  const expenseMap = {};
  for (const r of expenses) {
    const key = String(r.expense_date).slice(0, 7);
    expenseMap[key] = (expenseMap[key] || 0) + (Number(r.amount_kmf) || 0);
  }

  let cumulative = 0;
  return months.map(({ year, month }) => {
    const key = `${year}-${String(month + 1).padStart(2, '0')}`;
    const rev = revenueMap[key] || 0;
    const exp = expenseMap[key] || 0;
    const balance = rev - exp;
    cumulative += balance;
    return { key, label: FRENCH_MONTHS[month] + ' ' + year, revenue: rev, expenses: exp, balance, cumulative };
  });
}

export async function getTopCustomers(filters = {}) {
  const { period = 'year', dateFrom, dateTo } = filters;
  const { start, end } = comoroDateBounds(period, dateFrom, dateTo);

  let payments = [];
  try {
    payments = await selectRows('payments', {
      filters: {
        status: 'eq.validated',
        is_test: 'eq.false',
        created_at: [`gte.${start}`, `lte.${end}`],
      },
      select: 'amount_kmf,customer_full_name,customer_email,customer_phone,customer_key,created_at',
      limit: 10000,
    });
  } catch (_) {}

  const map = {};
  for (const p of payments) {
    const k = p.customer_key || p.customer_email || p.customer_full_name || 'inconnu';
    if (!map[k]) {
      map[k] = {
        customer_key: p.customer_key,
        customer_full_name: p.customer_full_name || '—',
        customer_email: p.customer_email || null,
        customer_phone: p.customer_phone || null,
        count: 0,
        total: 0,
        last_payment: null,
      };
    }
    map[k].count++;
    map[k].total += Number(p.amount_kmf) || 0;
    if (!map[k].last_payment || p.created_at > map[k].last_payment) {
      map[k].last_payment = p.created_at;
    }
  }

  return Object.values(map)
    .sort((a, b) => b.total - a.total)
    .slice(0, 30);
}

export async function getPaymentCalendar(dateFrom, dateTo) {
  const q = { status: 'eq.pending_review', is_test: 'eq.false' };
  if (dateFrom) q['created_at'] = [`gte.${dateFrom}T00:00:00Z`];
  if (dateTo) {
    if (Array.isArray(q['created_at'])) q['created_at'].push(`lte.${dateTo}T23:59:59Z`);
    else q['created_at'] = [`lte.${dateTo}T23:59:59Z`];
  }
  try {
    return await selectRows('payments', {
      filters: q,
      order: 'created_at.asc',
      limit: 500,
    });
  } catch (_) {
    return [];
  }
}

export async function exportMonthlyCsv(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m || m < 1 || m > 12) throw new ApiError(400, 'Année et mois requis (1–12).');

  const pad = v => String(v).padStart(2, '0');
  const dateFrom = `${y}-${pad(m)}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const dateTo = `${y}-${pad(m)}-${pad(lastDay)}`;
  const { start, end } = comoroDateBounds('custom', dateFrom, dateTo);

  let payments = [];
  try {
    payments = await selectRows('payments', {
      filters: { is_test: 'eq.false', created_at: [`gte.${start}`, `lte.${end}`] },
      order: 'created_at.asc',
      limit: 5000,
    });
  } catch (_) {}

  const expenses = await safeSelectExpenses(
    { expense_date: [`gte.${dateFrom}`, `lte.${dateTo}`] },
    10000,
    'expense_date.asc'
  );

  const MONTH_NAMES = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const monthName = MONTH_NAMES[m - 1];
  const validatedPayments = payments.filter(p => p.status === 'validated');
  const totalRev = sumAmounts(validatedPayments);
  const totalExp = sumAmounts(expenses);

  const lines = [
    `\uFEFF"=== RAPPORT MENSUEL ${monthName.toUpperCase()} ${y} — INFO EXPERTS ==="`,
    ``,
    `"--- REVENUS (${payments.length} paiements dont ${validatedPayments.length} validés) ---"`,
    `"Date";"Référence";"Client";"Téléphone";"Email";"Objet";"Montant KMF";"Mode";"Statut"`,
    ...payments.map(r => [
      csvEscape(String(r.created_at || '').slice(0, 10)),
      csvEscape(r.reference),
      csvEscape(r.customer_full_name),
      csvEscape(r.customer_phone),
      csvEscape(r.customer_email),
      csvEscape(r.label || r.payment_type),
      csvEscape(r.amount_kmf),
      csvEscape(r.operator || r.source),
      csvEscape(r.status),
    ].join(';')),
    ``,
    `"TOTAL REVENUS VALIDÉS";${csvEscape(totalRev)}`,
    ``,
    `"--- DÉPENSES (${expenses.length} dépenses) ---"`,
    `"Date";"Catégorie";"Fournisseur";"Description";"Montant KMF";"Mode de paiement";"Notes"`,
    ...expenses.map(r => [
      csvEscape(r.expense_date),
      csvEscape(r.category),
      csvEscape(r.supplier),
      csvEscape(r.description),
      csvEscape(r.amount_kmf),
      csvEscape(r.payment_method),
      csvEscape(r.notes),
    ].join(';')),
    ``,
    `"TOTAL DÉPENSES";${csvEscape(totalExp)}`,
    `"BÉNÉFICE NET";${csvEscape(totalRev - totalExp)}`,
  ];

  return lines.join('\r\n');
}
