/**
 * Génération PDF — Info Experts
 * Pagination intelligente : sauts de page uniquement si nécessaire,
 * sans espaces vides. Hauteurs calculées dynamiquement.
 */

import PDFDocument from 'pdfkit';

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  blue:        '#1e3a8a',
  blueLight:   '#eff6ff',
  bluePale:    '#dbeafe',
  blueText:    '#93c5fd',
  dark:        '#0f172a',
  gray:        '#64748b',
  grayLight:   '#f8fafc',
  line:        '#e2e8f0',
  green:       '#16a34a',
  greenLight:  '#f0fdf4',
  greenBorder: '#bbf7d0',
  red:         '#dc2626',
  redLight:    '#fef2f2',
  redBorder:   '#fecaca',
  amber:       '#d97706',
  amberLight:  '#fff7ed',
  amberBorder: '#fed7aa',
  white:       '#ffffff',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtNum(n)    { return String(Math.round(Number(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function fmtKmf(n)    { return `${fmtNum(n)} KMF`; }
function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(String(iso).slice(0, 10) + 'T12:00:00Z')
    .toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric' }); }
  catch { return String(iso).slice(0, 10); }
}
function payLabel(m) {
  return { especes:'Espèces', virement:'Virement bancaire', mvola:'MVola',
           huri:'Huri Money', cheque:'Chèque', mobile_money:'Mobile Money',
           cash:'Espèces' }[m] || m || 'Non précisé';
}
function statusLabel(s) {
  return { draft:'Brouillon', ready:'Prêt', sent:'Envoyé', paid:'Payé',
           partial:'Partiel', overdue:'En retard', cancelled:'Annulé',
           accepted:'Accepté', expired:'Expiré', converted:'Converti' }[s] || s || '';
}
function reminderLabel(l) {
  return { friendly:'Relance amiable', firm:'Rappel ferme', final:'Dernière relance' }[l] || l || '';
}
function daysSince(d) {
  if (!d) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000));
}

// ── Primitives de dessin ──────────────────────────────────────────────────────
function fillR(p, x, y, w, h, c)          { p.save().rect(x,y,w,h).fill(c).restore(); }
function strokeR(p, x, y, w, h, c, lw=1) { p.save().rect(x,y,w,h).lineWidth(lw).stroke(c).restore(); }
function hLine(p, x1, x2, y, c)          { p.save().moveTo(x1,y).lineTo(x2,y).lineWidth(1).strokeColor(c).stroke().restore(); }
function vLine(p, x, y1, y2, c)          { p.save().moveTo(x,y1).lineTo(x,y2).lineWidth(1).strokeColor(c).stroke().restore(); }

// Texte avec wrapping automatique
function txt(p, text, x, y, w, { font='Helvetica', fs=9, color=C.dark, align='left', pad=6 } = {}) {
  p.font(font).fontSize(fs).fillColor(color)
   .text(String(text ?? ''), x+pad, y+pad, { width: w-pad*2, align, lineBreak: true });
}
// Texte sans wrapping (montants, labels courts)
function txtLine(p, text, x, y, w, opts = {}) {
  const { font='Helvetica', fs=9, color=C.dark, align='left', pad=6 } = opts;
  p.font(font).fontSize(fs).fillColor(color)
   .text(String(text ?? ''), x+pad, y+pad, { width: w-pad*2, align, lineBreak: false });
}
// Mesure la hauteur d'un texte pour une largeur donnée
function txtH(p, text, w, font, fs) {
  p.font(font).fontSize(fs);
  return p.heightOfString(String(text ?? ''), { width: w });
}

// ── Conversion montant en lettres (français) ──────────────────────────────────
function montantEnLettres(n) {
  const UNITS = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
    'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize',
    'dix-sept', 'dix-huit', 'dix-neuf'];

  function dizaine(n) {
    if (n < 20) return UNITS[n];
    const t = Math.floor(n / 10), u = n % 10;
    if (t === 7) return u === 1 ? 'soixante et onze' : 'soixante-' + UNITS[10 + u];
    if (t === 8) return u === 0 ? 'quatre-vingts' : 'quatre-vingt-' + UNITS[u];
    if (t === 9) return 'quatre-vingt-' + UNITS[10 + u];
    const lien = (u === 1 && t !== 8) ? ' et ' : (u > 0 ? '-' : '');
    const dizaines = ['','','vingt','trente','quarante','cinquante','soixante'];
    return dizaines[t] + (u > 0 ? lien + UNITS[u] : '');
  }

  function centaine(n) {
    if (n < 100) return dizaine(n);
    const h = Math.floor(n / 100), r = n % 100;
    const hMot = h === 1 ? 'cent' : UNITS[h] + ' cent';
    return r === 0 ? (h === 1 ? 'cent' : UNITS[h] + ' cents') : hMot + ' ' + dizaine(r);
  }

  const num = Math.round(Number(n || 0));
  if (num === 0) return 'zéro franc comorien';

  const millions  = Math.floor(num / 1000000);
  const milliers  = Math.floor((num % 1000000) / 1000);
  const reste     = num % 1000;
  const parts     = [];

  if (millions > 0)  parts.push(millions === 1 ? 'un million'   : centaine(millions)  + ' millions');
  if (milliers > 0)  parts.push(milliers === 1 ? 'mille'        : centaine(milliers)  + ' mille');
  if (reste > 0 || parts.length === 0) parts.push(centaine(reste));

  const mot = parts.join(' ');
  const motMaj = mot.charAt(0).toUpperCase() + mot.slice(1);
  return `${motMaj} franc${num > 1 ? 's' : ''} comorien${num > 1 ? 's' : ''}`;
}

// ── Export principal ──────────────────────────────────────────────────────────
export function generateBillingPdf(document, items = []) {
  return new Promise((resolve, reject) => {
    try {
      const type    = document.doc_type || 'invoice';
      const accent  = type === 'reminder' ? C.red : C.blue;
      const TITLES  = { invoice:'FACTURE', proforma:'FACTURE PRO FORMA', reminder:'RELANCE DE PAIEMENT' };
      const title   = TITLES[type] || 'DOCUMENT';

      const pdf = new PDFDocument({ size:'A4', margin:0,
        info:{ Title:`${title} ${document.doc_number||''}`, Author:'Info Experts', Subject:title } });

      const chunks = [];
      pdf.on('data', c => chunks.push(c));
      pdf.on('end',  () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);

      const PW = 595, PH = 842;
      const M  = 46;
      const CW = PW - 2*M;        // 503
      const FOOTER_H = 50;
      const BOTTOM   = PH - FOOTER_H; // 792 — rien ne dépasse cette ligne

      let Y = 0;

      // ── Pagination : saut uniquement si le prochain bloc ne rentre plus ──────
      // Pas de marges conservatrices : on utilise chaque pixel disponible.
      function willOverflow(needed) { return Y + needed > BOTTOM; }

      function breakPage() {
        drawFooter();
        pdf.addPage({ size:'A4', margin:0 });
        // Bandeau de continuité compact (pas de gaspillage d'espace)
        fillR(pdf, 0, 0, PW, 26, accent);
        pdf.font('Helvetica-Bold').fontSize(9).fillColor(C.white)
           .text(`${title}  ${document.doc_number || ''}  (suite)`, M, 9, { width: CW, lineBreak:false });
        Y = 30;
      }

      // ── Footer ───────────────────────────────────────────────────────────────
      function drawFooter() {
        hLine(pdf, M, PW-M, BOTTOM, C.line);
        pdf.font('Helvetica-Bold').fontSize(8).fillColor(C.blue)
           .text('Info Experts', M, BOTTOM+8, { continued:true })
           .font('Helvetica').fillColor(C.gray)
           .text('  ·  Moroni, Comores  ·  contact@info-experts.fr  ·  +269 477 78 65  ·  info-experts.fr');
        pdf.font('Helvetica').fontSize(7.5).fillColor(C.gray)
           .text('Merci pour votre confiance !', M, BOTTOM+22, { width:CW, align:'center' });
      }

      // ════════════════════════════════════════════════════════════════════════
      // 1. HEADER
      // ════════════════════════════════════════════════════════════════════════
      fillR(pdf, 0, 0, PW, 80, accent);
      pdf.font('Helvetica-Bold').fontSize(24).fillColor(C.white)
         .text('Info', M, 21, { continued:true }).fillColor(C.blueText).text('Experts');
      pdf.font('Helvetica').fontSize(8.5).fillColor(C.bluePale)
         .text('Moroni, Comores  ·  info-experts.fr  ·  +269 477 78 65', M, 50);
      pdf.font('Helvetica-Bold').fontSize(type==='proforma'?16:22).fillColor(C.white)
         .text(title, 0, type==='proforma'?28:24, { width:PW-M, align:'right' });
      Y = 86;

      // ════════════════════════════════════════════════════════════════════════
      // 2. BANNIÈRES TYPE (pro forma / relance)
      // ════════════════════════════════════════════════════════════════════════
      if (type === 'proforma') {
        fillR(pdf, 0, Y, PW, 24, C.amber);
        pdf.font('Helvetica-Bold').fontSize(8.5).fillColor(C.white)
           .text('DOCUMENT PRO FORMA — Non contractuel — Ce document est une estimation et ne constitue pas une facture.',
                 M, Y+8, { width:CW, align:'center', lineBreak:false });
        Y += 28;
      }
      if (type === 'reminder') {
        const days = daysSince(document.due_date || document.issue_date);
        const lv   = reminderLabel(document.reminder_level);
        fillR(pdf, 0, Y, PW, 24, C.redLight);
        strokeR(pdf, 0, Y, PW, 24, C.redBorder);
        pdf.font('Helvetica-Bold').fontSize(8.5).fillColor(C.red)
           .text(`PAIEMENT EN RETARD${days>0?` — ${days} jour(s) de retard`:''}${lv?` — ${lv}`:''}`,
                 M, Y+8, { width:CW, align:'center', lineBreak:false });
        Y += 28;
      }

      // ════════════════════════════════════════════════════════════════════════
      // 3. BANDEAU N° / DATE / STATUT
      // ════════════════════════════════════════════════════════════════════════
      const BAND_H = 52;
      fillR(pdf, M, Y, CW, BAND_H, C.blueLight);
      strokeR(pdf, M, Y, CW, BAND_H, C.bluePale);

      const numLbl = type==='invoice'?'N° Facture':type==='proforma'?'N° Pro Forma':'N° Relance';
      pdf.font('Helvetica-Bold').fontSize(8).fillColor(C.blue).text(numLbl, M+10, Y+8);
      pdf.font('Helvetica-Bold').fontSize(12).fillColor(C.dark).text(document.doc_number||'—', M+10, Y+22);

      pdf.font('Helvetica-Bold').fontSize(8).fillColor(C.blue).text("Date d'émission", M+190, Y+8);
      pdf.font('Helvetica').fontSize(10).fillColor(C.dark).text(fmtDate(document.issue_date), M+190, Y+22);

      const dateR = document.due_date || document.validity_date;
      if (dateR) {
        const lbl = type==='proforma'?"Validité jusqu'au":"Échéance";
        pdf.font('Helvetica-Bold').fontSize(8).fillColor(C.blue).text(lbl, M+340, Y+8);
        pdf.font('Helvetica').fontSize(10).fillColor(C.dark).text(fmtDate(dateR), M+340, Y+22);
      }

      // Badge statut
      const bx = PW-M-88;
      let [bgB, brB, fcB] = [C.blueLight, C.bluePale, C.blue];
      if (['paid','accepted'].includes(document.status))               [bgB,brB,fcB]=[C.greenLight,C.greenBorder,C.green];
      else if (['overdue','cancelled','expired'].includes(document.status)) [bgB,brB,fcB]=[C.redLight,C.redBorder,C.red];
      else if (['sent','converted','partial'].includes(document.status))    [bgB,brB,fcB]=[C.amberLight,C.amberBorder,C.amber];
      fillR(pdf, bx, Y+12, 86, 22, bgB);
      strokeR(pdf, bx, Y+12, 86, 22, brB);
      pdf.font('Helvetica-Bold').fontSize(9).fillColor(fcB)
         .text(statusLabel(document.status).toUpperCase(), bx, Y+20, { width:86, align:'center', lineBreak:false });

      Y += BAND_H + 8;

      // ════════════════════════════════════════════════════════════════════════
      // 4. ÉMETTEUR / CLIENT
      // ════════════════════════════════════════════════════════════════════════
      const halfW  = (CW - 12) / 2;
      const PAD    = 6;
      const textW  = halfW - PAD * 2;

      // Lignes émetteur (fixes)
      const emLines = [
        { t:'Info Experts',           f:'Helvetica-Bold', fs:10 },
        { t:'Maintenance informatique',f:'Helvetica',     fs:8.5 },
        { t:'Vente de matériel',       f:'Helvetica',     fs:8.5 },
        { t:'Création de site web',    f:'Helvetica',     fs:8.5 },
        { t:'contact@info-experts.fr', f:'Helvetica',     fs:8.5 },
        { t:'+269 477 78 65',          f:'Helvetica',     fs:8.5 },
        { t:'Moroni, Comores',         f:'Helvetica',     fs:8.5, color:C.gray },
      ];

      // Lignes client (dynamiques selon champs renseignés)
      const clLines = [
        { t: document.client_name || 'Client', f:'Helvetica-Bold', fs:10 },
        document.client_company ? { t:`Société : ${document.client_company}`,  f:'Helvetica', fs:8.5 } : null,
        document.client_email   ? { t:`Email : ${document.client_email}`,      f:'Helvetica', fs:8.5 } : null,
        document.client_phone   ? { t:`Tél : ${document.client_phone}`,        f:'Helvetica', fs:8.5 } : null,
        (document.client_address || document.client_city)
          ? { t:`Adresse : ${[document.client_address, document.client_city, document.client_country].filter(Boolean).join(', ')}`,
              f:'Helvetica', fs:8.5 } : null,
      ].filter(Boolean);

      function linesH(lines) {
        let h = 0;
        lines.forEach((l, i) => { h += txtH(pdf, l.t, textW, l.f, l.fs) + (i===0?6:3); });
        return h;
      }

      const emH  = linesH(emLines);
      const clH  = linesH(clLines);
      const boxH = Math.max(emH, clH) + 18;

      // Pas de saut de page ici : les en-têtes sont toujours proches du haut
      fillR(pdf, M,            Y, halfW, 20, C.blue);
      fillR(pdf, M+halfW+12,   Y, halfW, 20, C.blue);
      txtLine(pdf,'ÉMETTEUR', M,          Y+6, halfW, { font:'Helvetica-Bold', fs:8.5, color:C.white, pad:PAD });
      txtLine(pdf,'CLIENT',   M+halfW+12, Y+6, halfW, { font:'Helvetica-Bold', fs:8.5, color:C.white, pad:PAD });
      Y += 20;

      strokeR(pdf, M,          Y, halfW, boxH, C.line);
      strokeR(pdf, M+halfW+12, Y, halfW, boxH, C.line);

      let ey = Y+8;
      emLines.forEach((l, i) => {
        pdf.font(l.f).fontSize(l.fs).fillColor(l.color || (i===0?C.dark:i<4?C.gray:C.dark))
           .text(l.t, M+PAD, ey, { width:textW, lineBreak:true });
        ey += txtH(pdf, l.t, textW, l.f, l.fs) + (i===0?6:3);
      });

      let cy = Y+8;
      const cx = M+halfW+12;
      clLines.forEach((l, i) => {
        pdf.font(l.f).fontSize(l.fs).fillColor(i===0?C.dark:C.gray)
           .text(l.t, cx+PAD, cy, { width:textW, lineBreak:true });
        cy += txtH(pdf, l.t, textW, l.f, l.fs) + (i===0?6:3);
      });

      Y += boxH + 12;

      // ════════════════════════════════════════════════════════════════════════
      // 5. DOCUMENT LIÉ (relances)
      // ════════════════════════════════════════════════════════════════════════
      if (type === 'reminder' && document.linked_document_number) {
        if (willOverflow(26)) breakPage();
        fillR(pdf, M, Y, CW, 26, C.redLight);
        strokeR(pdf, M, Y, CW, 26, C.redBorder);
        txtLine(pdf, `Facture concernée : ${document.linked_document_number}`,
          M, Y+8, CW*0.6, { font:'Helvetica-Bold', fs:9, color:C.red });
        const days = daysSince(document.due_date);
        if (days > 0) {
          txtLine(pdf, `Retard : ${days} jour(s)`,
            M+CW*0.6, Y+8, CW*0.4, { font:'Helvetica-Bold', fs:9, color:C.red, align:'right' });
        }
        Y += 32;
      }

      // ════════════════════════════════════════════════════════════════════════
      // 6. TABLEAU DES LIGNES — chaque ligne vérifiée individuellement
      // ════════════════════════════════════════════════════════════════════════
      const colDesc  = { x:M,          w:CW*0.52 };
      const colQty   = { x:M+CW*0.52,  w:CW*0.09 };
      const colPrice = { x:M+CW*0.61,  w:CW*0.20 };
      const colTotal = { x:M+CW*0.81,  w:CW*0.19 };
      const descTW   = colDesc.w - 10;

      function drawItemsHeader() {
        if (willOverflow(22)) breakPage();
        fillR(pdf, M, Y, CW, 22, accent);
        txtLine(pdf,'DESCRIPTION',colDesc.x, Y+6,colDesc.w, { font:'Helvetica-Bold',fs:8,color:C.white });
        txtLine(pdf,'QTÉ',        colQty.x,  Y+6,colQty.w,  { font:'Helvetica-Bold',fs:8,color:C.white,align:'center' });
        txtLine(pdf,'PRIX UNIT.', colPrice.x,Y+6,colPrice.w, { font:'Helvetica-Bold',fs:8,color:C.white,align:'right' });
        txtLine(pdf,'TOTAL',      colTotal.x,Y+6,colTotal.w, { font:'Helvetica-Bold',fs:8,color:C.white,align:'right' });
        // Séparateurs verticaux sur l'en-tête (blanc semi-opaque)
        vLine(pdf, colQty.x,   Y, Y+22, 'rgba(255,255,255,0.4)'.replace('rgba(255,255,255,0.4)', C.white));
        vLine(pdf, colPrice.x, Y, Y+22, C.white);
        vLine(pdf, colTotal.x, Y, Y+22, C.white);
        Y += 22;
      }

      drawItemsHeader();

      const rows = Array.isArray(items) && items.length > 0 ? items : [];

      if (rows.length === 0) {
        if (willOverflow(30)) breakPage();
        fillR(pdf, M, Y, CW, 30, C.grayLight);
        strokeR(pdf, M, Y, CW, 30, C.line);
        pdf.font('Helvetica').fontSize(9).fillColor(C.gray)
           .text('Aucune ligne', M, Y+10, { width:CW, align:'center' });
        Y += 30;
      } else {
        rows.forEach((item, idx) => {
          const dsc  = String(item.description || '');
          const det  = String(item.details || '');
          const dH   = txtH(pdf, dsc, descTW-2, 'Helvetica-Bold', 9);
          const dtH  = det ? txtH(pdf, det, descTW-2, 'Helvetica', 8) + 2 : 0;
          const rowH = Math.max(dH + dtH + 14, 28);

          if (willOverflow(rowH)) {
            breakPage();
            drawItemsHeader(); // re-dessiner l'en-tête sur la nouvelle page
          }

          const bg = idx % 2 === 0 ? C.white : C.grayLight;
          fillR(pdf, M, Y, CW, rowH, bg);
          strokeR(pdf, M, Y, CW, rowH, C.line);
          // Séparateurs verticaux entre colonnes
          vLine(pdf, colQty.x,   Y, Y+rowH, C.line);
          vLine(pdf, colPrice.x, Y, Y+rowH, C.line);
          vLine(pdf, colTotal.x, Y, Y+rowH, C.line);

          // Description + détails dans la colonne description
          const vPad = Math.max((rowH - dH - dtH) / 2, 4);
          pdf.font('Helvetica-Bold').fontSize(9).fillColor(C.dark)
             .text(dsc, colDesc.x+5, Y+vPad, { width:descTW, lineBreak:true });
          if (det) {
            pdf.font('Helvetica').fontSize(8).fillColor(C.gray)
               .text(det, colDesc.x+5, Y+vPad+dH+2, { width:descTW, lineBreak:true });
          }

          const midY = Y + (rowH - 10) / 2;
          const qty  = Number(item.quantity);
          const qtyStr = qty % 1 === 0 ? String(Math.round(qty)) : String(qty);
          txtLine(pdf, qtyStr,                    colQty.x,  midY, colQty.w,  { fs:9, align:'center', pad:3 });
          txtLine(pdf, fmtKmf(item.unit_price_kmf),colPrice.x,midY, colPrice.w,{ fs:9, align:'right',  pad:4 });
          txtLine(pdf, fmtKmf(item.total_kmf),     colTotal.x,midY, colTotal.w,{ font:'Helvetica-Bold',fs:9,align:'right',pad:4 });

          Y += rowH;
        });
      }

      Y += 10;

      // ════════════════════════════════════════════════════════════════════════
      // 7. TOTAUX — bloc indivisible (saut avant si pas la place)
      // ════════════════════════════════════════════════════════════════════════
      const hasDiscount = (document.discount_kmf || 0) > 0;
      const hasTax      = (document.tax_kmf || 0) > 0;
      const hasPaid     = (document.paid_kmf || 0) > 0;
      const remaining   = Math.max(0, (document.total_kmf||0) - (document.paid_kmf||0));
      const LH = 19; // line height

      let totH = LH; // sous-total
      if (hasDiscount) totH += LH;
      if (hasTax)      totH += LH;
      totH += 24; // barre TOTAL TTC
      if (hasPaid)     totH += LH * 2;

      if (willOverflow(totH + 10)) breakPage();

      const totW = CW * 0.44;
      const totX = M + CW - totW;

      fillR(pdf, totX, Y, totW, totH, C.grayLight);
      strokeR(pdf, totX, Y, totW, totH, C.line);

      let ty = Y + 4;
      txtLine(pdf,'Sous-total HT',    totX,ty,totW*0.55,{fs:9,color:C.gray,pad:8});
      txtLine(pdf,fmtKmf(document.subtotal_kmf||0),totX,ty,totW,{fs:9,color:C.dark,align:'right',pad:8});
      ty += LH;

      if (hasDiscount) {
        txtLine(pdf,'Remise',          totX,ty,totW*0.55,{fs:9,color:C.gray,pad:8});
        txtLine(pdf,`− ${fmtKmf(document.discount_kmf)}`,totX,ty,totW,{fs:9,color:C.amber,align:'right',pad:8});
        ty += LH;
      }
      if (hasTax) {
        txtLine(pdf,`TVA ${document.tax_rate||0}%`,totX,ty,totW*0.55,{fs:9,color:C.gray,pad:8});
        txtLine(pdf,fmtKmf(document.tax_kmf),totX,ty,totW,{fs:9,color:C.dark,align:'right',pad:8});
        ty += LH;
      }

      fillR(pdf, totX, ty, totW, 24, accent);
      txtLine(pdf,'TOTAL TTC',totX,ty+6,totW*0.55,{font:'Helvetica-Bold',fs:10,color:C.white,pad:8});
      txtLine(pdf,fmtKmf(document.total_kmf||0),totX,ty+6,totW,{font:'Helvetica-Bold',fs:11,color:C.white,align:'right',pad:8});
      ty += 24;

      if (hasPaid) {
        txtLine(pdf,'Déjà réglé',   totX,ty+2,totW*0.55,{fs:9,color:C.green,pad:8});
        txtLine(pdf,`− ${fmtKmf(document.paid_kmf)}`,totX,ty+2,totW,{fs:9,color:C.green,align:'right',pad:8});
        ty += LH;
        txtLine(pdf,'Reste à payer',totX,ty+2,totW*0.55,{font:'Helvetica-Bold',fs:10,color:C.red,pad:8});
        txtLine(pdf,fmtKmf(remaining),totX,ty+2,totW,{font:'Helvetica-Bold',fs:10,color:C.red,align:'right',pad:8});
      }

      Y += totH + 14;

      // ════════════════════════════════════════════════════════════════════════
      // 8. MONTANT EN LETTRES
      // ════════════════════════════════════════════════════════════════════════
      {
        const somme = montantEnLettres(document.total_kmf || 0);
        const sommeW = CW - 20;
        const sommeH = txtH(pdf, somme, sommeW, 'Helvetica-Bold', 9);
        const blockH = sommeH + 22;

        if (willOverflow(blockH + 6)) breakPage();

        fillR(pdf, M, Y, CW, blockH, C.blueLight);
        strokeR(pdf, M, Y, CW, blockH, C.bluePale);
        pdf.font('Helvetica').fontSize(8).fillColor(C.blue)
           .text('Arrêté à la somme de :', M+PAD, Y+6, { continued: true })
           .font('Helvetica-Bold').fillColor(C.dark)
           .text('  ' + somme, { width: sommeW, lineBreak: true });
        Y += blockH + 10;
      }

      // ════════════════════════════════════════════════════════════════════════
      // 9. INFORMATIONS DE PAIEMENT
      // ════════════════════════════════════════════════════════════════════════
      if (document.payment_method || document.payment_reference) {
        let payH = 12 + 14;
        if (document.payment_method)    payH += 15;
        if (document.payment_reference) payH += 15;
        payH += 4;

        if (willOverflow(payH + 6)) breakPage();

        const payW = CW * 0.54;
        fillR(pdf, M, Y, payW, payH, C.blueLight);
        strokeR(pdf, M, Y, payW, payH, C.bluePale);
        pdf.font('Helvetica-Bold').fontSize(8).fillColor(C.blue)
           .text('INFORMATIONS DE PAIEMENT', M+PAD, Y+7);
        let py = Y + 21;
        if (document.payment_method) {
          pdf.font('Helvetica').fontSize(8.5).fillColor(C.gray)
             .text('Mode :', M+PAD, py, { continued:true }).fillColor(C.dark)
             .text('  '+payLabel(document.payment_method));
          py += 15;
        }
        if (document.payment_reference) {
          pdf.font('Helvetica').fontSize(8.5).fillColor(C.gray)
             .text('Réf :', M+PAD, py, { continued:true }).fillColor(C.dark)
             .text('  '+document.payment_reference);
        }
        Y += payH + 10;
      }

      // ════════════════════════════════════════════════════════════════════════
      // 10. MESSAGE CLIENT — hauteur réelle mesurée
      // ════════════════════════════════════════════════════════════════════════
      if (document.message && document.message.trim()) {
        const msgTW = CW - 20;
        const mH    = txtH(pdf, document.message, msgTW, 'Helvetica', 9);
        const blockH = mH + 28; // barre titre + padding

        if (willOverflow(blockH)) breakPage();

        fillR(pdf, M, Y, CW, 16, C.blueLight);
        pdf.font('Helvetica-Bold').fontSize(8).fillColor(C.blue).text('MESSAGE', M+PAD, Y+5);
        Y += 16;
        fillR(pdf, M, Y, CW, mH+12, C.grayLight);
        strokeR(pdf, M, Y, CW, mH+12, C.line);
        pdf.font('Helvetica').fontSize(9).fillColor(C.dark)
           .text(document.message.trim(), M+PAD, Y+6, { width:msgTW, lineBreak:true });
        Y += mH + 18;
      }

      // ════════════════════════════════════════════════════════════════════════
      // 11. NOTE PRO FORMA
      // ════════════════════════════════════════════════════════════════════════
      if (type === 'proforma') {
        const note = 'Ce document pro forma est valable pour la période indiquée. '
          + 'Il ne constitue pas une facture et ne donne pas lieu à paiement. '
          + 'Une facture officielle sera émise après acceptation.';
        const nH = txtH(pdf, note, CW-20, 'Helvetica', 8);
        if (willOverflow(nH + 10)) breakPage();
        pdf.font('Helvetica').fontSize(8).fillColor(C.amber)
           .text(note, M, Y+4, { width:CW, align:'center', lineBreak:true });
        Y += nH + 10;
      }

      // ════════════════════════════════════════════════════════════════════════
      // 12. FOOTER
      // ════════════════════════════════════════════════════════════════════════
      drawFooter();
      pdf.end();

    } catch (err) { reject(err); }
  });
}
