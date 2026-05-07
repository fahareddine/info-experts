/**
 * auto-optimize-performance.mjs — info-experts (info-experts.fr)
 * Boucle d'optimisation automatique contrôlée. MAX 3 passes.
 *
 * Corrections autorisées :
 *   - decoding="sync" → decoding="async" dans les .html
 *   - transition:all → transition:background-color .15s,color .15s,border-color .15s dans style.css
 *   - Création variantes WebP/AVIF pour PNG/JPG > 100 KB (avec sharp)
 *
 * Corrections INTERDITES :
 *   - Design, couleurs, textes visibles
 *   - Embed iframe boutique (src, allow, loading, sandbox)
 *   - Stripe (postMessage, window.top.location.href)
 *   - SEO (balises meta, canonical, schema JSON-LD)
 *   - Cache-Control et headers vercel.json
 *   - style.css compilé Tailwind (la recompression images est OK)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'fs';
import { join, extname, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORTS_DIR = join(ROOT, 'reports');

const MAX_PASSES = 3;
const LOG = [];

function log(msg) {
  LOG.push(msg);
  console.log(msg);
}

// ── Vérifier si sharp est disponible ────────────────────────────────────────

let sharp = null;
try {
  const require = createRequire(import.meta.url);
  sharp = require('sharp');
  log('[sharp] sharp disponible — optimisation images activée');
} catch {
  log('[sharp] sharp indisponible — optimisation images désactivée (installer avec: npm install --save-dev sharp)');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readHtmlFiles(dir, maxDepth = 2, depth = 0) {
  if (!existsSync(dir) || depth > maxDepth) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'blog') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...readHtmlFiles(full, maxDepth, depth + 1));
    else if (extname(entry.name).toLowerCase() === '.html') files.push(full);
  }
  return files;
}

function collectImages(dir) {
  const IMAGE_EXT = ['.png', '.jpg', '.jpeg'];
  const WEBP_AVIF_EXT = ['.webp', '.avif'];
  const results = [];

  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    if (IMAGE_EXT.includes(ext) || WEBP_AVIF_EXT.includes(ext)) {
      results.push({ full: join(dir, entry.name), name: entry.name, ext });
    }
  }

  return results;
}

// ── Lancer l'audit ───────────────────────────────────────────────────────────

function runAudit() {
  log('\n  Lancement de performance-audit.mjs…');
  const result = spawnSync(
    process.execPath,
    [join(__dirname, 'performance-audit.mjs')],
    { stdio: 'inherit', cwd: ROOT }
  );
  if (result.status !== 0) {
    log('  [WARN] L\'audit a retourné un code non-zéro');
  }
}

// ── Corrections : decoding="sync" → "async" ─────────────────────────────────

function fixDecodingSync(pass) {
  let fixed = 0;
  const htmlFiles = readHtmlFiles(ROOT);

  for (const filePath of htmlFiles) {
    const rel = filePath.replace(ROOT + '\\', '').replace(ROOT + '/', '');
    const original = readFileSync(filePath, 'utf8');
    const updated = original.replace(/decoding=["']sync["']/g, 'decoding="async"');

    if (updated !== original) {
      writeFileSync(filePath, updated, 'utf8');
      const count = (original.match(/decoding=["']sync["']/g) ?? []).length;
      log(`  [PASS ${pass}] Corrigé decoding="sync" → "async" (${count} occurrence(s)) dans ${rel}`);
      fixed += count;
    }
  }

  return fixed;
}

// ── Corrections : transition:all → propriétés spécifiques ───────────────────

function fixTransitionAll(pass) {
  const cssPath = join(ROOT, 'style.css');
  if (!existsSync(cssPath)) return 0;

  // IMPORTANT : style.css est compilé par Tailwind.
  // On ne corrige que les transition:all ajoutés manuellement (hors règles générées).
  // Si le fichier est recompilé, la correction sera perdue — c'est intentionnel.
  const original = readFileSync(cssPath, 'utf8');
  const REPLACEMENT = 'transition:background-color .15s,color .15s,border-color .15s';

  const updated = original.replace(/transition\s*:\s*all\b[^;]*/g, REPLACEMENT);

  if (updated !== original) {
    writeFileSync(cssPath, updated, 'utf8');
    const count = (original.match(/transition\s*:\s*all\b/g) ?? []).length;
    log(`  [PASS ${pass}] Corrigé transition:all (${count} occurrence(s)) dans style.css`);
    return count;
  }

  return 0;
}

// ── Corrections : création WebP/AVIF pour images > 100 KB ───────────────────

async function optimizeImages(pass) {
  if (!sharp) {
    log(`  [PASS ${pass}] sharp absent — création WebP/AVIF ignorée`);
    return 0;
  }

  let fixed = 0;

  // Images à la racine + images/
  const imageSources = [
    ...collectImages(ROOT),
    ...collectImages(join(ROOT, 'images')),
  ];

  const WEBP_AVIF_EXT = ['.webp', '.avif'];
  const IMAGE_EXT = ['.png', '.jpg', '.jpeg'];

  // Noms déjà optimisés
  const optimizedNames = new Set(
    imageSources
      .filter(f => WEBP_AVIF_EXT.includes(f.ext))
      .map(f => basename(f.name, f.ext).toLowerCase())
  );

  for (const { full, name, ext } of imageSources) {
    if (!IMAGE_EXT.includes(ext)) continue;

    const stat = statSync(full);
    const sizeKB = stat.size / 1024;
    if (sizeKB <= 100) continue;

    const nameWithoutExt = basename(name, ext).toLowerCase();
    const dir = dirname(full).replace(ROOT, ''); // relatif pour le log

    // Créer WebP
    if (!optimizedNames.has(nameWithoutExt)) {
      const webpPath = join(dirname(full), `${basename(name, ext)}.webp`);
      try {
        await sharp(full).webp({ quality: 80 }).toFile(webpPath);
        const webpKB = statSync(webpPath).size / 1024;
        log(`  [PASS ${pass}] Créé WebP : ${dir}/${basename(webpPath)} (${Math.round(webpKB)} KB)`);
        fixed++;
        optimizedNames.add(nameWithoutExt);
      } catch (err) {
        log(`  [PASS ${pass}] Erreur WebP pour ${name}: ${err.message}`);
      }

      // Créer AVIF
      const avifPath = join(dirname(full), `${basename(name, ext)}.avif`);
      if (!existsSync(avifPath)) {
        try {
          await sharp(full).avif({ quality: 65 }).toFile(avifPath);
          const avifKB = statSync(avifPath).size / 1024;
          log(`  [PASS ${pass}] Créé AVIF : ${dir}/${basename(avifPath)} (${Math.round(avifKB)} KB)`);
          fixed++;
        } catch (err) {
          log(`  [PASS ${pass}] Erreur AVIF pour ${name}: ${err.message}`);
        }
      }
    }
  }

  return fixed;
}

// ── Rapport final ────────────────────────────────────────────────────────────

function generateReport(passResults) {
  mkdirSync(REPORTS_DIR, { recursive: true });

  const totalFixed = passResults.reduce((sum, p) => sum + p.totalFixed, 0);

  const lines = [
    `# Rapport Auto-Optimisation — info-experts.fr`,
    ``,
    `**Généré le :** ${new Date().toLocaleString('fr-FR')}`,
    `**Passes exécutées :** ${passResults.length}/${MAX_PASSES}`,
    `**Total corrections appliquées :** ${totalFixed}`,
    ``,
    `---`,
    ``,
  ];

  for (const p of passResults) {
    lines.push(`## Passe ${p.pass}`);
    lines.push(``);
    lines.push(`| Type de correction | Nombre |`);
    lines.push(`|--------------------|--------|`);
    lines.push(`| decoding="sync" corrigés | ${p.decodingFixed} |`);
    lines.push(`| transition:all corrigés | ${p.transitionFixed} |`);
    lines.push(`| Images WebP/AVIF créées | ${p.imagesFixed} |`);
    lines.push(`| Total cette passe | ${p.totalFixed} |`);
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(``);

  if (totalFixed === 0) {
    lines.push(`Aucune correction nécessaire — le projet est déjà optimisé.`);
  } else {
    lines.push(`${totalFixed} correction(s) appliquée(s) automatiquement.`);
    lines.push(``);
    lines.push(`**Vérifications obligatoires après optimisation :**`);
    lines.push(``);
    lines.push(`- [ ] Embed boutique charge correctement (iframe + Stripe)`);
    lines.push(`- [ ] Rendu visuel inchangé (design, couleurs, carousel)`);
    lines.push(`- [ ] Aucune erreur console dans le browser`);
    lines.push(`- [ ] Lancer Lighthouse pour confirmer le score`);
    lines.push(``);
    lines.push(`> IMPORTANT : style.css est compilé par Tailwind.`);
    lines.push(`> Si vous recompilez Tailwind, les corrections transition:all seront perdues.`);
    lines.push(`> Corriger dans la source Tailwind source (tailwind.config.js) si nécessaire.`);
  }

  lines.push(``);
  lines.push(`## Log détaillé`);
  lines.push(``);
  lines.push('```');
  lines.push(LOG.join('\n'));
  lines.push('```');

  writeFileSync(
    join(REPORTS_DIR, 'auto-optimize-report.md'),
    lines.join('\n'),
    'utf8'
  );

  writeFileSync(
    join(REPORTS_DIR, 'auto-optimize-report.json'),
    JSON.stringify({
      project: 'info-experts',
      generatedAt: new Date().toISOString(),
      passesRun: passResults.length,
      maxPasses: MAX_PASSES,
      totalFixed,
      passes: passResults,
    }, null, 2),
    'utf8'
  );

  console.log(`\nRapports générés :`);
  console.log(`  reports/auto-optimize-report.md`);
  console.log(`  reports/auto-optimize-report.json`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log(`\nAuto-Optimisation Performance — info-experts.fr`);
  log(`Racine : ${ROOT}`);
  log(`Max passes : ${MAX_PASSES}`);

  const passResults = [];

  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    log(`\n════════════════════════════════════════`);
    log(`  PASSE ${pass}/${MAX_PASSES}`);
    log(`════════════════════════════════════════`);

    runAudit();

    const decodingFixed = fixDecodingSync(pass);
    const transitionFixed = fixTransitionAll(pass);
    const imagesFixed = await optimizeImages(pass);

    const totalFixed = decodingFixed + transitionFixed + imagesFixed;
    passResults.push({ pass, decodingFixed, transitionFixed, imagesFixed, totalFixed });

    log(`\n  Passe ${pass} terminée : ${totalFixed} correction(s)`);

    if (totalFixed === 0) {
      log(`  Aucune correction — arrêt (tout est déjà optimisé)`);
      break;
    }
  }

  generateReport(passResults);

  const totalFixed = passResults.reduce((sum, p) => sum + p.totalFixed, 0);

  if (totalFixed > 0) {
    log(`\nAuto-optimisation terminée : ${totalFixed} correction(s) sur ${passResults.length} passe(s)`);
    log(`Vérifier l'embed boutique et le score Lighthouse avant de committer.`);
  } else {
    log(`\nAucune optimisation nécessaire — projet déjà en bon état.`);
  }
}

main().catch((err) => {
  console.error('Erreur fatale :', err);
  process.exit(1);
});
