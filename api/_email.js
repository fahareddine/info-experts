/**
 * api/_email.js — Helper envoi email via Resend REST API
 * Préfixe _ : Vercel n'expose pas ce fichier comme une route
 * Pas de dépendance npm — fetch natif Node 18+
 */

const RESEND_API = 'https://api.resend.com/emails';

async function sendEmail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[EMAIL] RESEND_API_KEY non configurée — email ignoré');
    return;
  }
  const from = process.env.EMAIL_FROM || 'noreply@info-experts.fr';
  try {
    const r = await fetch(RESEND_API, {
      method:  'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ from, to: [].concat(to), subject, html }),
    });
    if (!r.ok) {
      console.error('[EMAIL] Erreur Resend', r.status, await r.text());
    } else {
      console.log('[EMAIL] Envoyé →', [].concat(to).join(', '));
    }
  } catch (e) {
    console.error('[EMAIL] Exception:', e.message);
  }
}

function fmtDate(iso) {
  try {
    // UTC+3 (Indian/Comoro)
    const d = new Date(new Date(iso).getTime() + 3 * 3600_000);
    return d.toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' }) + ' (heure Comores)';
  } catch { return iso; }
}

function fmtMontant(m) {
  return Number(m).toLocaleString('fr-FR') + ' KMF';
}

// ── Template commun : en-tête et pied ────────────────────────────────────────
function wrap(inner) {
  return `<!DOCTYPE html><html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
    <div style="background:#1e3a8a;padding:24px 28px">
      <div style="font-size:20px;font-weight:800;color:#fff">Info<span style="color:#93c5fd">Experts</span></div>
      <div style="font-size:12px;color:#bfdbfe;margin-top:4px">Moroni, Comores — info-experts.fr</div>
    </div>
    ${inner}
    <div style="padding:14px 28px;background:#f8fafc;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center">
      Info Experts · Moroni, Comores ·
      <a href="https://info-experts.fr" style="color:#1e3a8a">info-experts.fr</a> ·
      <a href="tel:+26933127 22" style="color:#1e3a8a">+269 331 27 22</a>
    </div>
  </div>
</body></html>`;
}

function tableRow(label, value) {
  return `<tr>
    <td style="padding:8px 12px;background:#f8fafc;font-weight:600;color:#6b7280;white-space:nowrap;border-bottom:1px solid #e5e7eb;font-size:12px">${label}</td>
    <td style="padding:8px 12px;color:#111827;border-bottom:1px solid #e5e7eb;font-size:13px">${value}</td>
  </tr>`;
}

// ── Email Admin ───────────────────────────────────────────────────────────────
export function sendAdminEmail(commande) {
  const admin       = process.env.EMAIL_TO || 'contact@info-experts.fr';
  const sourceLabel = commande.source === 'booking' ? 'Rendez-vous' : 'Boutique';
  const typeLabel   = commande.type   === 'cash_payment' ? 'Espèces' : 'Mobile money';
  const subject     = `[Info Experts] Nouvelle demande ${sourceLabel} — ${commande.nom}`;

  const rows = [
    tableRow('Type',             sourceLabel),
    tableRow('Mode de paiement', typeLabel),
    commande.operateur       ? tableRow('Opérateur',       commande.operateur) : '',
    tableRow('Nom',              commande.nom),
    tableRow('Téléphone',        commande.telephone),
    commande.email           ? tableRow('Email',           `<a href="mailto:${commande.email}" style="color:#1e3a8a">${commande.email}</a>`) : '',
    tableRow('Service / Produit', commande.produit || commande.service || 'non précisé'),
    commande.montant         ? tableRow('Montant',         fmtMontant(commande.montant)) : '',
    commande.referenceClient ? tableRow('Réf. transaction', commande.referenceClient) : '',
    tableRow('Référence IE',     `<strong style="font-family:monospace;background:#e5e7eb;padding:2px 8px;border-radius:4px">${commande.ref}</strong>`),
    tableRow('Date',             fmtDate(commande.createdAt)),
  ].filter(Boolean).join('');

  const html = wrap(`
    <div style="padding:24px 28px">
      <p style="margin:0 0 16px;color:#374151;font-size:14px">
        🔔 Une nouvelle demande a été enregistrée sur <strong>info-experts.fr</strong>.
      </p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        ${rows}
      </table>
      <div style="margin-top:16px;padding:12px 16px;background:#eff6ff;border-radius:8px;font-size:13px;color:#1e3a8a">
        Contactez le client au <strong>${commande.telephone}</strong>
        ${commande.email ? ` ou par email : <a href="mailto:${commande.email}" style="color:#1e3a8a">${commande.email}</a>` : ''}.
      </div>
    </div>`);

  return sendEmail({ to: admin, subject, html });
}

// ── Email Client ──────────────────────────────────────────────────────────────
export function sendClientEmail(commande) {
  if (!commande.email) return Promise.resolve();

  const isBooking = commande.source === 'booking';
  const isMobile  = commande.type   === 'mobile_payment';
  const subject   = isBooking
    ? 'Confirmation de votre rendez-vous — Info Experts'
    : 'Confirmation de votre commande — Info Experts';

  const numBlock = isMobile && commande.operateur ? (() => {
    const num = commande.operateur === 'Huri Money' ? '+269 331 27 22' : '+269 469 93 20';
    return `<div style="margin:14px 0;padding:14px 16px;background:#f0f7ff;border:1.5px solid #bfdbfe;border-radius:10px">
      <div style="font-size:11px;font-weight:800;color:#1e3a8a;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">
        📱 Numéro ${commande.operateur}
      </div>
      <div style="font-size:20px;font-weight:900;color:#1e3a8a;letter-spacing:.04em">${num}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:5px">
        Envoyez <strong>${fmtMontant(commande.montant)}</strong> à ce numéro si ce n'est pas encore fait.
      </div>
    </div>`;
  })() : '';

  const modeInfo = isMobile
    ? 'Nous allons vérifier votre paiement et vous confirmer sous <strong>15 minutes</strong>.'
    : `Vous réglez en espèces lors du ${isBooking ? 'rendez-vous' : 'retrait en boutique à Moroni'}.`;

  const html = wrap(`
    <div style="padding:24px 28px">
      <p style="margin:0 0 6px;font-size:16px;font-weight:800;color:#111827">Bonjour ${commande.nom},</p>
      <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.6">
        ${isBooking ? 'Votre rendez-vous a bien été enregistré.' : 'Votre commande a bien été reçue.'}
        ${modeInfo}
      </p>

      <div style="background:#f9fafb;border-radius:10px;padding:14px 16px;font-size:13px;margin-bottom:14px;border:1px solid #e5e7eb">
        <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f3f4f6">
          <span style="color:#6b7280">${isBooking ? 'Service' : 'Produit'}</span>
          <span style="font-weight:600;color:#111827">${commande.produit || commande.service || 'non précisé'}</span>
        </div>
        ${commande.montant ? `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f3f4f6">
          <span style="color:#6b7280">Montant</span>
          <span style="font-weight:700;color:#1e3a8a">${fmtMontant(commande.montant)}</span>
        </div>` : ''}
        <div style="display:flex;justify-content:space-between;padding:5px 0">
          <span style="color:#6b7280">Référence</span>
          <span style="font-family:monospace;font-weight:700;background:#e5e7eb;padding:2px 8px;border-radius:4px;font-size:11px">${commande.ref}</span>
        </div>
      </div>

      ${numBlock}

      <div style="padding:12px 16px;background:#f0fdf4;border-radius:8px;font-size:13px;color:#166534">
        ✅ Merci pour votre confiance. Nous vous contacterons au <strong>${commande.telephone}</strong> si besoin.
      </div>
    </div>`);

  return sendEmail({ to: commande.email, subject, html });
}
