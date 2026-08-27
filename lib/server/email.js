/**
 * Emails transactionnels via Resend REST API
 */

import { formatAppointmentLabel } from './lib.js';
import { insertRow } from './supabase.js';

const RESEND_API = 'https://api.resend.com/emails';
const BANNER_URL = 'https://info-experts.fr/email-banner-opt.jpg';

function logEmailDelivery({ to, subject, emailType, entityReference, status, errorMessage, resendId }) {
  insertRow('email_logs', {
    to_address: [].concat(to).join(','),
    subject,
    email_type: emailType || null,
    entity_reference: entityReference || null,
    status,
    error_message: errorMessage || null,
    resend_id: resendId || null,
  }).catch((err) => console.warn('[EMAIL LOG] Impossible d\'enregistrer:', err.message));
}

async function sendEmail({ to, subject, html, emailType, entityReference, attachments = [] }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[EMAIL] RESEND_API_KEY non configurée — email ignoré');
    logEmailDelivery({ to, subject, emailType, entityReference, status: 'skipped', errorMessage: 'RESEND_API_KEY manquante' });
    return;
  }

  const from = process.env.EMAIL_FROM || 'noreply@info-experts.fr';

  try {
    const payload = { from, to: [].concat(to), subject, html };
    if (attachments.length > 0) payload.attachments = attachments;

    const response = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[EMAIL] Erreur Resend', response.status, errorText);
      logEmailDelivery({ to, subject, emailType, entityReference, status: 'failed', errorMessage: `HTTP ${response.status}: ${errorText}` });
      return;
    }

    const result = await response.json().catch(() => ({}));
    console.log('[EMAIL] Envoyé →', [].concat(to).join(', '));
    logEmailDelivery({ to, subject, emailType, entityReference, status: 'sent', resendId: result?.id });
  } catch (error) {
    console.error('[EMAIL] Exception:', error.message);
    logEmailDelivery({ to, subject, emailType, entityReference, status: 'failed', errorMessage: error.message });
  }
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtMontant(amount) {
  return `${Number(amount || 0).toLocaleString('fr-FR')} KMF`;
}

function fmtCreatedAt(iso) {
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: 'Indian/Comoro',
    }) + ' (heure Comores)';
  } catch {
    return iso || 'non précisé';
  }
}

function paymentTypeLabel(paymentType) {
  switch (paymentType) {
    case 'free':
      return 'Gratuit';
    case 'cash':
      return 'Espèces';
    default:
      return 'Mobile money';
  }
}

function statusLabel(status) {
  switch (status) {
    case 'confirmed':
      return 'Confirmé';
    case 'completed':
      return 'Terminé';
    case 'cancelled':
      return 'Annulé';
    case 'cash_reserved':
      return 'Réservé - espèces';
    case 'payment_submitted':
    case 'pending_review':
      return 'En vérification';
    case 'validated':
      return 'Validé';
    case 'fulfilled':
      return 'Remis au client';
    case 'failed':
      return 'Échoué';
    case 'rejected':
      return 'Rejeté';
    default:
      return esc(status || 'non précisé');
  }
}

function sourceLabel(record) {
  if (record.entityType === 'appointment') return 'Rendez-vous';
  if (record.entityType === 'payment') return 'Paiement';
  return 'Commande boutique';
}

function wrap(inner, showBanner = false) {
  const banner = showBanner ? `
    <div style="width:100%;line-height:0">
      <img src="${BANNER_URL}" alt="Info Experts — Moroni, Comores" width="600"
           style="width:100%;max-width:600px;height:auto;display:block;border:0">
    </div>` : '';

  return `<!DOCTYPE html><html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
    ${banner}
    <div style="background:#1e3a8a;padding:20px 28px">
      <div style="font-size:20px;font-weight:800;color:#fff">Info<span style="color:#93c5fd">Experts</span></div>
      <div style="font-size:12px;color:#bfdbfe;margin-top:4px">Moroni, Comores — info-experts.fr</div>
    </div>
    ${inner}
    <div style="padding:14px 28px;background:#f8fafc;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center">
      Info Experts · Moroni, Comores ·
      <a href="https://info-experts.fr" style="color:#1e3a8a">info-experts.fr</a> ·
      <a href="tel:+2694777865" style="color:#1e3a8a">+269 477 78 65</a>
    </div>
  </div>
</body></html>`;
}

function tableRow(label, value) {
  return `<tr>
    <td style="padding:8px 12px;background:#f8fafc;font-weight:600;color:#6b7280;white-space:nowrap;border-bottom:1px solid #e5e7eb;font-size:12px">${esc(label)}</td>
    <td style="padding:8px 12px;color:#111827;border-bottom:1px solid #e5e7eb;font-size:13px">${value}</td>
  </tr>`;
}

function buildRows(record) {
  const rows = [
    tableRow('Type', esc(sourceLabel(record))),
    tableRow('Référence', `<strong style="font-family:monospace;background:#e5e7eb;padding:2px 8px;border-radius:4px">${esc(record.reference)}</strong>`),
    tableRow('Statut', esc(statusLabel(record.status))),
    tableRow('Mode de paiement', esc(paymentTypeLabel(record.paymentType))),
    tableRow('Client', esc(record.customerName)),
    record.customerEmail ? tableRow('Email', `<a href="mailto:${esc(record.customerEmail)}" style="color:#1e3a8a">${esc(record.customerEmail)}</a>`) : '',
    record.customerPhone ? tableRow('Téléphone', esc(record.customerPhone)) : '',
    tableRow(record.entityType === 'appointment' ? 'Service' : 'Produit / objet', esc(record.label || 'non précisé')),
    typeof record.amountKmf === 'number' ? tableRow('Montant', esc(fmtMontant(record.amountKmf))) : '',
    record.operator ? tableRow('Opérateur', esc(record.operator)) : '',
    record.clientReference ? tableRow('Réf. client', esc(record.clientReference)) : '',
  ];

  if (record.entityType === 'appointment') {
    rows.push(tableRow('Créneau', esc(formatAppointmentLabel(record.appointmentDate, record.appointmentTime, record.appointmentTimezone))));
    rows.push(tableRow('Technicien', esc(record.technicianName || 'non précisé')));
    rows.push(tableRow('Lieu', esc(record.location || 'non précisé')));
    if (record.notes) rows.push(tableRow('Notes', esc(record.notes).replace(/\n/g, '<br>')));
  }

  rows.push(tableRow('Créé le', esc(fmtCreatedAt(record.createdAt))));

  return rows.filter(Boolean).join('');
}

// Supprime les sauts de ligne pour prévenir l'injection d'en-têtes email
function safeSubjectValue(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, 100);
}

function adminSubject(record) {
  const name = safeSubjectValue(record.customerName);
  if (record.entityType === 'appointment') return `[Info Experts] Nouveau rendez-vous — ${name}`;
  if (record.entityType === 'payment') return `[Info Experts] Nouveau paiement — ${name}`;
  return `[Info Experts] Nouvelle commande boutique — ${name}`;
}

function clientSubject(record) {
  if (record.entityType === 'appointment') return 'Confirmation de votre rendez-vous — Info Experts';
  if (record.entityType === 'payment') return 'Confirmation de votre paiement — Info Experts';
  return 'Confirmation de votre commande — Info Experts';
}

function clientIntro(record) {
  if (record.entityType === 'appointment') {
    if (record.paymentType === 'free') return 'Votre rendez-vous est confirmé.';
    if (record.paymentType === 'cash') return 'Votre rendez-vous est pré-réservé. Le paiement en espèces sera finalisé lors du rendez-vous.';
    return 'Votre rendez-vous est réservé. Notre équipe vérifie maintenant votre paiement mobile.';
  }

  if (record.entityType === 'payment') return 'Votre demande de paiement a bien été enregistrée.';
  if (record.paymentType === 'cash') return 'Votre commande boutique est enregistrée. Le paiement en espèces sera effectué lors de la remise.';
  return 'Votre commande boutique est enregistrée. Notre équipe vérifie maintenant votre paiement mobile.';
}

function paymentInstructions(record) {
  if (record.paymentType !== 'mobile_money' || !record.operator) return '';

  const numbers = {
    // Huri Money : réactiver quand le numéro Comores Telecom sera disponible
    MVola: '+269 477 78 65',
    Telma: '+269 362 00 01',
  };

  const number = numbers[record.operator];
  if (!number) return '';

  return `<div style="margin:14px 0;padding:14px 16px;background:#f0f7ff;border:1.5px solid #bfdbfe;border-radius:10px">
    <div style="font-size:11px;font-weight:800;color:#1e3a8a;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">
      Numero ${esc(record.operator)}
    </div>
    <div style="font-size:20px;font-weight:900;color:#1e3a8a;letter-spacing:.04em">${esc(number)}</div>
    <div style="font-size:11px;color:#6b7280;margin-top:5px">
      Montant attendu : <strong>${esc(fmtMontant(record.amountKmf))}</strong>
    </div>
  </div>`;
}

export function sendAdminEmail(record) {
  const admin = process.env.EMAIL_TO || 'contact@info-experts.fr';
  const html = wrap(`
    <div style="padding:24px 28px">
      <p style="margin:0 0 16px;color:#374151;font-size:14px">
        Une nouvelle demande métier a été enregistrée sur <strong>info-experts.fr</strong>.
      </p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        ${buildRows(record)}
      </table>
    </div>`);

  return sendEmail({ to: admin, subject: adminSubject(record), html, emailType: 'admin', entityReference: record.reference });
}

export function sendClientEmail(record) {
  if (!record.customerEmail) return Promise.resolve();

  const detailsRows = [
    tableRow(record.entityType === 'appointment' ? 'Service' : 'Objet', esc(record.label || 'non précisé')),
    typeof record.amountKmf === 'number' ? tableRow('Montant', esc(fmtMontant(record.amountKmf))) : '',
    record.entityType === 'appointment'
      ? tableRow('Créneau', esc(formatAppointmentLabel(record.appointmentDate, record.appointmentTime, record.appointmentTimezone)))
      : '',
    record.entityType === 'appointment' ? tableRow('Technicien', esc(record.technicianName || 'non précisé')) : '',
    record.entityType === 'appointment' ? tableRow('Lieu', esc(record.location || 'non précisé')) : '',
    tableRow('Référence', `<strong style="font-family:monospace;background:#e5e7eb;padding:2px 8px;border-radius:4px">${esc(record.reference)}</strong>`),
  ].filter(Boolean).join('');

  const html = wrap(`
    <div style="padding:24px 28px">
      <p style="margin:0 0 6px;font-size:16px;font-weight:800;color:#111827">Bonjour ${esc(record.customerName)},</p>
      <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.6">
        ${esc(clientIntro(record))}
      </p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:14px">
        ${detailsRows}
      </table>
      ${paymentInstructions(record)}
      <div style="padding:12px 16px;background:#f0fdf4;border-radius:8px;font-size:13px;color:#166534">
        Merci pour votre confiance. Notre équipe vous recontactera${record.customerPhone ? ` au <strong>${esc(record.customerPhone)}</strong>` : ''} si nécessaire.
      </div>
    </div>`, true);

  return sendEmail({ to: record.customerEmail, subject: clientSubject(record), html, emailType: 'client', entityReference: record.reference });
}

export function sendAppointmentStatusEmail(record, action) {
  if (!record?.customerEmail) return Promise.resolve();

  const subject = action === 'confirm'
    ? 'Votre rendez-vous est confirmé — Info Experts'
    : action === 'cancel'
      ? 'Votre rendez-vous a été annulé — Info Experts'
      : 'Votre rendez-vous est terminé — Info Experts';

  const intro = action === 'confirm'
    ? 'Votre rendez-vous est maintenant confirmé par notre équipe.'
    : action === 'cancel'
      ? 'Votre rendez-vous a été annulé par notre équipe. Merci de nous recontacter si vous souhaitez reprogrammer un créneau.'
      : 'Votre rendez-vous est marqué comme terminé. Merci pour votre confiance.';

  const extra = action === 'confirm'
    ? '<div style="padding:12px 16px;background:#eff6ff;border-radius:8px;font-size:13px;color:#1d4ed8">Nous vous attendons au créneau indiqué. Si vous avez une contrainte, répondez à cet email ou contactez-nous au +269 477 78 65.</div>'
    : action === 'cancel'
      ? '<div style="padding:12px 16px;background:#fef2f2;border-radius:8px;font-size:13px;color:#991b1b">Si vous avez déjà réglé un acompte, notre équipe vous recontactera pour finaliser la suite à donner.</div>'
      : '<div style="padding:12px 16px;background:#f0fdf4;border-radius:8px;font-size:13px;color:#166534">N\'hésitez pas à nous laisser un retour ou à reprendre rendez-vous si vous avez un nouveau besoin.</div>';

  const detailsRows = [
    tableRow('Service', esc(record.label || 'non précisé')),
    tableRow('Créneau', esc(formatAppointmentLabel(record.appointmentDate, record.appointmentTime, record.appointmentTimezone))),
    tableRow('Technicien', esc(record.technicianName || 'non précisé')),
    tableRow('Lieu', esc(record.location || 'non précisé')),
    tableRow('Référence', `<strong style="font-family:monospace;background:#e5e7eb;padding:2px 8px;border-radius:4px">${esc(record.reference)}</strong>`),
    tableRow('Statut', esc(statusLabel(record.status))),
  ].join('');

  const html = wrap(`
    <div style="padding:24px 28px">
      <p style="margin:0 0 6px;font-size:16px;font-weight:800;color:#111827">Bonjour ${esc(record.customerName)},</p>
      <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.6">${esc(intro)}</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:14px">
        ${detailsRows}
      </table>
      ${extra}
    </div>`, true);

  return sendEmail({ to: record.customerEmail, subject, html, emailType: `status_appointment_${action}`, entityReference: record.reference });
}

export function sendOrderStatusEmail(record, action) {
  if (!record?.customerEmail) return Promise.resolve();

  const subject = action === 'validate'
    ? 'Votre commande est validée — Info Experts'
    : action === 'cancel'
      ? 'Votre commande a été annulée — Info Experts'
      : 'Votre commande est prête / remise — Info Experts';

  const intro = action === 'validate'
    ? 'Votre commande est maintenant validée par notre équipe.'
    : action === 'cancel'
      ? 'Votre commande a été annulée. Merci de nous recontacter si vous souhaitez repasser commande.'
      : 'Votre commande est marquée comme remise au client.';

  const extra = action === 'validate'
    ? '<div style="padding:12px 16px;background:#eff6ff;border-radius:8px;font-size:13px;color:#1d4ed8">Notre équipe vous contactera pour confirmer les modalités de retrait ou de finalisation.</div>'
    : action === 'cancel'
      ? '<div style="padding:12px 16px;background:#fef2f2;border-radius:8px;font-size:13px;color:#991b1b">Si vous avez déjà effectué un paiement, notre équipe reviendra vers vous rapidement.</div>'
      : '<div style="padding:12px 16px;background:#f0fdf4;border-radius:8px;font-size:13px;color:#166534">Merci pour votre confiance. Nous restons disponibles si vous avez besoin d\'un autre équipement.</div>';

  const detailsRows = [
    tableRow('Produit', esc(record.label || 'non précisé')),
    typeof record.amountKmf === 'number' ? tableRow('Montant', esc(fmtMontant(record.amountKmf))) : '',
    tableRow('Référence', `<strong style="font-family:monospace;background:#e5e7eb;padding:2px 8px;border-radius:4px">${esc(record.reference)}</strong>`),
    tableRow('Statut', esc(statusLabel(record.status))),
  ].filter(Boolean).join('');

  const html = wrap(`
    <div style="padding:24px 28px">
      <p style="margin:0 0 6px;font-size:16px;font-weight:800;color:#111827">Bonjour ${esc(record.customerName)},</p>
      <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.6">${esc(intro)}</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:14px">
        ${detailsRows}
      </table>
      ${extra}
    </div>`, true);

  return sendEmail({ to: record.customerEmail, subject, html, emailType: `status_order_${action}`, entityReference: record.reference });
}

export function sendPaymentReviewEmail(record, action) {
  if (!record?.customerEmail) return Promise.resolve();

  const subject = action === 'validate'
    ? 'Votre paiement a été validé — Info Experts'
    : 'Votre paiement a été rejeté — Info Experts';

  const intro = action === 'validate'
    ? 'Votre paiement a bien été validé par notre équipe.'
    : 'Votre paiement n\'a pas pu être validé pour le moment.';

  const extra = action === 'validate'
    ? '<div style="padding:12px 16px;background:#f0fdf4;border-radius:8px;font-size:13px;color:#166534">Merci. Votre dossier peut maintenant être traité normalement par notre équipe.</div>'
    : '<div style="padding:12px 16px;background:#fef2f2;border-radius:8px;font-size:13px;color:#991b1b">Merci de vérifier la référence transmise ou de nous contacter au +269 477 78 65 pour assistance.</div>';

  const detailsRows = [
    tableRow('Objet', esc(record.label || 'non précisé')),
    typeof record.amountKmf === 'number' ? tableRow('Montant', esc(fmtMontant(record.amountKmf))) : '',
    record.operator ? tableRow('Opérateur', esc(record.operator)) : '',
    record.clientReference ? tableRow('Référence client', esc(record.clientReference)) : '',
    tableRow('Référence', `<strong style="font-family:monospace;background:#e5e7eb;padding:2px 8px;border-radius:4px">${esc(record.reference)}</strong>`),
    tableRow('Statut', esc(statusLabel(record.status))),
  ].filter(Boolean).join('');

  const html = wrap(`
    <div style="padding:24px 28px">
      <p style="margin:0 0 6px;font-size:16px;font-weight:800;color:#111827">Bonjour ${esc(record.customerName)},</p>
      <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.6">${esc(intro)}</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:14px">
        ${detailsRows}
      </table>
      ${extra}
    </div>`, true);

  return sendEmail({ to: record.customerEmail, subject, html, emailType: `payment_review_${action}`, entityReference: record.reference });
}

export function sendPaymentReminderEmail(record) {
  if (!record?.customerEmail) return Promise.resolve();

  const detailsRows = [
    tableRow('Objet', esc(record.label || 'non précisé')),
    typeof record.amountKmf === 'number' ? tableRow('Montant', esc(fmtMontant(record.amountKmf))) : '',
    record.operator ? tableRow('Opérateur', esc(record.operator)) : '',
    record.clientReference ? tableRow('Référence client', esc(record.clientReference)) : '',
    tableRow('Référence', `<strong style="font-family:monospace;background:#e5e7eb;padding:2px 8px;border-radius:4px">${esc(record.reference)}</strong>`),
  ].filter(Boolean).join('');

  const html = wrap(`
    <div style="padding:24px 28px">
      <p style="margin:0 0 6px;font-size:16px;font-weight:800;color:#111827">Bonjour ${esc(record.customerName)},</p>
      <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.6">
        Votre paiement est toujours en attente de validation. Si vous avez déjà effectué le règlement, merci d'ignorer ce message. Sinon, merci de nous transmettre la bonne référence ou de reprendre contact avec notre équipe.
      </p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:14px">
        ${detailsRows}
      </table>
      <div style="padding:12px 16px;background:#fff7ed;border-radius:8px;font-size:13px;color:#9a3412">
        Besoin d'aide ? Contactez Info Experts au <strong>+269 477 78 65</strong> pour finaliser rapidement votre dossier.
      </div>
    </div>`, true);

  return sendEmail({ to: record.customerEmail, subject: 'Relance paiement en attente — Info Experts', html, emailType: 'payment_reminder', entityReference: record.reference });
}

export function sendInvoiceEmail(record, pdfBuffer) {
  if (!record?.customerEmail || !pdfBuffer) return Promise.resolve();

  const filename = `facture-${record.invoiceNumber || record.reference}.pdf`;

  const detailsRows = [
    tableRow(record.entityType === 'appointment' ? 'Service' : 'Produit / Objet', esc(record.label || 'non précisé')),
    typeof record.amountKmf === 'number' ? tableRow('Montant réglé', `<strong>${esc(fmtMontant(record.amountKmf))}</strong>`) : '',
    record.operator ? tableRow('Opérateur', esc(record.operator)) : '',
    tableRow('N° Facture', `<strong style="font-family:monospace;background:#e5e7eb;padding:2px 8px;border-radius:4px">${esc(record.invoiceNumber)}</strong>`),
    tableRow('Référence paiement', `<span style="font-family:monospace;font-size:12px;color:#6b7280">${esc(record.reference)}</span>`),
  ].filter(Boolean).join('');

  const html = wrap(`
    <div style="padding:24px 28px">
      <p style="margin:0 0 6px;font-size:16px;font-weight:800;color:#111827">Bonjour ${esc(record.customerName)},</p>
      <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.6">
        Votre paiement a bien été validé. Veuillez trouver ci-joint votre facture acquittée.
      </p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:14px">
        ${detailsRows}
      </table>
      <div style="padding:12px 16px;background:#f0fdf4;border-radius:8px;font-size:13px;color:#166534;margin-bottom:12px">
        ✓ Paiement confirmé — Facture acquittée jointe en PDF
      </div>
      <div style="padding:12px 16px;background:#f8fafc;border-radius:8px;font-size:12px;color:#6b7280">
        Conservez cette facture pour vos archives. Pour toute question, contactez-nous au <strong>+269 477 78 65</strong> ou par email à <strong>contact@info-experts.fr</strong>.
      </div>
    </div>`, true);

  return sendEmail({
    to: record.customerEmail,
    subject: `Votre facture ${record.invoiceNumber} — Info Experts`,
    html,
    emailType: 'invoice',
    entityReference: record.reference,
    attachments: [
      {
        content: pdfBuffer.toString('base64'),
        filename,
      },
    ],
  });
}
