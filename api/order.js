/**
 * api/order.js — backend metier boutique + rendez-vous
 */

import { sendAdminEmail, sendClientEmail } from '../lib/server/email.js';
import { sendAppointmentSms, sendOrderSms } from '../lib/server/sms.js';
import {
  ApiError,
  BOUTIQUE_OPERATORS,
  applyCors,
  assertOneOf,
  durationToMinutes,
  generateReference,
  integerAmount,
  normalizeDateInput,
  normalizeTimeInput,
  optionalEmail,
  optionalPhone,
  optionalString,
  requiredString,
  sendError,
  splitFullName,
} from '../lib/server/lib.js';
import { buildCustomerKey, isTestRecord, touchCustomerProfile } from '../lib/server/customers.js';
import { createCustomerInteraction } from '../lib/server/customer-interactions.js';
import { insertRow, selectRows } from '../lib/server/supabase.js';
import { checkRateLimit } from '../lib/server/rate-limit.js';

const ACTIVE_APPOINTMENT_STATUSES = '(confirmed,payment_submitted,cash_reserved)';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée. Utilisez POST.' });
  }

  try {
    await checkRateLimit(req, 'order');
    const body = req.body ?? {};
    const source = assertOneOf(requiredString(body.source || 'boutique', 'source', 30), ['boutique', 'booking'], 'source');

    const record = source === 'booking'
      ? await createAppointment(body)
      : await createOrder(body);

    await Promise.all([
      sendAdminEmail(record),
      sendClientEmail(record),
      record.entityType === 'order' ? sendOrderSms(record) : sendAppointmentSms(record),
    ]).catch((error) => console.error('[NOTIF] Erreur globale:', error.message));

    return res.status(200).json({
      success: true,
      entity: record.entityType,
      ref: record.reference,
      status: record.status,
      message: successMessage(record),
    });
  } catch (error) {
    return sendError(res, error);
  }
}

function successMessage(record) {
  if (record.entityType === 'appointment') {
    if (record.paymentType === 'free') {
      return 'Votre rendez-vous est confirmé.';
    }
    if (record.paymentType === 'cash') {
      return 'Votre rendez-vous est réservé. Le paiement en espèces sera finalisé lors du rendez-vous.';
    }
    return 'Votre rendez-vous est réservé. Notre équipe vérifie le paiement mobile.';
  }

  if (record.paymentType === 'cash') {
    return 'Votre commande est enregistrée. Vous réglerez en espèces lors de la remise.';
  }

  return 'Votre commande est enregistrée. Notre équipe vérifie le paiement mobile.';
}

async function createOrder(body) {
  const type = assertOneOf(requiredString(body.type, 'type', 40), ['mobile_payment', 'cash_payment'], 'type');
  const customerName = requiredString(body.nom, 'nom', 160);
  const customerPhone = optionalPhone(body.telephone, true);
  const customerEmail = optionalEmail(body.email);
  const productName = requiredString(body.produit, 'produit', 200);
  const amountKmf = integerAmount(body.montant, 'montant');
  const paymentType = type === 'mobile_payment' ? 'mobile_money' : 'cash';
  const status = type === 'mobile_payment' ? 'payment_submitted' : 'cash_reserved';
  const operator = type === 'mobile_payment'
    ? assertOneOf(requiredString(body.operateur, 'operateur', 50), BOUTIQUE_OPERATORS, 'operateur')
    : null;
  const clientReference = optionalString(body.referenceClient, 120);
  const reference = generateReference(type === 'mobile_payment' ? 'IE-ORD-MOB' : 'IE-ORD-CASH');
  const isTest = isTestRecord({ customerName, customerEmail, customerPhone, label: productName, reference });
  const customerKey = buildCustomerKey(customerEmail, customerPhone);

  if (!isTest) {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const duplicateFilters = { created_at: `gte.${tenMinutesAgo}`, product_name: `eq.${productName}`, is_test: 'eq.false' };
    if (customerEmail) duplicateFilters.customer_email = `eq.${customerEmail}`;
    else if (customerPhone) duplicateFilters.customer_phone = `eq.${customerPhone}`;
    const recent = await selectRows('orders', { select: 'id', filters: duplicateFilters, limit: 1 });
    if (Array.isArray(recent) && recent.length > 0) {
      throw new ApiError(409, 'Une commande identique a déjà été soumise récemment. Veuillez patienter avant de réessayer.');
    }
  }

  const order = await insertRow('orders', {
    reference,
    source: 'boutique',
    status,
    payment_type: paymentType,
    product_name: productName,
    amount_kmf: amountKmf,
    customer_full_name: customerName,
    customer_email: customerEmail,
    customer_phone: customerPhone,
    payment_operator: operator,
    payment_reference: clientReference,
    is_test: isTest,
    metadata: {
      channel: 'website',
    },
  });

  await insertRow('payments', {
    reference: generateReference(type === 'mobile_payment' ? 'IE-PAY-MOB' : 'IE-PAY-CASH'),
    source: 'boutique',
    status: type === 'mobile_payment' ? 'pending_review' : 'cash_reserved',
    payment_type: paymentType,
    order_id: order.id,
    label: productName,
    amount_kmf: amountKmf,
    customer_full_name: customerName,
    customer_email: customerEmail,
      customer_phone: customerPhone,
      operator,
      client_reference: clientReference,
      is_test: isTest,
      metadata: {
        order_reference: reference,
      },
    });

  await Promise.all([
    touchCustomerProfile({
      customerName,
      customerEmail,
      customerPhone,
      kind: 'order',
      isTest,
    }),
    touchCustomerProfile({
      customerName,
      customerEmail,
      customerPhone,
      kind: 'payment',
      isTest,
    }),
    createCustomerInteraction({
      customerKey,
      channel: 'website',
      direction: 'inbound',
      summary: `Nouvelle commande boutique: ${productName}`,
      content: `Mode de paiement: ${paymentType}. Montant: ${amountKmf} KMF.`,
      relatedEntityType: 'order',
      relatedEntityReference: reference,
      createdByRole: 'system',
      isTest,
    }),
  ]);

  return {
    entityType: 'order',
    source: 'boutique',
    reference,
    status,
    paymentType,
    customerName,
    customerEmail,
    customerPhone,
    label: productName,
    amountKmf,
    operator,
    clientReference,
    createdAt: order.created_at,
  };
}

async function createAppointment(body) {
  const type = assertOneOf(requiredString(body.type, 'type', 40), ['free_booking', 'mobile_payment', 'cash_payment'], 'type');

  const customerName = requiredString(body.nom, 'nom', 160);
  const customer = splitFullName(customerName);
  const customerEmail = optionalEmail(body.email, true);
  const customerPhone = optionalPhone(body.telephone, type !== 'free_booking');
  const serviceName = requiredString(body.produit || body.serviceName, 'serviceName', 200);
  const serviceDurationMinutes = durationToMinutes(body.serviceDurationMinutes ?? body.serviceDuration);
  const servicePriceKmf = integerAmount(body.servicePriceKmf ?? body.totalMontant ?? body.servicePrice ?? 0, 'servicePriceKmf');
  const depositAmountKmf = integerAmount(body.montant ?? body.depositAmount ?? 0, 'montant');
  const appointmentDate = normalizeDateInput(body.appointmentDate);
  const appointmentTime = normalizeTimeInput(body.appointmentTime);
  const appointmentTimezone = optionalString(body.appointmentTimezone, 80) || 'Indian/Comoro';
  const technicianName = requiredString(body.technicianName, 'technicianName', 120);
  const location = requiredString(body.location, 'location', 200);
  const notes = optionalString(body.notes, 4000);

  const paymentType = type === 'free_booking'
    ? 'free'
    : type === 'mobile_payment'
      ? 'mobile_money'
      : 'cash';
  const status = type === 'free_booking'
    ? 'confirmed'
    : type === 'mobile_payment'
      ? 'payment_submitted'
      : 'cash_reserved';
  const operator = type === 'mobile_payment'
    ? assertOneOf(requiredString(body.operateur, 'operateur', 50), BOUTIQUE_OPERATORS, 'operateur')
    : null;
  const clientReference = optionalString(body.referenceClient, 120);
  const customerKey = buildCustomerKey(customerEmail, customerPhone);
  const isTest = isTestRecord({
    customerName: customer.fullName,
    customerEmail,
    customerPhone,
    label: serviceName,
    reference: clientReference,
    notes,
  });

  const existing = await selectRows('appointments', {
    select: 'id,reference,status',
    filters: {
      appointment_date: `eq.${appointmentDate}`,
      appointment_time: `eq.${appointmentTime}`,
      technician_name: `eq.${technicianName}`,
      status: `in.${ACTIVE_APPOINTMENT_STATUSES}`,
    },
    limit: 1,
  });

  if (Array.isArray(existing) && existing.length > 0) {
    throw new ApiError(409, 'Ce creneau vient d\'etre reserve. Merci de choisir un autre horaire.');
  }

  const reference = generateReference(type === 'free_booking' ? 'IE-RDV-FREE' : type === 'mobile_payment' ? 'IE-RDV-MOB' : 'IE-RDV-CASH');

  let appointment;
  try {
    appointment = await insertRow('appointments', {
      reference,
      source: 'booking',
      status,
      payment_type: paymentType,
      service_name: serviceName,
      service_duration_minutes: serviceDurationMinutes,
      service_price_kmf: servicePriceKmf,
      deposit_amount_kmf: depositAmountKmf,
      appointment_date: appointmentDate,
      appointment_time: appointmentTime,
      appointment_timezone: appointmentTimezone,
      technician_name: technicianName,
      location,
      customer_first_name: customer.firstName,
      customer_last_name: customer.lastName,
      customer_full_name: customer.fullName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      notes,
      payment_operator: operator,
      payment_reference: clientReference,
      is_test: isTest,
      metadata: {
        channel: 'website',
      },
    });
  } catch (error) {
    if (error.code === '23505') {
      throw new ApiError(409, 'Ce creneau vient d\'etre reserve. Merci de choisir un autre horaire.');
    }
    throw error;
  }

  if (paymentType !== 'free') {
    await insertRow('payments', {
      reference: generateReference(type === 'mobile_payment' ? 'IE-PAY-RDV-MOB' : 'IE-PAY-RDV-CASH'),
      source: 'booking',
      status: type === 'mobile_payment' ? 'pending_review' : 'cash_reserved',
      payment_type: paymentType,
      appointment_id: appointment.id,
      label: serviceName,
      amount_kmf: depositAmountKmf,
      customer_full_name: customer.fullName,
      customer_email: customerEmail,
        customer_phone: customerPhone || null,
        operator,
        client_reference: clientReference,
        is_test: isTest,
        metadata: {
          appointment_reference: reference,
          total_service_price_kmf: servicePriceKmf,
        },
      });
    }

  await touchCustomerProfile({
    customerName: customer.fullName,
    customerEmail,
    customerPhone,
    kind: 'appointment',
    isTest,
  });

  if (paymentType !== 'free') {
    await touchCustomerProfile({
      customerName: customer.fullName,
      customerEmail,
      customerPhone,
      kind: 'payment',
      isTest,
    });
  }

  await createCustomerInteraction({
    customerKey,
    channel: 'website',
    direction: 'inbound',
    summary: `Nouveau rendez-vous: ${serviceName}`,
    content: `Créneau: ${appointmentDate} ${appointmentTime}. Technicien: ${technicianName}. Paiement: ${paymentType}.`,
    relatedEntityType: 'appointment',
    relatedEntityReference: reference,
    createdByRole: 'system',
    isTest,
  });

  return {
    entityType: 'appointment',
    source: 'booking',
    reference,
    status,
    paymentType,
    customerName: customer.fullName,
    customerEmail,
    customerPhone,
    label: serviceName,
    amountKmf: depositAmountKmf,
    operator,
    clientReference,
    appointmentDate,
    appointmentTime,
    appointmentTimezone,
    technicianName,
    location,
    notes,
    createdAt: appointment.created_at,
  };
}
