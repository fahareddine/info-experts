/**
 * api/order.js — Vercel Serverless Function
 * Route : POST /api/order
 *
 * Gère deux types de demandes :
 *   type = "mobile_payment"  → paiement mobile money depuis la boutique ou la prise de RDV
 *   type = "cash_payment"    → choix de paiement en espèces
 *
 * Opérateurs mobiles acceptés : Huri Money | MVola
 *
 * Statuts du cycle de vie :
 *   mobile_payment_submitted → formulaire mobile soumis, en attente confirmation
 *   cash_selected            → client a choisi le paiement en espèces
 *   validated                → paiement confirmé (manuellement ou API future)
 *   rejected                 → paiement échoué ou annulé
 */

import { sendAdminEmail, sendClientEmail } from './_email.js';

const OPERATEURS_VALIDES = ['Huri Money', 'MVola'];
const PHONE_RE = /^[+\d\s().-]{6,20}$/;

export default async function handler(req, res) {
  // ── CORS ────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée. Utilisez POST.' });
  }

  const {
    type,            // 'mobile_payment' | 'cash_payment'
    nom,
    telephone,
    email,           // email client (optionnel)
    produit,         // nom du produit ou du service RDV
    montant,
    operateur,       // 'Huri Money' | 'MVola'  (mobile seulement)
    referenceClient, // référence transaction mobile (optionnel)
    source,          // 'boutique' | 'booking'
  } = req.body ?? {};

  // ── Validation commune ───────────────────────────────────────────────────
  if (!type || !['mobile_payment', 'cash_payment'].includes(type)) {
    return res.status(400).json({ success: false, error: 'type invalide. Valeurs acceptées : mobile_payment, cash_payment.' });
  }
  if (!nom?.trim()) {
    return res.status(400).json({ success: false, error: 'Le champ "nom" est requis.' });
  }
  if (!telephone?.trim()) {
    return res.status(400).json({ success: false, error: 'Le champ "telephone" est requis.' });
  }
  if (!PHONE_RE.test(telephone.trim())) {
    return res.status(400).json({ success: false, error: 'Numéro de téléphone invalide.' });
  }

  // ── Validation spécifique mobile ─────────────────────────────────────────
  if (type === 'mobile_payment') {
    if (!operateur || !OPERATEURS_VALIDES.includes(operateur)) {
      return res.status(400).json({ success: false, error: `Opérateur invalide. Valeurs acceptées : ${OPERATEURS_VALIDES.join(', ')}.` });
    }
  }

  // ── Référence unique ─────────────────────────────────────────────────────
  const prefix    = type === 'cash_payment' ? 'IE-CASH' : 'IE-MOB';
  const timestamp = Date.now().toString(36).toUpperCase();
  const random    = Math.random().toString(36).substr(2, 4).toUpperCase();
  const ref       = `${prefix}-${timestamp}-${random}`;

  // ── Construction de la commande ──────────────────────────────────────────
  const commande = {
    ref,
    type,
    status:          type === 'cash_payment' ? 'cash_selected' : 'mobile_payment_submitted',
    nom:             nom.trim(),
    telephone:       telephone.trim(),
    email:           email?.trim()           || null,
    produit:         produit?.trim()         || 'non précisé',
    montant:         Number(montant)         || 0,
    operateur:       operateur?.trim()       || null,
    referenceClient: referenceClient?.trim() || null,
    source:          source?.trim()          || 'boutique',
    createdAt:       new Date().toISOString(),
  };

  // ── Log (visible dans Vercel Dashboard > Logs) ───────────────────────────
  console.log('[ORDER]', JSON.stringify(commande));

  // ── Emails (admin + client) — non bloquants ──────────────────────────────
  Promise.all([
    sendAdminEmail(commande),
    sendClientEmail(commande),
  ]).catch(e => console.error('[EMAIL] Erreur globale:', e.message));

  // ── TODO : Stockage persistant ───────────────────────────────────────────
  //
  // Option A — Supabase :
  //   const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  //   await supabase.from('orders').insert(commande);
  //
  // Option B — Airtable :
  //   await fetch(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE}/Commandes`, {
  //     method: 'POST',
  //     headers: { Authorization: `Bearer ${process.env.AIRTABLE_KEY}`, 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ fields: commande }),
  //   });
  //
  // Option C — Notification email admin (Resend) :
  //   const subject = type === 'cash_payment'
  //     ? `[Espèces] ${commande.produit} — ${commande.nom}`
  //     : `[Mobile] ${commande.produit} — ${commande.nom}`;
  //   await resend.emails.send({ from:'no-reply@info-experts.fr', to:'contact@info-experts.fr', subject, html: '...' });

  // ── TODO : Validation automatique (API mobile money future) ─────────────
  //
  // if (type === 'mobile_payment' && process.env.KARTAPAY_KEY) {
  //   const kp = await fetch('https://api.kartapay.com/v1/payments', {
  //     method: 'POST',
  //     headers: { Authorization: `Bearer ${process.env.KARTAPAY_KEY}`, 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ phone: commande.telephone, amount: commande.montant, currency: 'KMF', reference: ref, operator: operateur.toLowerCase() }),
  //   });
  //   const kpData = await kp.json();
  //   commande.status      = kpData.status;        // 'validated' | 'pending' | 'rejected'
  //   commande.externalRef = kpData.transaction_id;
  // }

  // ── Réponse ──────────────────────────────────────────────────────────────
  const messages = {
    mobile_payment: 'Votre demande est enregistrée. Notre équipe vérifie le paiement sous 15 minutes.',
    cash_payment:   'Votre commande est enregistrée. Vous réglerez en espèces lors de la remise.',
  };

  return res.status(200).json({
    success: true,
    status:  commande.status,
    ref:     commande.ref,
    message: messages[type],
  });
}
