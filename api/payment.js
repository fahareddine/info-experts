/**
 * api/payment.js — Vercel Serverless Function
 * Route : POST /api/payment
 *
 * Reçoit une demande de paiement mobile money (Huri / MVola / Telma)
 * et retourne un statut "pending".
 *
 * Statuts possibles :
 *   pending   → demande reçue, vérification en cours (aujourd'hui)
 *   validated → paiement confirmé (à brancher manuellement ou via API future)
 *   failed    → paiement échoué ou non trouvé
 */

export default async function handler(req, res) {
  // ── CORS ────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée. Utilisez POST.' });
  }

  // ── Lecture du body ──────────────────────────────────────────────────────
  const { nom, telephone, operateur, montant, service, referenceClient } = req.body ?? {};

  // ── Validation ───────────────────────────────────────────────────────────
  if (!nom?.trim()) {
    return res.status(400).json({ error: 'Le champ "nom" est requis.' });
  }
  if (!telephone?.trim()) {
    return res.status(400).json({ error: 'Le champ "telephone" est requis.' });
  }
  if (!operateur) {
    return res.status(400).json({ error: 'L\'opérateur est requis (Huri, MVola, Telma).' });
  }

  // ── Génération de la référence ───────────────────────────────────────────
  const timestamp = Date.now().toString(36).toUpperCase();
  const random   = Math.random().toString(36).substr(2, 4).toUpperCase();
  const ref      = `IE-${timestamp}-${random}`;

  // ── Construction de la demande ───────────────────────────────────────────
  const demande = {
    ref,
    status:           'pending',
    nom:              nom.trim(),
    telephone:        telephone.trim(),
    operateur:        operateur.trim(),
    montant:          Number(montant) || 0,
    service:          service?.trim()          || 'non précisé',
    referenceClient:  referenceClient?.trim()  || null,
    createdAt:        new Date().toISOString(),
  };

  // ── Stockage temporaire ──────────────────────────────────────────────────
  // Les logs sont visibles dans : Vercel Dashboard > projet > Logs (onglet Functions)
  console.log('[PAYMENT_REQUEST]', JSON.stringify(demande));

  // ── TODO : Stockage persistant (à brancher selon le besoin) ─────────────
  //
  // Option A — Supabase (recommandé, gratuit jusqu'à 500 MB) :
  //   import { createClient } from '@supabase/supabase-js';
  //   const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  //   await supabase.from('payments').insert(demande);
  //
  // Option B — Airtable (tableau de bord no-code) :
  //   await fetch(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE}/Paiements`, {
  //     method: 'POST',
  //     headers: { Authorization: `Bearer ${process.env.AIRTABLE_KEY}`, 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ fields: demande }),
  //   });
  //
  // Option C — Notification email admin via Resend :
  //   import { Resend } from 'resend';
  //   const resend = new Resend(process.env.RESEND_API_KEY);
  //   await resend.emails.send({
  //     from: 'no-reply@info-experts.fr',
  //     to:   'contact@info-experts.fr',
  //     subject: `[Info Experts] Nouveau paiement ${ref}`,
  //     html: `<p>Nom : ${demande.nom}<br>Téléphone : ${demande.telephone}<br>Opérateur : ${demande.operateur}<br>Montant : ${demande.montant} KMF<br>Service : ${demande.service}</p>`,
  //   });

  // ── TODO : Intégration API mobile money (KartaPay ou autre) ─────────────
  //
  // if (process.env.KARTAPAY_KEY) {
  //   const kp = await fetch('https://api.kartapay.com/v1/payments', {
  //     method: 'POST',
  //     headers: {
  //       Authorization:  `Bearer ${process.env.KARTAPAY_KEY}`,
  //       'Content-Type': 'application/json',
  //     },
  //     body: JSON.stringify({
  //       phone:     demande.telephone,
  //       amount:    demande.montant,
  //       currency:  'KMF',
  //       reference: ref,
  //       operator:  demande.operateur, // 'huri' | 'mvola' | 'telma'
  //     }),
  //   });
  //   const kpData = await kp.json();
  //   demande.status      = kpData.status;           // 'pending' | 'validated' | 'failed'
  //   demande.externalRef = kpData.transaction_id;
  // }

  // ── Réponse ──────────────────────────────────────────────────────────────
  return res.status(200).json({
    status:  'pending',
    ref:     demande.ref,
    message: 'Votre demande est enregistrée. Notre équipe vérifie le paiement sous 15 minutes.',
  });
}
