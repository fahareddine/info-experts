import { requireAdmin } from '../../lib/server/admin.js';
import { ApiError, sendError } from '../../lib/server/lib.js';
import {
  addExpense, deleteExpense, exportExpensesCsv, exportMonthlyCsv, exportRevenueCsv,
  getAccountingDashboard, getCashFlow, getExpenses, getOverduePayments,
  getPaymentCalendar, getRevenuePayments, getTopCustomers,
} from '../../lib/server/accounting.js';

export default async function handler(req, res) {
  try {
    requireAdmin(req);
    const action = String(req.query?.action || '').trim();

    if (action === 'dashboard') {
      if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET requis.' });
      const data = await getAccountingDashboard(req.query?.period || 'month', req.query?.dateFrom, req.query?.dateTo);
      return res.status(200).json({ success: true, ...data });
    }

    if (action === 'payments') {
      if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET requis.' });
      const payments = await getRevenuePayments({
        period: req.query?.period || 'month',
        dateFrom: req.query?.dateFrom,
        dateTo: req.query?.dateTo,
        status: req.query?.status || '',
        search: req.query?.search || '',
        limit: Math.min(Number(req.query?.limit || 100), 500),
      });
      return res.status(200).json({ success: true, payments });
    }

    if (action === 'expenses') {
      if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET requis.' });
      const expenses = await getExpenses({
        period: req.query?.period || 'month',
        dateFrom: req.query?.dateFrom,
        dateTo: req.query?.dateTo,
        category: req.query?.category || '',
        limit: Math.min(Number(req.query?.limit || 200), 1000),
      });
      return res.status(200).json({ success: true, expenses });
    }

    if (action === 'add-expense') {
      if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST requis.' });
      const expense = await addExpense(req.body || {});
      return res.status(200).json({ success: true, expense });
    }

    if (action === 'delete-expense') {
      if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST requis.' });
      await deleteExpense(req.body?.id);
      return res.status(200).json({ success: true });
    }

    if (action === 'overdue') {
      if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET requis.' });
      const overdue = await getOverduePayments();
      return res.status(200).json({ success: true, overdue });
    }

    if (action === 'export-payments-csv') {
      if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET requis.' });
      const csv = await exportRevenueCsv({
        period: req.query?.period || 'month',
        dateFrom: req.query?.dateFrom,
        dateTo: req.query?.dateTo,
        status: req.query?.status || '',
      });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="paiements-${stamp}.csv"`);
      return res.status(200).send(csv);
    }

    if (action === 'export-expenses-csv') {
      if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET requis.' });
      const csv = await exportExpensesCsv({
        period: req.query?.period || 'month',
        dateFrom: req.query?.dateFrom,
        dateTo: req.query?.dateTo,
      });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="depenses-${stamp}.csv"`);
      return res.status(200).send(csv);
    }

    if (action === 'cashflow') {
      if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET requis.' });
      const rows = await getCashFlow();
      return res.status(200).json({ success: true, rows });
    }

    if (action === 'top-customers') {
      if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET requis.' });
      const customers = await getTopCustomers({
        period: req.query?.period || 'year',
        dateFrom: req.query?.dateFrom,
        dateTo: req.query?.dateTo,
      });
      return res.status(200).json({ success: true, customers });
    }

    if (action === 'calendar') {
      if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET requis.' });
      const payments = await getPaymentCalendar(req.query?.dateFrom, req.query?.dateTo);
      return res.status(200).json({ success: true, payments });
    }

    if (action === 'export-monthly-csv') {
      if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET requis.' });
      const csv = await exportMonthlyCsv(req.query?.year, req.query?.month);
      const y = String(req.query?.year || '').padStart(4, '0');
      const m = String(req.query?.month || '').padStart(2, '0');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="rapport-mensuel-${y}-${m}.csv"`);
      return res.status(200).send(csv);
    }

    throw new ApiError(400, 'Action inconnue.');
  } catch (error) {
    return sendError(res, error);
  }
}
