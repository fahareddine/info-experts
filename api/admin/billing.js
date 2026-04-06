import { requireAdmin } from '../../lib/server/admin.js';
import { ApiError, sendError } from '../../lib/server/lib.js';
import {
  listDocuments, getDocument, createDocument, updateDocument,
  deleteDocument, updateStatus, convertToInvoice, logDocumentAction,
  listClients, getClient, saveClient, deleteClient, generateDocNumber,
} from '../../lib/server/billing.js';
import { generateBillingPdf } from '../../lib/server/billing-pdf.js';
import { updateRows } from '../../lib/server/supabase.js';

// sendEmail is not exported from email.js directly — we call Resend ourselves here
async function sendBillingEmail({ to, subject, html, attachments = [] }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[BILLING EMAIL] RESEND_API_KEY non configurée — email ignoré');
    return;
  }
  const from = process.env.EMAIL_FROM || 'noreply@info-experts.fr';
  const payload = { from, to: [].concat(to), subject, html };
  if (attachments.length > 0) payload.attachments = attachments;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new ApiError(502, `Erreur d'envoi email: HTTP ${response.status}: ${errorText}`);
  }

  return response.json().catch(() => ({}));
}

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtKmf(amount) {
  return `${Number(amount || 0).toLocaleString('fr-FR')} KMF`;
}

function docTypeLabel(type) {
  if (type === 'invoice') return 'Facture';
  if (type === 'proforma') return 'Pro Forma';
  if (type === 'reminder') return 'Relance';
  return type || 'Document';
}

function buildEmailHtml(document, customMessage) {
  const typeLabel = docTypeLabel(document.doc_type);
  const clientName = document.client_name || 'Client';
  const intro = customMessage
    ? esc(customMessage).replace(/\n/g, '<br>')
    : `Veuillez trouver ci-joint votre ${typeLabel.toLowerCase()} ${esc(document.doc_number)}.`;

  return `<!DOCTYPE html><html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
    <div style="background:#1e3a8a;padding:20px 28px">
      <div style="font-size:20px;font-weight:800;color:#fff">Info<span style="color:#93c5fd">Experts</span></div>
      <div style="font-size:12px;color:#bfdbfe;margin-top:4px">Moroni, Comores — info-experts.fr</div>
    </div>
    <div style="padding:24px 28px">
      <p style="margin:0 0 6px;font-size:16px;font-weight:800;color:#111827">Bonjour ${esc(clientName)},</p>
      <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.6">${intro}</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:16px">
        <tr>
          <td style="padding:8px 12px;background:#f8fafc;font-weight:600;color:#6b7280;font-size:12px;border-bottom:1px solid #e5e7eb">Type</td>
          <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #e5e7eb">${esc(typeLabel)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;background:#f8fafc;font-weight:600;color:#6b7280;font-size:12px;border-bottom:1px solid #e5e7eb">Numéro</td>
          <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #e5e7eb"><strong style="font-family:monospace;background:#e5e7eb;padding:2px 8px;border-radius:4px">${esc(document.doc_number)}</strong></td>
        </tr>
        <tr>
          <td style="padding:8px 12px;background:#f8fafc;font-weight:600;color:#6b7280;font-size:12px;border-bottom:1px solid #e5e7eb">Montant TTC</td>
          <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #e5e7eb"><strong>${esc(fmtKmf(document.total_kmf))}</strong></td>
        </tr>
        ${document.due_date ? `<tr>
          <td style="padding:8px 12px;background:#f8fafc;font-weight:600;color:#6b7280;font-size:12px">Échéance</td>
          <td style="padding:8px 12px;font-size:13px">${esc(document.due_date)}</td>
        </tr>` : ''}
      </table>
      <div style="padding:12px 16px;background:#f0fdf4;border-radius:8px;font-size:13px;color:#166534">
        Le document PDF est joint à cet email. Pour toute question, contactez-nous au <strong>+269 331 27 22</strong>.
      </div>
    </div>
    <div style="padding:14px 28px;background:#f8fafc;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center">
      Info Experts · Moroni, Comores ·
      <a href="https://info-experts.fr" style="color:#1e3a8a">info-experts.fr</a> ·
      <a href="tel:+2693312722" style="color:#1e3a8a">+269 331 27 22</a>
    </div>
  </div>
</body></html>`;
}

function defaultEmailSubject(document) {
  const num = document.doc_number || '';
  if (document.doc_type === 'invoice') return `Votre facture ${num} — Info Experts`;
  if (document.doc_type === 'proforma') return `Votre devis / pro forma ${num} — Info Experts`;
  if (document.doc_type === 'reminder') return `Relance de paiement ${num} — Info Experts`;
  return `Document ${num} — Info Experts`;
}

function pdfFilename(document) {
  const num = (document.doc_number || 'doc').replace(/[^a-zA-Z0-9-]/g, '-');
  if (document.doc_type === 'invoice') return `facture-${num}.pdf`;
  if (document.doc_type === 'proforma') return `proforma-${num}.pdf`;
  if (document.doc_type === 'reminder') return `relance-${num}.pdf`;
  return `document-${num}.pdf`;
}

export default async function handler(req, res) {
  try {
    const session = requireAdmin(req);
    const action = String(req.query?.action || '').trim();
    const isManager = session.role === 'manager';

    // ── GET endpoints ───────────────────────────────────────────────────────

    if (action === 'list-documents') {
      if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET requis.' });
      const docs = await listDocuments({
        type: req.query.type || '',
        status: req.query.status || '',
        search: req.query.search || '',
        limit: Math.min(Number(req.query.limit || 100), 500),
        offset: Number(req.query.offset || 0),
      });
      return res.status(200).json({ success: true, documents: docs });
    }

    if (action === 'get-document') {
      if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET requis.' });
      const doc = await getDocument(req.query.id);
      return res.status(200).json({ success: true, document: doc });
    }

    if (action === 'generate-pdf') {
      if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET requis.' });
      const doc = await getDocument(req.query.id);
      const pdfBuffer = await generateBillingPdf(doc, doc.items || []);
      const filename = pdfFilename(doc);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      return res.status(200).send(pdfBuffer);
    }

    if (action === 'list-clients') {
      if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET requis.' });
      const clients = await listClients({
        search: req.query.search || '',
        limit: Math.min(Number(req.query.limit || 100), 500),
      });
      return res.status(200).json({ success: true, clients });
    }

    if (action === 'get-client') {
      if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET requis.' });
      const client = await getClient(req.query.id);
      return res.status(200).json({ success: true, client });
    }

    if (action === 'next-number') {
      if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET requis.' });
      const type = String(req.query.type || 'invoice');
      return res.status(200).json({ success: true, number: generateDocNumber(type) });
    }

    // ── POST endpoints (manager only) ────────────────────────────────────────

    if (action === 'create-document') {
      if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST requis.' });
      if (!isManager) throw new ApiError(403, 'Droits manager requis.');
      const doc = await createDocument(req.body || {});
      return res.status(200).json({ success: true, document: doc });
    }

    if (action === 'update-document') {
      if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST requis.' });
      if (!isManager) throw new ApiError(403, 'Droits manager requis.');
      const body = req.body || {};
      const doc = await updateDocument(body.id, body);
      return res.status(200).json({ success: true, document: doc });
    }

    if (action === 'delete-document') {
      if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST requis.' });
      if (!isManager) throw new ApiError(403, 'Droits manager requis.');
      await deleteDocument(req.body?.id);
      return res.status(200).json({ success: true });
    }

    if (action === 'update-status') {
      if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST requis.' });
      if (!isManager) throw new ApiError(403, 'Droits manager requis.');
      const body = req.body || {};
      const doc = await updateStatus(body.id, body.status);
      return res.status(200).json({ success: true, document: doc });
    }

    if (action === 'convert-to-invoice') {
      if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST requis.' });
      if (!isManager) throw new ApiError(403, 'Droits manager requis.');
      const invoice = await convertToInvoice(req.body?.id);
      return res.status(200).json({ success: true, document: invoice });
    }

    if (action === 'send-document') {
      if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST requis.' });
      if (!isManager) throw new ApiError(403, 'Droits manager requis.');

      const body = req.body || {};
      const doc = await getDocument(body.id);

      if (!doc.client_email) {
        throw new ApiError(400, 'Aucune adresse email client renseignée sur ce document.');
      }

      const pdfBuffer = await generateBillingPdf(doc, doc.items || []);
      const filename = pdfFilename(doc);
      const subject = body.emailSubject || defaultEmailSubject(doc);
      const html = buildEmailHtml(doc, body.emailMessage || null);

      await sendBillingEmail({
        to: doc.client_email,
        subject,
        html,
        attachments: [{ filename, content: pdfBuffer.toString('base64') }],
      });

      // Update sent counters
      await updateRows('billing_documents', {
        email_sent_count: (doc.email_sent_count || 0) + 1,
        last_sent_at: new Date().toISOString(),
        status: doc.status === 'draft' ? 'sent' : doc.status,
      }, { filters: { id: `eq.${doc.id}` } });

      await logDocumentAction(doc.id, 'email_sent', `Email envoyé à ${doc.client_email}: ${subject}`);

      return res.status(200).json({ success: true, message: `Email envoyé à ${doc.client_email}` });
    }

    if (action === 'save-client') {
      if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST requis.' });
      if (!isManager) throw new ApiError(403, 'Droits manager requis.');
      const client = await saveClient(req.body || {});
      return res.status(200).json({ success: true, client });
    }

    if (action === 'delete-client') {
      if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST requis.' });
      if (!isManager) throw new ApiError(403, 'Droits manager requis.');
      await deleteClient(req.body?.id);
      return res.status(200).json({ success: true });
    }

    throw new ApiError(400, 'Action inconnue.');
  } catch (error) {
    return sendError(res, error);
  }
}
