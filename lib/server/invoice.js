/**
 * Génération de factures PDF — Info Experts
 * Librairie : pdfkit (côté serveur uniquement)
 */

import PDFDocument from 'pdfkit';

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  blue:       '#1e3a8a',
  blueMid:    '#2563eb',
  blueLight:  '#eff6ff',
  bluePale:   '#dbeafe',
  blueText:   '#93c5fd',
  dark:       '#0f172a',
  gray:       '#64748b',
  grayLight:  '#f8fafc',
  line:       '#e2e8f0',
  green:      '#16a34a',
  greenLight: '#f0fdf4',
  greenBorder:'#bbf7d0',
  white:      '#ffffff',
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtKmf(amount) {
  return `${Number(amount || 0).toLocaleString('fr-FR')} KMF`;
}

function fmtDateLong(iso) {
  try {
    return new Date(iso || Date.now()).toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'long', year: 'numeric',
      timeZone: 'Indian/Comoro',
    });
  } catch {
    return String(iso || '').slice(0, 10);
  }
}

export function buildInvoiceNumber(paymentReference) {
  const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = String(paymentReference || '').slice(-5).toUpperCase();
  return `INF-${yyyymmdd}-${suffix}`;
}

function paymentTypeLabel(type) {
  if (type === 'mobile_money') return 'Mobile Money';
  if (type === 'cash') return 'Espèces';
  return type || 'Non précisé';
}

function sourceLabel(source) {
  if (source === 'booking')    return 'Rendez-vous';
  if (source === 'boutique')   return 'Boutique en ligne';
  if (source === 'standalone') return 'Paiement en ligne';
  return source || '';
}

// ── Primitives de dessin ─────────────────────────────────────────────────────
function filledRect(doc, x, y, w, h, color) {
  doc.save().rect(x, y, w, h).fill(color).restore();
}

function strokedRect(doc, x, y, w, h, color) {
  doc.save().rect(x, y, w, h).stroke(color).restore();
}

function hLine(doc, x1, x2, y, color) {
  doc.save().moveTo(x1, y).lineTo(x2, y).strokeColor(color).stroke().restore();
}

function cell(doc, text, x, y, w, opts = {}) {
  const {
    font = 'Helvetica', fontSize = 9, color = C.dark,
    align = 'left', padding = 6,
  } = opts;
  doc.font(font).fontSize(fontSize).fillColor(color)
     .text(String(text ?? ''), x + padding, y + padding, {
       width: w - padding * 2,
       align,
       lineBreak: false,
     });
}

// ── Export principal ─────────────────────────────────────────────────────────
export function generateInvoicePdf(record) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 0,
        info: {
          Title:   `Facture ${record.invoiceNumber || ''}`,
          Author:  'Info Experts',
          Subject: 'Facture acquittée',
        },
      });

      const chunks = [];
      doc.on('data',  (c) => chunks.push(c));
      doc.on('end',   () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const PW  = doc.page.width;   // 595
      const PH  = doc.page.height;  // 842
      const M   = 50;               // marge
      const CW  = PW - 2 * M;      // largeur utile : 495
      let   Y   = 0;

      // ── 1. HEADER BLEU ─────────────────────────────────────────────────────
      filledRect(doc, 0, 0, PW, 85, C.blue);

      doc.font('Helvetica-Bold').fontSize(26).fillColor(C.white)
         .text('Info', M, 24, { continued: true })
         .fillColor(C.blueText)
         .text('Experts');

      doc.font('Helvetica').fontSize(9).fillColor(C.bluePale)
         .text('Moroni, Comores  ·  info-experts.fr  ·  +269 477 78 65', M, 56);

      doc.font('Helvetica-Bold').fontSize(30).fillColor(C.white)
         .text('FACTURE', 0, 26, { width: PW - M, align: 'right' });

      Y = 100;

      // ── 2. BANDEAU NUMÉRO / DATE / STATUT ──────────────────────────────────
      filledRect(doc, M, Y, CW, 52, C.blueLight);

      doc.font('Helvetica-Bold').fontSize(10).fillColor(C.blue)
         .text('N° Facture', M + 14, Y + 10);
      doc.font('Helvetica-Bold').fontSize(12).fillColor(C.dark)
         .text(record.invoiceNumber, M + 14, Y + 24);

      doc.font('Helvetica-Bold').fontSize(10).fillColor(C.blue)
         .text('Date', M + 200, Y + 10);
      doc.font('Helvetica').fontSize(10).fillColor(C.dark)
         .text(fmtDateLong(record.createdAt), M + 200, Y + 24);

      // Badge ACQUITTÉ
      filledRect(doc, PW - M - 110, Y + 9, 108, 34, C.greenLight);
      doc.save().rect(PW - M - 110, Y + 9, 108, 34).lineWidth(1.5)
         .stroke(C.greenBorder).restore();
      doc.font('Helvetica-Bold').fontSize(13).fillColor(C.green)
         .text('ACQUITTÉ', PW - M - 110, Y + 20, { width: 108, align: 'center' });

      Y += 68;

      // ── 3. INFOS ENTREPRISE + CLIENT ───────────────────────────────────────
      const halfW = (CW - 16) / 2;

      // En-têtes colonnes
      filledRect(doc, M,              Y, halfW, 22, C.blue);
      filledRect(doc, M + halfW + 16, Y, halfW, 22, C.blue);

      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.white)
         .text('ÉMETTEUR', M + 10, Y + 7)
         .text('CLIENT',   M + halfW + 26, Y + 7);

      Y += 22;
      const boxH = 95;
      strokedRect(doc, M,              Y, halfW, boxH, C.line);
      strokedRect(doc, M + halfW + 16, Y, halfW, boxH, C.line);

      // Entreprise
      let ey = Y + 10;
      doc.font('Helvetica-Bold').fontSize(10).fillColor(C.dark)
         .text('Info Experts', M + 10, ey);
      ey += 16;
      doc.font('Helvetica').fontSize(8.5).fillColor(C.gray);
      ['Maintenance informatique', 'Vente de matériel', 'Création de site web'].forEach((s) => {
        doc.text(s, M + 10, ey); ey += 13;
      });
      ey += 4;
      doc.font('Helvetica').fontSize(8.5).fillColor(C.dark)
         .text('contact@info-experts.fr', M + 10, ey);
      ey += 13;
      doc.text('+269 477 78 65', M + 10, ey);

      // Client
      const cx = M + halfW + 26;
      let cy = Y + 10;
      doc.font('Helvetica-Bold').fontSize(10).fillColor(C.dark)
         .text(record.customerName || 'Client', cx, cy);
      cy += 16;
      if (record.customerEmail) {
        doc.font('Helvetica').fontSize(8.5).fillColor(C.gray)
           .text('Email :', cx, cy, { continued: true })
           .fillColor(C.dark).text('  ' + record.customerEmail);
        cy += 13;
      }
      if (record.customerPhone) {
        doc.font('Helvetica').fontSize(8.5).fillColor(C.gray)
           .text('Tél :', cx, cy, { continued: true })
           .fillColor(C.dark).text('  ' + record.customerPhone);
        cy += 13;
      }

      Y += boxH + 20;

      // ── 4. TABLEAU PRODUITS ─────────────────────────────────────────────────
      const colDesc  = { x: M,           w: CW * 0.46 };
      const colQty   = { x: M + CW*0.46, w: CW * 0.10 };
      const colPrice = { x: M + CW*0.56, w: CW * 0.22 };
      const colTotal = { x: M + CW*0.78, w: CW * 0.22 };

      // En-tête table
      filledRect(doc, M, Y, CW, 24, C.blue);
      const thY = Y + 7;
      cell(doc, 'DESCRIPTION', colDesc.x,  thY, colDesc.w,  { font:'Helvetica-Bold', color:C.white });
      cell(doc, 'QTÉ',         colQty.x,   thY, colQty.w,   { font:'Helvetica-Bold', color:C.white, align:'center' });
      cell(doc, 'PRIX UNIT.',  colPrice.x, thY, colPrice.w, { font:'Helvetica-Bold', color:C.white, align:'right' });
      cell(doc, 'TOTAL',       colTotal.x, thY, colTotal.w, { font:'Helvetica-Bold', color:C.white, align:'right' });

      Y += 24;

      // Ligne produit
      const rowH = 44;
      filledRect(doc, M, Y, CW, rowH, C.grayLight);
      strokedRect(doc, M, Y, CW, rowH, C.line);

      const label = record.label || record.productName || 'Prestation Info Experts';
      cell(doc, label, colDesc.x, Y + 2, colDesc.w,
           { font: 'Helvetica-Bold', fontSize: 10, color: C.dark });
      cell(doc, sourceLabel(record.source), colDesc.x, Y + 20, colDesc.w,
           { font: 'Helvetica', fontSize: 8, color: C.gray });

      cell(doc, '1', colQty.x, Y + 12, colQty.w,
           { font: 'Helvetica', fontSize: 10, color: C.dark, align: 'center' });
      cell(doc, fmtKmf(record.amountKmf), colPrice.x, Y + 12, colPrice.w,
           { font: 'Helvetica', fontSize: 10, color: C.dark, align: 'right' });
      cell(doc, fmtKmf(record.amountKmf), colTotal.x, Y + 12, colTotal.w,
           { font: 'Helvetica-Bold', fontSize: 10, color: C.dark, align: 'right' });

      // Lignes de séparation colonnes
      [colQty.x, colPrice.x, colTotal.x].forEach((x) => {
        hLine(doc, x, x, Y, C.line);
        hLine(doc, x, x, Y + rowH, C.line);
      });

      Y += rowH + 16;

      // ── 5. TOTAUX ────────────────────────────────────────────────────────────
      const totW = CW * 0.44;
      const totX = M + CW - totW;

      filledRect(doc, totX, Y, totW, 64, C.grayLight);
      strokedRect(doc, totX, Y, totW, 64, C.line);

      // Ligne Total HT
      cell(doc, 'Total HT', totX, Y + 6, totW * 0.5,
           { font: 'Helvetica', fontSize: 9, color: C.gray });
      cell(doc, fmtKmf(record.amountKmf), totX, Y + 6, totW,
           { font: 'Helvetica', fontSize: 9, color: C.dark, align: 'right' });

      // Ligne TVA
      cell(doc, 'TVA (0%)', totX, Y + 22, totW * 0.5,
           { font: 'Helvetica', fontSize: 9, color: C.gray });
      cell(doc, '0 KMF', totX, Y + 22, totW,
           { font: 'Helvetica', fontSize: 9, color: C.gray, align: 'right' });

      hLine(doc, totX + 10, totX + totW - 10, Y + 38, C.line);

      // Total TTC
      filledRect(doc, totX, Y + 40, totW, 24, C.blue);
      cell(doc, 'TOTAL TTC', totX, Y + 44, totW * 0.5,
           { font: 'Helvetica-Bold', fontSize: 10, color: C.white });
      cell(doc, fmtKmf(record.amountKmf), totX, Y + 44, totW,
           { font: 'Helvetica-Bold', fontSize: 11, color: C.white, align: 'right' });

      Y += 80;

      // ── 6. PAIEMENT ─────────────────────────────────────────────────────────
      const payW = CW * 0.52;
      const stmpW = CW - payW - 12;

      filledRect(doc, M, Y, payW, 60, C.blueLight);
      strokedRect(doc, M, Y, payW, 60, C.bluePale);

      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.blue)
         .text('INFORMATIONS DE PAIEMENT', M + 10, Y + 10);

      let py = Y + 26;
      doc.font('Helvetica').fontSize(9).fillColor(C.gray)
         .text('Mode :', M + 10, py, { continued: true })
         .fillColor(C.dark).text('  ' + paymentTypeLabel(record.paymentType));
      py += 13;
      if (record.operator) {
        doc.font('Helvetica').fontSize(9).fillColor(C.gray)
           .text('Opérateur :', M + 10, py, { continued: true })
           .fillColor(C.dark).text('  ' + record.operator);
        py += 13;
      }
      if (record.clientReference) {
        doc.font('Helvetica').fontSize(9).fillColor(C.gray)
           .text('Réf. transaction :', M + 10, py, { continued: true })
           .fillColor(C.dark).text('  ' + record.clientReference);
      }

      // Cachet ACQUITTÉ
      const stX = M + payW + 12;
      filledRect(doc, stX, Y, stmpW, 60, C.greenLight);
      strokedRect(doc, stX, Y, stmpW, 60, C.greenBorder);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(C.green)
         .text('FACTURE ACQUITTÉE', stX, Y + 10, { width: stmpW, align: 'center' });
      doc.font('Helvetica').fontSize(8).fillColor(C.green)
         .text('Paiement reçu et confirmé', stX, Y + 30, { width: stmpW, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.green)
         .text(fmtDateLong(record.createdAt), stX, Y + 44, { width: stmpW, align: 'center' });

      Y += 72;

      // ── 7. RÉFÉRENCE PAIEMENT ─────────────────────────────────────────────
      filledRect(doc, M, Y, CW, 28, C.grayLight);
      strokedRect(doc, M, Y, CW, 28, C.line);
      doc.font('Helvetica').fontSize(8.5).fillColor(C.gray)
         .text('Référence de paiement :', M + 10, Y + 9, { continued: true })
         .font('Helvetica-Bold').fillColor(C.dark)
         .text('  ' + record.reference);

      Y += 44;

      // ── 8. NOTE ───────────────────────────────────────────────────────────
      doc.font('Helvetica').fontSize(8.5).fillColor(C.gray)
         .text(
           'Cette facture tient lieu de reçu. Conservez-la pour vos archives.',
           M, Y, { width: CW, align: 'center' }
         );

      // ── 9. FOOTER ─────────────────────────────────────────────────────────
      const footY = PH - 48;
      hLine(doc, M, PW - M, footY, C.line);

      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.blue)
         .text('Info Experts', M, footY + 10, { continued: true })
         .font('Helvetica').fillColor(C.gray)
         .text(
           '  ·  Moroni, Comores  ·  contact@info-experts.fr  ·  +269 477 78 65  ·  info-experts.fr',
           { continued: false }
         );

      doc.font('Helvetica').fontSize(8).fillColor(C.gray)
         .text('Merci pour votre confiance !', M, footY + 24, { width: CW, align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
