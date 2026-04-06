import { logAdminEvent } from '../../lib/server/admin-events.js';
import { sendPaymentReminderEmail } from '../../lib/server/email.js';
import { sendPaymentReminderSms } from '../../lib/server/sms.js';
import { ApiError, sendError } from '../../lib/server/lib.js';
import { buildCustomerKey } from '../../lib/server/customers.js';
import { createCustomerInteraction } from '../../lib/server/customer-interactions.js';
import { deleteRows, selectRows, updateRows } from '../../lib/server/supabase.js';

const PAGE_SIZE = 200;
const OVERDUE_HOURS = 24;
const REPEAT_HOURS = 24;

function requireCronSecret(req) {
  const configured = process.env.CRON_SECRET;
  if (!configured) {
    throw new ApiError(500, 'CRON_SECRET n\'est pas configuré.');
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== configured) {
    throw new ApiError(401, 'Accès cron non autorisé.');
  }
}

function hoursAgoIso(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function shouldRemind(payment) {
  if (!payment.customer_email) return false;

  const lastReminderAt = payment.metadata?.last_reminder_at;
  if (!lastReminderAt) return true;

  const last = new Date(lastReminderAt).getTime();
  if (!Number.isFinite(last)) return true;

  return last <= Date.now() - REPEAT_HOURS * 60 * 60 * 1000;
}

async function collectOverduePayments() {
  const cutoff = hoursAgoIso(OVERDUE_HOURS);
  let offset = 0;
  const results = [];

  while (true) {
    const rows = await selectRows('payments', {
      filters: {
        status: 'eq.pending_review',
        created_at: `lte.${cutoff}`,
        is_test: 'eq.false',
      },
      order: 'created_at.asc',
      limit: PAGE_SIZE,
      offset,
    });

    const batch = Array.isArray(rows) ? rows : [];
    if (batch.length === 0) break;

    results.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += batch.length;
  }

  return results;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée. Utilisez GET ou POST.' });
  }

  try {
    requireCronSecret(req);

    // Nettoyage des données rate limiting et logs obsolètes
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    await Promise.all([
      deleteRows('rate_limit_requests', { filters: { created_at: `lte.${twoHoursAgo}` } }).catch(() => {}),
      deleteRows('email_logs', { filters: { created_at: `lte.${ninetyDaysAgo}` } }).catch(() => {}),
      deleteRows('sms_logs', { filters: { created_at: `lte.${ninetyDaysAgo}` } }).catch(() => {}),
    ]);

    const overduePayments = await collectOverduePayments();
    let processed = 0;
    let reminded = 0;
    let skipped = 0;

    for (const payment of overduePayments) {
      processed += 1;

      if (!shouldRemind(payment)) {
        skipped += 1;
        continue;
      }

      const reminderRecord = {
        entityType: 'payment',
        reference: payment.reference,
        status: payment.status,
        paymentType: payment.payment_type,
        customerName: payment.customer_full_name,
        customerEmail: payment.customer_email,
        customerPhone: payment.customer_phone,
        label: payment.label,
        amountKmf: payment.amount_kmf,
        operator: payment.operator,
        clientReference: payment.client_reference,
      };
      await Promise.all([
        sendPaymentReminderEmail(reminderRecord),
        sendPaymentReminderSms(reminderRecord),
      ]);

      await updateRows('payments', {
        metadata: {
          ...(payment.metadata || {}),
          last_reminder_at: new Date().toISOString(),
          reminder_count: Number(payment.metadata?.reminder_count || 0) + 1,
        },
      }, {
        filters: { reference: `eq.${payment.reference}` },
      });

      const reminderCount = Number(payment.metadata?.reminder_count || 0) + 1;
      const customerKey = buildCustomerKey(payment.customer_email, payment.customer_phone);

      await Promise.all([
        logAdminEvent({
          entityType: 'payment',
          entityReference: payment.reference,
          action: 'reminder',
          actorLabel: 'system',
          fromStatus: payment.status,
          toStatus: payment.status,
          note: 'Relance automatique pour paiement en retard.',
          metadata: {
            source: payment.source,
            reminder_count: reminderCount,
          },
        }),
        customerKey ? createCustomerInteraction({
          customerKey,
          channel: 'email',
          direction: 'outbound',
          summary: `Relance automatique paiement (${reminderCount}ème)`,
          content: `Relance cron pour paiement ${payment.reference} toujours en attente.`,
          relatedEntityType: 'payment',
          relatedEntityReference: payment.reference,
          createdByRole: 'system',
          isTest: payment.is_test,
        }) : Promise.resolve(),
      ]);

      reminded += 1;
    }

    return res.status(200).json({
      success: true,
      processed,
      reminded,
      skipped,
      overdue: overduePayments.length,
    });
  } catch (error) {
    return sendError(res, error);
  }
}
