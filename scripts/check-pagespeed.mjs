/**
 * check-pagespeed.mjs — info-experts (info-experts.fr)
 * Appelle l'API PageSpeed Insights pour mobile ET desktop sur les URLs du projet.
 * Génère reports/pagespeed-report.md et reports/pagespeed-report.json
 *
 * Exit codes :
 *   0  — score >= 90 ou PAGESPEED_API_KEY absente
 *   0  — score 80-89 (warning affiché)
 *   1  — score < 80 (erreur)
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORTS_DIR = join(ROOT, 'reports');

const API_KEY = process.env.PAGESPEED_API_KEY;

if (!API_KEY) {
  console.log('PAGESPEED_API_KEY manquante — skip PageSpeed API check');
  process.exit(0);
}

const URLS = [
  'https://info-experts.fr',
  'https://info-experts.fr/boutique.html',
];

const STRATEGIES = ['mobile', 'desktop'];

const BASE_API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

// ── Fetch wrapper ────────────────────────────────────────────────────────────

async function fetchPageSpeed(url, strategy) {
  const params = new URLSearchParams({
    url,
    strategy,
    key: API_KEY,
    category: 'performance',
  });
  const endpoint = `${BASE_API}?${params}`;

  const res = await fetch(endpoint);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PageSpeed API error ${res.status} for ${url} [${strategy}]: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ── Extract meaningful data ──────────────────────────────────────────────────

function extractData(json, url, strategy) {
  const cats = json.lighthouseResult?.categories ?? {};
  const audits = json.lighthouseResult?.audits ?? {};

  const score = Math.round((cats.performance?.score ?? 0) * 100);

  const metrics = {
    fcp: audits['first-contentful-paint']?.numericValue,
    lcp: audits['largest-contentful-paint']?.numericValue,
    tbt: audits['total-blocking-time']?.numericValue,
    cls: audits['cumulative-layout-shift']?.numericValue,
    si:  audits['speed-index']?.numericValue,
    tti: audits['interactive']?.numericValue,
  };

  const failedAudits = Object.entries(audits)
    .filter(([, a]) => a.score !== null && a.score < 0.9 && a.details?.type !== 'debugdata')
    .map(([id, a]) => ({
      id,
      title: a.title,
      score: a.score !== null ? Math.round(a.score * 100) : null,
      displayValue: a.displayValue ?? null,
    }))
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .slice(0, 10);

  return { url, strategy, score, metrics, failedAudits };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nPageSpeed Insights — info-experts.fr`);
  console.log(`URLs : ${URLS.join(', ')}`);
  console.log(`Stratégies : ${STRATEGIES.join(', ')}\n`);

  mkdirSync(REPORTS_DIR, { recursive: true });

  const results = [];
  let globalMinScore = 100;
  let hasError = false;

  for (const url of URLS) {
    for (const strategy of STRATEGIES) {
      process.stdout.write(`  Analyse ${strategy.padEnd(8)} ${url} … `);
      try {
        const json = await fetchPageSpeed(url, strategy);
        const data = extractData(json, url, strategy);
        results.push(data);

        const emoji = data.score >= 90 ? 'OK' : data.score >= 80 ? 'WARN' : 'FAIL';
        console.log(`[${emoji}] Score performance : ${data.score}`);

        if (data.score < globalMinScore) globalMinScore = data.score;
        if (data.score < 80) hasError = true;
      } catch (err) {
        console.log(`[ERR] ${err.message}`);
        results.push({ url, strategy, score: null, error: err.message });
      }
    }
  }

  // ── Rapport JSON ───────────────────────────────────────────────────────────

  const jsonReport = {
    project: 'info-experts',
    generatedAt: new Date().toISOString(),
    globalMinScore,
    urls: URLS,
    strategies: STRATEGIES,
    results,
  };

  writeFileSync(
    join(REPORTS_DIR, 'pagespeed-report.json'),
    JSON.stringify(jsonReport, null, 2),
    'utf8'
  );

  // ── Rapport Markdown ───────────────────────────────────────────────────────

  const lines = [
    `# Rapport PageSpeed — info-experts.fr`,
    ``,
    `**Généré le :** ${new Date().toLocaleString('fr-FR')}  `,
    `**Score global minimum :** ${globalMinScore}/100`,
    ``,
    `---`,
    ``,
  ];

  for (const r of results) {
    if (r.error) {
      lines.push(`## ${r.url} [${r.strategy}] — ERREUR`);
      lines.push(`> ${r.error}`);
      lines.push(``);
      continue;
    }

    const badge = r.score >= 90 ? 'OK' : r.score >= 80 ? 'AVERTISSEMENT' : 'ECHEC';
    lines.push(`## ${r.url} [${r.strategy}] — ${badge} (${r.score}/100)`);
    lines.push(``);

    // Métriques core
    const m = r.metrics;
    lines.push(`### Métriques Core Web Vitals`);
    lines.push(``);
    lines.push(`| Métrique | Valeur |`);
    lines.push(`|----------|--------|`);
    if (m.fcp != null) lines.push(`| FCP (First Contentful Paint) | ${Math.round(m.fcp)} ms |`);
    if (m.lcp != null) lines.push(`| LCP (Largest Contentful Paint) | ${Math.round(m.lcp)} ms |`);
    if (m.tbt != null) lines.push(`| TBT (Total Blocking Time) | ${Math.round(m.tbt)} ms |`);
    if (m.cls != null) lines.push(`| CLS (Cumulative Layout Shift) | ${m.cls.toFixed(3)} |`);
    if (m.si  != null) lines.push(`| Speed Index | ${Math.round(m.si)} ms |`);
    if (m.tti != null) lines.push(`| TTI (Time to Interactive) | ${Math.round(m.tti)} ms |`);
    lines.push(``);

    if (r.failedAudits.length > 0) {
      lines.push(`### Audits à corriger (score < 90)`);
      lines.push(``);
      lines.push(`| Audit | Score | Valeur |`);
      lines.push(`|-------|-------|--------|`);
      for (const a of r.failedAudits) {
        lines.push(`| ${a.title} | ${a.score ?? 'N/A'} | ${a.displayValue ?? '-'} |`);
      }
      lines.push(``);
    }
  }

  // Résumé final
  lines.push(`---`);
  lines.push(``);
  lines.push(`## Résumé`);
  lines.push(``);
  if (hasError) {
    lines.push(`Score < 80 détecté — action requise pour restaurer les performances.`);
  } else if (globalMinScore < 90) {
    lines.push(`Score entre 80 et 89 — amélioration recommandée.`);
  } else {
    lines.push(`Tous les scores >= 90 — performances satisfaisantes.`);
  }

  writeFileSync(
    join(REPORTS_DIR, 'pagespeed-report.md'),
    lines.join('\n'),
    'utf8'
  );

  console.log(`\nRapports générés :`);
  console.log(`  reports/pagespeed-report.json`);
  console.log(`  reports/pagespeed-report.md`);
  console.log(`\nScore global minimum : ${globalMinScore}/100`);

  if (hasError) {
    console.error(`\nERREUR : score < 80 detecte — exit 1`);
    process.exit(1);
  } else if (globalMinScore < 90) {
    console.warn(`\nAVERTISSEMENT : score < 90 (${globalMinScore}) — verifier les audits`);
    process.exit(0);
  } else {
    console.log(`\nTous les scores >= 90 — OK`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Erreur fatale :', err);
  process.exit(1);
});
