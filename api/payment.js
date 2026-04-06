/**
 * api/payment.js — paiement mobile standalone persiste en base
 */

import { sendAdminEmail, sendClientEmail } from '../lib/server/email.js';
import { sendPaymentSms } from '../lib/server/sms.js';
import {
  STANDALONE_PAYMENT_OPERATORS,
  ApiError,
  applyCors,
  assertOneOf,
  generateReference,
  integerAmount,
  optionalEmail,
  optionalPhone,
  optionalString,
  requiredString,
  sendError,
} from '../lib/server/lib.js';
import { buildCustomerKey, isTestRecord, touchCustomerProfile } from '../lib/server/customers.js';
import { createCustomerInteraction } from '../lib/server/customer-interactions.js';
import { insertRow, selectRows } from '../lib/server/supabase.js';
import { checkRateLimit } from '../lib/server/rate-limit.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée. Utilisez POST.' });
  }

  try {
    await checkRateLimit(req, 'payment');
    const body = req.body ?? {};
    const customerName = requiredString(body.nom, 'nom', 160);
    const customerPhone = optionalPhone(body.telephone, true);
    const customerEmail = optionalEmail(body.email);
    const operator = assertOneOf(requiredString(body.operateur, 'operateur', 30), STANDALONE_PAYMENT_OPERATORS, 'operateur');
    const amountKmf = integerAmount(body.montant, 'montant');
    const label = requiredString(body.service || body.label || 'Prestation Info Experts', 'service', 200);
    const clientReference = optionalString(body.referenceClient, 120);
    const reference = generateReference('IE-PAY-WEB');
    const isTest = isTestRecord({ customerName, customerEmail, customerPhone, label, reference, notes: clientReference });
    const customerKey = buildCustomerKey(customerEmail, customerPhone);

    if (!isTest) {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const dupFilters = { created_at: `gte.${tenMinutesAgo}`, source: 'eq.standalone', label: `eq.${label}`, is_test: 'eq.false' };
      if (customerEmail) dupFilters.customer_email = `eq.${customerEmail}`;
      else if (customerPhone) dupFilters.customer_phone = `eq.${customerPhone}`;
      const recent = await selectRows('payments', { select: 'id', filters: dupFilters, limit: 1 });
      if (Array.isArray(recent) && recent.length > 0) {
        throw new ApiError(409, 'Une demande identique a déjà été soumise récemment. Veuillez patienter avant de réessayer.');
      }
    }

    const payment = await insertRow('payments', {
      reference,
      source: 'standalone',
      status: 'pending_review',
      payment_type: 'mobile_money',
      label,
      amount_kmf: amountKmf,
      customer_full_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      operator,
      client_reference: clientReference,
      is_test: isTest,
      metadata: {
        channel: 'payment_page',
      },
    });

    await touchCustomerProfile({
      customerName,
      customerEmail,
      customerPhone,
      kind: 'payment',
      isTest,
    });

    await createCustomerInteraction({
      customerKey,
      channel: 'website',
      direction: 'inbound',
      summary: `Nouveau paiement standalone: ${label}`,
      content: `Opérateur: ${operator}. Montant: ${amountKmf} KMF.`,
      relatedEntityType: 'payment',
      relatedEntityReference: reference,
      createdByRole: 'system',
      isTest,
    });

    const record = {
      entityType: 'payment',
      source: 'standalone',
      reference,
      status: 'pending_review',
      paymentType: 'mobile_money',
      customerName,
      customerEmail,
      customerPhone,
      label,
      amountKmf,
      operator,
      clientReference,
      createdAt: payment.created_at,
    };

    await Promise.all([
      sendAdminEmail(record),
      sendClientEmail(record),
      sendPaymentSms(record),
    ]).catch((error) => console.error('[NOTIF] Erreur globale:', error.message));

    return res.status(200).json({
      success: true,
      status: 'pending_review',
      ref: reference,
      message: 'Votre demande est enregistrée. Notre équipe vérifie le paiement sous 15 minutes.',
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return sendError(res, error);
    }
    return sendError(res, error);
  }
}
