/**
 * SMS transactionnels via Twilio REST API
 * Variables d'env requises : TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
 */

import { insertRow } from './supabase.js';

function logSms({ to, body, entityReference, smsType, status, errorMessage, twilioSid }) {
  insertRow('sms_logs', {
    to_number: to,
    body,
    entity_reference: entityReference || null,
    sms_type: smsType || null,
    status,
    error_message: errorMessage || null,
    twilio_sid: twilioSid || null,
  }).catch((err) => console.warn('[SMS LOG] Impossible d\'enregistrer:', err.message));
}

async function sendSms({ to, body, smsType, entityReference }) {
  if (!to) return;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const from       = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !from) {
    console.warn('[SMS] Twilio non configuré — SMS ignoré');
    logSms({ to, body, entityReference, smsType, status: 'skipped', errorMessage: 'Twilio non configuré' });
    return;
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const params = new URLSearchParams();
    params.set('From', from);
    params.set('To', to);
    params.set('Body', body);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('[SMS] Erreur Twilio', response.status, err.message || '');
      logSms({ to, body, entityReference, smsType, status: 'failed', errorMessage: `HTTP ${response.status}: ${err.message || ''}` });
      return;
    }

    const result = await response.json().catch(() => ({}));
    console.log('[SMS] Envoyé →', to, '— SID:', result.sid);
    logSms({ to, body, entityReference, smsType, status: 'sent', twilioSid: result.sid });
  } catch (error) {
    console.error('[SMS] Exception:', error.message);
    logSms({ to, body, entityReference, smsType, status: 'failed', errorMessage: error.message });
  }
}

function fmtKmf(amount) {
  return `${Number(amount || 0).toLocaleString('fr-FR')} KMF`;
}

function fmtDate(date, time) {
  if (!date) return '';
  const d = String(date).slice(5).replace('-', '/'); // MM/DD → JJ/MM
  const [month, day] = d.split('/');
  const t = time ? String(time).slice(0, 5) : '';
  return `le ${day}/${month}${t ? ` à ${t}` : ''}`;
}

function truncate(text, max) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

// ─── Notifications client ─────────────────────────────────────────────────────

export function sendOrderSms(record) {
  if (!record.customerPhone || record.isTest) return Promise.resolve();

  const label = truncate(record.label, 40);
  const body = record.paymentType === 'cash'
    ? `Info Experts - Commande reçue (${record.reference}). ${fmtKmf(record.amountKmf)}. Paiement en espèces à la remise. +269 477 78 65`
    : `Info Experts - Commande reçue (${record.reference}). ${fmtKmf(record.amountKmf)}. Vérification en cours. +269 477 78 65`;

  return sendSms({ to: record.customerPhone, body, smsType: 'order_new', entityReference: record.reference });
}

export function sendAppointmentSms(record) {
  if (!record.customerPhone || record.isTest) return Promise.resolve();

  const slot = fmtDate(record.appointmentDate, record.appointmentTime);
  const body = record.paymentType === 'free'
    ? `Info Experts - RDV confirmé (${record.reference}) ${slot}. ${truncate(record.location, 30)}. +269 477 78 65`
    : record.paymentType === 'cash'
      ? `Info Experts - RDV réservé (${record.reference}) ${slot}. Paiement espèces sur place. +269 477 78 65`
      : `Info Experts - RDV reçu (${record.reference}) ${slot}. Vérification paiement en cours. +269 477 78 65`;

  return sendSms({ to: record.customerPhone, body, smsType: 'appointment_new', entityReference: record.reference });
}

export function sendPaymentSms(record) {
  if (!record.customerPhone || record.isTest) return Promise.resolve();

  const body = `Info Experts - Paiement reçu (${record.reference}). ${fmtKmf(record.amountKmf)}. Vérification sous 15 min. +269 477 78 65`;
  return sendSms({ to: record.customerPhone, body, smsType: 'payment_new', entityReference: record.reference });
}

export function sendAppointmentStatusSms(record, action) {
  if (!record.customerPhone) return Promise.resolve();

  const slot = fmtDate(record.appointmentDate, record.appointmentTime);
  const messages = {
    confirm:   `Info Experts - RDV ${record.reference} confirmé ${slot}. Lieu : ${truncate(record.location, 25)}. +269 477 78 65`,
    cancel:    `Info Experts - RDV ${record.reference} annulé. Contactez-nous : +269 477 78 65`,
    complete:  `Info Experts - RDV ${record.reference} terminé. Merci pour votre confiance ! +269 477 78 65`,
  };

  const body = messages[action];
  if (!body) return Promise.resolve();
  return sendSms({ to: record.customerPhone, body, smsType: `appointment_${action}`, entityReference: record.reference });
}

export function sendOrderStatusSms(record, action) {
  if (!record.customerPhone) return Promise.resolve();

  const messages = {
    validate: `Info Experts - Commande ${record.reference} validée. Notre équipe vous contactera pour la remise. +269 477 78 65`,
    cancel:   `Info Experts - Commande ${record.reference} annulée. Contactez-nous : +269 477 78 65`,
    fulfill:  `Info Experts - Commande ${record.reference} remise. Merci pour votre confiance ! +269 477 78 65`,
  };

  const body = messages[action];
  if (!body) return Promise.resolve();
  return sendSms({ to: record.customerPhone, body, smsType: `order_${action}`, entityReference: record.reference });
}

export function sendPaymentReviewSms(record, action) {
  if (!record.customerPhone) return Promise.resolve();

  const body = action === 'validate'
    ? `Info Experts - Paiement ${record.reference} validé. Merci ! +269 477 78 65`
    : `Info Experts - Paiement ${record.reference} non validé. Contactez-nous : +269 477 78 65`;

  return sendSms({ to: record.customerPhone, body, smsType: `payment_review_${action}`, entityReference: record.reference });
}

export function sendPaymentReminderSms(record) {
  if (!record.customerPhone) return Promise.resolve();

  const body = `Info Experts - Rappel : paiement ${record.reference} (${fmtKmf(record.amountKmf)}) toujours en attente. Contactez-nous : +269 477 78 65`;
  return sendSms({ to: record.customerPhone, body, smsType: 'payment_reminder', entityReference: record.reference });
}
