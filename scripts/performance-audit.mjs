/**
 * performance-audit.mjs — info-experts (info-experts.fr)
 * Analyse statique du projet pour détecter les problèmes de performance.
 *
 * Vérifie :
 *  - Images trop lourdes (> 100 KB) dans la racine et images/
 *  - PNG/JPG sans variante WebP/AVIF
 *  - Patterns problématiques dans .html :
 *      fetchpriority="high" sur images dynamiques,
 *      decoding="sync", transition:all, images sans width/height,
 *      preload CSS sans trick onload
 *  - vercel.json : Cache-Control sur images, présence frame-src CSP
 *
 * Génère reports/performance-audit.md et reports/performance-audit.json
 */

import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, extname, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORTS_DIR = join(ROOT, 'reports');

const ISSUES = [];
const WARNINGS = [];
const INFO = [];

// ── Helpers ──────────────────────────────────────────────────────────────────

function addIssue(category, message, file = null) {
  ISSUES.push({ category, message, file });
  const loc = file ? ` [${file}]` : '';
  console.log(`  [ISSUE] ${category}${loc}: ${message}`);
}

function addWarning(category, message, file = null) {
  WARNINGS.push({ category, message, file });
  const loc = file ? ` [${file}]` : '';
  console.log(`  [WARN]  ${category}${loc}: ${message}`);
}

function addInfo(category, message) {
  INFO.push({ category, message });
}

function readHtmlFiles(dir, maxDepth = 3, depth = 0) {
  if (!existsSync(dir) || depth > maxDepth) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'blog') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...readHtmlFiles(full, maxDepth, depth + 1));
    } else if (extname(entry.name).toLowerCase() === '.html') {
      files.push(full);
    }
  }
  return files;
}

// ── 1. Audit images (racine + images/) ──────────────────────────────────────

function auditImages() {
  console.log('\n[1/4] Audit images…');

  const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg'];
  const WEBP_AVIF_EXTENSIONS = ['.webp', '.avif'];

  // Collecter les images à la racine et dans images/
  const filesToCheck = [];

  // Racine : PNG/JPG
  const rootEntries = readdirSync(ROOT, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    if ([...IMAGE_EXTENSIONS, ...WEBP_AVIF_EXTENSIONS].includes(ext)) {
      filesToCheck.push({ full: join(ROOT, entry.name), name: entry.name, subdir: '' });
    }
  }

  // images/
  const imagesDir = join(ROOT, 'images');
  if (existsSync(imagesDir)) {
    const imgEntries = readdirSync(imagesDir, { withFileTypes: true });
    for (const entry of imgEntries) {
      if (!entry.isFile()) continue;
      const ext = extname(entry.name).toLowerCase();
      if ([...IMAGE_EXTENSIONS, ...WEBP_AVIF_EXTENSIONS].includes(ext)) {
        filesToCheck.push({ full: join(imagesDir, entry.name), name: entry.name, subdir: 'images/' });
      }
    }
  }

  // Noms WebP/AVIF présents
  const optimizedNames = new Set(
    filesToCheck
      .filter(f => WEBP_AVIF_EXTENSIONS.includes(extname(f.name).toLowerCase()))
      .map(f => basename(f.name, extname(f.name)).toLowerCase())
  );

  for (const { full, name, subdir } of filesToCheck) {
    const ext = extname(name).toLowerCase();
    if (WEBP_AVIF_EXTENSIONS.includes(ext)) continue;
    if (!IMAGE_EXTENSIONS.includes(ext)) continue;

    const stat = statSync(full);
    const sizeKB = stat.size / 1024;
    const relPath = `${subdir}${name}`;

    // Seuil info-experts : 100 KB (plus strict car site vitrine)
    if (sizeKB > 200) {
      addIssue('images', `Fichier trop lourd : ${Math.round(sizeKB)} KB (seuil: 200 KB)`, relPath);
    } else if (sizeKB > 100) {
      addWarning('images', `Fichier assez lourd : ${Math.round(sizeKB)} KB (seuil recommandé: 100 KB)`, relPath);
    }

    // Vérifier variante WebP/AVIF
    const nameWithoutExt = basename(name, ext).toLowerCase();
    if (!optimizedNames.has(nameWithoutExt)) {
      addWarning('images', `Pas de variante WebP/AVIF pour ${name}`, relPath);
    }
  }

  addInfo('images', 'Audit images terminé');
}

// ── 2. Audit HTML patterns ───────────────────────────────────────────────────

function auditHtml() {
  console.log('\n[2/4] Audit HTML…');

  const htmlFiles = readHtmlFiles(ROOT);

  for (const filePath of htmlFiles) {
    const rel = filePath.replace(ROOT + '\\', '').replace(ROOT + '/', '');
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      const lineNum = idx + 1;
      const loc = `${rel}:${lineNum}`;

      // fetchpriority="high" sur images dynamiques
      if (/fetchpriority=["']high["']/.test(line)) {
        if (/\$\{/.test(line) || /src=["'][^"']*\?/.test(line)) {
          addIssue('images', `fetchpriority="high" sur image dynamique (risque LCP incorrect)`, loc);
        }
      }

      // decoding="sync"
      if (/decoding=["']sync["']/.test(line)) {
        addIssue('tbt', `decoding="sync" détecté (bloque le thread principal, préférer "async")`, loc);
      }

      // transition:all
      if (/transition\s*:\s*all/.test(line)) {
        addWarning('css', `transition:all détecté (non-composité)`, loc);
      }

      // <img sans width et height
      if (/<img\b[^>]*>/.test(line)) {
        const hasWidth = /\bwidth=/.test(line);
        const hasHeight = /\bheight=/.test(line);
        if (!hasWidth && !hasHeight) {
          addWarning('cls', `<img> sans width/height (cause CLS)`, loc);
        }
      }

      // preload CSS sans onload
      if (/rel=["']preload["'][^>]*as=["']style["']/.test(line)) {
        if (!/onload/.test(line)) {
          addWarning('css', `<link rel="preload" as="style"> sans onload trick`, loc);
        }
      }

      // Script tiers bloquant (sans defer/async)
      if (/<script\b(?![^>]*\b(defer|async)\b)[^>]*src=["']https?:/.test(line)) {
        // Exclure les scripts avec type="module" (non-bloquants par nature)
        if (!/type=["']module["']/.test(line)) {
          addWarning('tbt', `Script tiers sans defer/async potentiellement bloquant`, loc);
        }
      }
    });
  }

  addInfo('html', `${htmlFiles.length} fichiers HTML analysés`);
}

// ── 3. Audit CSS (style.css) ─────────────────────────────────────────────────

function auditCss() {
  console.log('\n[3/4] Audit CSS…');

  const cssPath = join(ROOT, 'style.css');
  if (!existsSync(cssPath)) {
    addInfo('css', 'style.css introuvable — skip');
    return;
  }

  const stat = statSync(cssPath);
  const sizeKB = stat.size / 1024;

  if (sizeKB > 50) {
    addWarning('css', `style.css pèse ${Math.round(sizeKB)} KB (budget: 50 KB) — vérifier la purge Tailwind`);
  } else {
    addInfo('css', `style.css : ${Math.round(sizeKB)} KB — OK`);
  }

  const content = readFileSync(cssPath, 'utf8');
  const lines = content.split('\n');

  let transitionAllCount = 0;
  lines.forEach((line, idx) => {
    if (/transition\s*:\s*all/.test(line)) {
      transitionAllCount++;
      addWarning('css', `transition:all dans style.css ligne ${idx + 1}`, 'style.css');
    }
  });

  if (transitionAllCount === 0) {
    addInfo('css', 'Aucun transition:all dans style.css — OK');
  }
}

// ── 4. Audit vercel.json ─────────────────────────────────────────────────────

function auditVercelJson() {
  console.log('\n[4/4] Audit vercel.json…');

  const vercelPath = join(ROOT, 'vercel.json');
  if (!existsSync(vercelPath)) {
    addWarning('cache', 'vercel.json introuvable');
    return;
  }

  let config;
  try {
    config = JSON.parse(readFileSync(vercelPath, 'utf8'));
  } catch (e) {
    addIssue('config', `vercel.json invalide JSON : ${e.message}`, 'vercel.json');
    return;
  }

  const headers = config.headers ?? [];

  // Cache-Control sur images
  const imagePatterns = ['.webp', '.avif', '.png', '.jpg', 'images/'];
  let imagesCached = false;

  // CSP frame-src boutique
  let frameSrcOk = false;

  for (const h of headers) {
    const src = h.source ?? '';
    const hHeaders = h.headers ?? [];

    const hasImagePattern = imagePatterns.some(p => src.includes(p));
    if (hasImagePattern) {
      const cacheHeader = hHeaders.find(hh => hh.key?.toLowerCase() === 'cache-control');
      if (cacheHeader) {
        imagesCached = true;
        addInfo('cache', `Cache-Control trouvé pour "${src}": ${cacheHeader.value}`);
      }
    }

    // Vérifier CSP frame-src
    const cspHeader = hHeaders.find(hh => hh.key?.toLowerCase() === 'content-security-policy');
    if (cspHeader && /frame-src/.test(cspHeader.value) && /boutique\.info-experts\.fr/.test(cspHeader.value)) {
      frameSrcOk = true;
    }
  }

  if (!imagesCached) {
    addWarning('cache', 'Aucun Cache-Control sur les images dans vercel.json');
  }

  if (!frameSrcOk) {
    addWarning('embed', 'frame-src boutique.info-experts.fr absent ou mal configuré dans le CSP de vercel.json');
  } else {
    addInfo('embed', 'CSP frame-src boutique.info-experts.fr — OK');
  }
}

// ── Génération rapports ───────────────────────────────────────────────────────

function generateReports() {
  mkdirSync(REPORTS_DIR, { recursive: true });

  const jsonReport = {
    project: 'info-experts',
    generatedAt: new Date().toISOString(),
    summary: { issues: ISSUES.length, warnings: WARNINGS.length },
    issues: ISSUES,
    warnings: WARNINGS,
    info: INFO,
  };

  writeFileSync(
    join(REPORTS_DIR, 'performance-audit.json'),
    JSON.stringify(jsonReport, null, 2),
    'utf8'
  );

  const lines = [
    `# Audit Performance — info-experts.fr`,
    ``,
    `**Généré le :** ${new Date().toLocaleString('fr-FR')}`,
    ``,
    `## Résumé`,
    ``,
    `| Type | Nombre |`,
    `|------|--------|`,
    `| Issues (à corriger) | ${ISSUES.length} |`,
    `| Warnings (à surveiller) | ${WARNINGS.length} |`,
    ``,
    `---`,
    ``,
  ];

  if (ISSUES.length > 0) {
    lines.push(`## Issues (${ISSUES.length})`);
    lines.push(``);
    lines.push(`| Catégorie | Fichier | Message |`);
    lines.push(`|-----------|---------|---------|`);
    for (const i of ISSUES) {
      lines.push(`| ${i.category} | ${i.file ?? '-'} | ${i.message} |`);
    }
    lines.push(``);
  }

  if (WARNINGS.length > 0) {
    lines.push(`## Warnings (${WARNINGS.length})`);
    lines.push(``);
    lines.push(`| Catégorie | Fichier | Message |`);
    lines.push(`|-----------|---------|---------|`);
    for (const w of WARNINGS) {
      lines.push(`| ${w.category} | ${w.file ?? '-'} | ${w.message} |`);
    }
    lines.push(``);
  }

  if (ISSUES.length === 0 && WARNINGS.length === 0) {
    lines.push(`Aucun problème détecté — performances optimales.`);
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(``);
  lines.push(`## Infos`);
  lines.push(``);
  for (const i of INFO) {
    lines.push(`- **${i.category}** : ${i.message}`);
  }

  writeFileSync(
    join(REPORTS_DIR, 'performance-audit.md'),
    lines.join('\n'),
    'utf8'
  );

  console.log(`\nRapports générés :`);
  console.log(`  reports/performance-audit.json`);
  console.log(`  reports/performance-audit.md`);
  console.log(`\nRésumé : ${ISSUES.length} issue(s), ${WARNINGS.length} warning(s)`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log(`\nAudit Performance — info-experts.fr`);
console.log(`Racine : ${ROOT}\n`);

auditImages();
auditHtml();
auditCss();
auditVercelJson();

console.log(`\n── Résumé ──────────────────────────────────`);
console.log(`  Issues   : ${ISSUES.length}`);
console.log(`  Warnings : ${WARNINGS.length}`);
console.log(`  Infos    : ${INFO.length}`);

generateReports();
process.exit(0);
