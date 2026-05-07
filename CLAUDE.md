# Info Experts — Directives projet pour Claude

## Présentation du projet

Site vitrine d'Info Experts, boutique informatique à Moroni (Comores).
La boutique e-commerce complète est hébergée séparément sur `boutique.info-experts.fr` (projet `alkamar-info`).

- **URL production** : https://info-experts.fr
- **Hébergement** : Vercel
- **Langue** : français
- **Stack** : HTML statique + Tailwind CSS compilé (`style.css`) + JavaScript vanilla

---

## Structure des fichiers

```
info-experts/
├── index.html                          # Page principale (FAQ, LocalBusiness schema)
├── boutique.html                       # Embed boutique (iframe → boutique.info-experts.fr)
├── a-propos.html
├── services.html
├── booking.html
├── payment.html
├── informatique-comores.html
├── informatique-pas-cher-comores.html
├── services/
│   └── maintenance-informatique-comores.html
├── blog/                               # 30 articles SEO (4 catégories)
├── admin/                              # Panel admin (protégé)
├── api/                                # Vercel serverless functions
├── style.css                           # Tailwind compilé (ne pas modifier directement)
├── vercel.json                         # Headers sécurité, CSP, cache
├── sitemap.xml                         # 38 URLs
└── robots.txt
```

---

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Frontend | HTML statique + Tailwind CSS (compilé) |
| Déploiement | Vercel |
| SEO | schema.org LocalBusiness + FAQPage + BreadcrumbList + Article |
| Boutique embed | iframe → boutique.info-experts.fr |

---

## Conventions de code

- `style.css` est compilé depuis Tailwind — ne pas l'éditer manuellement pour du style inline.
- Les pages HTML utilisent des `<style>` inline uniquement pour les animations ou overrides critiques.
- Commits en français, format : `type(scope): description`.
- Balises SEO obligatoires sur chaque page : `<title>`, `<meta description>`, `<link rel="canonical">`, OG tags, favicon.

---

## PERFORMANCE — Score 100% Google PageSpeed / Lighthouse

**Contrainte prioritaire absolue.** Le site principal et la boutique ont atteint 100% sur mobile et desktop.
Aucune modification ne doit dégrader ce score.

### Métriques à préserver

| Métrique | Description |
|----------|-------------|
| LCP | Largest Contentful Paint — image carousel hero |
| CLS | Cumulative Layout Shift — stabilité visuelle |
| TBT | Total Blocking Time — blocage thread principal |
| FCP | First Contentful Paint — premier rendu |
| Taille réseau | Payload total premier chargement |

### Architecture de performance déjà en place

- `style.css` chargé en **non-bloquant** via `rel="preload" onload` trick + `<noscript>` fallback.
- CSS critique inliné dans `<style>` pour le header et le carousel (évite FOUC).
- Image LCP (`carousel-1-*.webp`) preloaded avec `fetchpriority="high"` et `imagesrcset`.
- `loading="eager"` uniquement sur l'image LCP, `loading="lazy"` sur tout le reste.
- `decoding="async"` sur toutes les images.
- Toutes les images en WebP avec srcset responsive.
- Cache 1 an (`immutable`) sur `style.css`, images WebP/PNG.

**Ne jamais casser ces optimisations.**

---

### Règles images

- Toujours utiliser WebP. Proposer AVIF si nouvelle image critique.
- Toujours `width` et `height` sur chaque `<img>`.
- `loading="lazy"` sur toutes les images sauf la LCP.
- `fetchpriority="high"` uniquement sur l'image LCP au-dessus de la ligne de flottaison.
- `decoding="async"` sur toutes les images — jamais `sync`.
- Vérifier le poids avant commit. Seuil : < 100 KB par image affichée.

### Règles CSS / JS

- Ne pas ajouter de `<link rel="stylesheet">` bloquant supplémentaire.
- Ne pas ajouter de script tiers sans nécessité absolue.
- Tout script non critique doit avoir `defer` ou être en bas de `<body>`.
- Ne pas modifier `style.css` directement — recompiler via Tailwind si besoin.

### Règles vercel.json

- Toujours valider le JSON après modification : `Get-Content vercel.json -Raw | ConvertFrom-Json | Out-Null`
- Le CSP dans `vercel.json` autorise `frame-src https://boutique.info-experts.fr` — ne pas le supprimer.
- `X-Frame-Options: DENY` protège info-experts.fr contre l'embedding non autorisé — ne pas supprimer.
- `Cache-Control: immutable` sur les assets statiques — ne pas réduire.

---

## Intégration boutique (boutique.html)

L'iframe dans `boutique.html` est le contenu principal de cette page.

Attributs obligatoires :
```html
<iframe
  src="https://boutique.info-experts.fr"
  loading="eager"
  allow="payment"
  title="Boutique informatique Info Experts — Comores">
```

Règles :
- **Pas de `sandbox`** — casserait localStorage et cookies (panier + Stripe).
- `loading="eager"` obligatoire — c'est le contenu principal above-the-fold.
- `src` doit pointer vers `boutique.info-experts.fr`, jamais `alkamar-info.vercel.app`.
- Le listener `postMessage` dans `boutique.html` est le fallback Stripe — ne pas le supprimer.
- Le vrai fix Stripe mobile utilise `window.top.location.href` directement depuis l'iframe.
- Preconnect vers `boutique.info-experts.fr` ajouté dans le `<head>` — ne pas supprimer.

---

## SEO — Règles obligatoires

- Chaque page doit avoir : `<title>`, `<meta name="description">`, `<link rel="canonical">`.
- Schema.org JSON-LD selon le type de page (LocalBusiness, FAQPage, BreadcrumbList, Article).
- `sitemap.xml` doit être mis à jour si une nouvelle page est ajoutée.
- `robots.txt` : ne pas ajouter de règles `Disallow` sur les pages publiques.
- Ne jamais ajouter `noindex` sur une page publique sans raison documentée.
- Images OG : min 1200×630px, préférer WebP.

---

## Ce qui ne doit jamais être cassé

- Score PageSpeed 100%
- Embed boutique dans boutique.html (iframe + postMessage Stripe)
- Navigation principale (header/footer présents sur toutes les pages)
- Blog SEO (30 articles dans `/blog/`)
- Chemins relatifs CSS dans blog : `../../style.css` depuis `blog/categorie/`
- Stripe via l'embed (postMessage + window.top.location.href)
- Admin (routes protégées)
- Sitemap et robots.txt

---

## Checklist avant toute modification

- [ ] Impact sur LCP, CLS, TBT, FCP ?
- [ ] Ajout de poids réseau au premier chargement ?
- [ ] Ajout d'un script ou dépendance ?
- [ ] Ajout d'une image non optimisée ?
- [ ] Changement de CSP ou headers qui bloque l'embed ?
- [ ] Solution plus légère disponible ?

---

## Checklist après toute modification

- [ ] JSON valide (`vercel.json`, `site.webmanifest`)
- [ ] Pas d'erreur console dans le browser
- [ ] Embed boutique charge correctement
- [ ] Stripe fonctionne dans l'embed (mobile + desktop)
- [ ] Responsive intact (mobile, tablette, desktop)
- [ ] SEO intact (balises meta, canonical, schema)
- [ ] Cache-Control intact sur les assets modifiés
- [ ] PageSpeed score préservé

---

## Commandes

```powershell
# Valider JSON
Get-Content vercel.json -Raw | ConvertFrom-Json | Out-Null

# Vérifier poids des images
Get-ChildItem *.webp | Select-Object Name, @{N='KB';E={[math]::Round($_.Length/1KB,1)}}

# Build CSS Tailwind si modifié
npx postcss style.src.css -o style.css

# Playwright si disponible
npx playwright test
```

---

## Que faire si une demande risque de dégrader le score 100%

1. Ne pas appliquer directement la solution lourde.
2. Chercher une alternative plus légère (lazy load, cache, WebP/AVIF, différer).
3. Optimiser l'asset avant intégration.
4. Signaler le risque dans la réponse et proposer un compromis.
5. Ne jamais sacrifier le score 100% sans validation explicite.

---

## Rapport final obligatoire

```
## Rapport
- Fichiers modifiés : [liste]
- Impact performance estimé : [LCP/CLS/TBT/FCP/réseau]
- Tests lancés : [build / lint / Playwright]
- Résultat JSON/syntaxe : [OK / ERREUR]
- Embed boutique vérifié : [OUI / NON]
- SEO intact : [OUI / NON]
- Score 100% préservé : [OUI / compromis — détails]
```

---

## Workflow Performance Automatique

### Description

Système de surveillance et d'optimisation automatique des performances.
Il couvre l'audit statique du code, les vérifications PageSpeed Insights
et les rapports Lighthouse CI.

### Fichiers du système

| Fichier | Rôle |
|---------|------|
| `.github/workflows/performance-guard.yml` | CI GitHub Actions (Lighthouse CI + PageSpeed) |
| `lighthouserc.json` | Config Lighthouse CI (URLs, seuils, stratégie) |
| `performance-budget.json` | Budget ressources et timings |
| `scripts/check-pagespeed.mjs` | Appel API PageSpeed Insights (mobile + desktop) |
| `scripts/performance-audit.mjs` | Audit statique : images, HTML, CSS, vercel.json |
| `scripts/auto-optimize-performance.mjs` | Boucle d'optimisation automatique (max 3 passes) |
| `reports/` | Rapports générés (ignorés par git, sauf `.gitkeep`) |

### Commandes disponibles

```powershell
# Audit statique complet (images, HTML, CSS, cache)
npm run performance:audit

# Vérification PageSpeed Insights (nécessite PAGESPEED_API_KEY)
npm run performance:check

# Auto-optimisation contrôlée (max 3 passes)
npm run performance:auto

# Lancer Lighthouse CI (nécessite lhci installé)
npm run lighthouse
```

### Seuils de score

| Métrique | Seuil erreur | Seuil warning |
|----------|--------------|---------------|
| Performance | < 90 (erreur CI) | — |
| Accessibilité | — | < 90 |
| Best Practices | — | < 90 |
| SEO | — | < 90 |
| LCP | > 2500 ms | — |
| CLS | > 0.1 (erreur CI) | — |
| TBT | > 300 ms | — |
| FCP | > 2000 ms | — |
| PageSpeed exit 1 | score < 80 | — |
| PageSpeed warning | score 80-89 | — |

### Corrections autorisées par auto-optimize

- `decoding="sync"` → `decoding="async"` dans les HTML
- `transition:all` → `transition:background-color .15s,color .15s,border-color .15s` dans style.css
- Recompression images > 200 KB avec sharp
- Création variantes WebP (q=80) et AVIF (q=65) pour images > 100 KB

### Corrections INTERDITES par auto-optimize

- Design, couleurs, textes visibles
- Embed iframe boutique (src, allow, loading)
- Stripe (postMessage, window.top.location.href)
- SEO (balises meta, canonical, schema)
- Cache-Control et headers vercel.json

### Lancer manuellement (sans CI)

```powershell
# Audit + rapport
cd C:\Users\defis\info-experts
npm run performance:audit

# Voir le rapport généré
cat reports/performance-audit.md

# Vérification PageSpeed (avec clé API)
$env:PAGESPEED_API_KEY = "votre-clé"
npm run performance:check

# Voir le rapport PageSpeed
cat reports/pagespeed-report.md
```

### CI GitHub Actions

Le workflow `.github/workflows/performance-guard.yml` se déclenche :
- À chaque push sur `main`
- À chaque pull request vers `main`
- Automatiquement chaque lundi à 03:00 UTC
- Manuellement via `workflow_dispatch`

Secrets requis dans GitHub :
- `LHCI_GITHUB_APP_TOKEN` — pour afficher les résultats dans les PRs
- `PAGESPEED_API_KEY` — optionnel, pour les vérifications PageSpeed
