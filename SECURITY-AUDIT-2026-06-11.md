# Rapport d'audit de sécurité — info-experts.fr

**Date** : 2026-06-11
**Périmètre** : API serverless (`/api`, `/lib/server`), panel admin (`/admin`), configuration (`vercel.json`), gestion des secrets, historique git.
**Méthodologie** : revue statique manuelle + scan de patterns (injection, XSS, secrets, en-têtes). Pas de test dynamique/DAST.

---

## Verdict global

**Posture de sécurité : SOLIDE.** Le backend est écrit avec de bonnes pratiques défensives (sessions signées HMAC, comparaisons à temps constant, validation stricte des entrées, échappement systématique côté admin). **Aucune vulnérabilité CRITIQUE ou HIGH trouvée.** Une amélioration MEDIUM (CSP) et quelques points LOW/INFO ci-dessous.

| Sévérité | Nombre |
|----------|--------|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 1 |
| LOW | 3 |
| INFO | plusieurs (points forts) |

---

## Points forts confirmés

- **Authentification admin** (`lib/server/admin.js`) : token de session signé HMAC-SHA256, vérifié avec `timingSafeEqual` (pas de timing attack). Expiration `exp` contrôlée. Rôles `manager`/`viewer` validés.
- **Cookies de session** : `HttpOnly` + `SameSite=Strict` + `Secure` (en prod/https) + `Max-Age`. Protège contre vol via XSS et CSRF.
- **Comparaison mot de passe** : `timingSafeEqual` sur longueur+contenu. Longueur minimale 12 caractères imposée au démarrage.
- **Injection PostgREST** : tous les filtres utilisateur sont validés par regex (`SAFE_ENUM_RE`, `REFERENCE_RE`, `DATE_RE`, `SAFE_NAME_RE`) et la recherche `ilike` retire `(),` via `escapeSearch`. `URL.searchParams` encode les valeurs. **Pas d'injection exploitable.**
- **Validation d'entrée** (`lib/server/lib.js`) : longueurs max, regex email/téléphone, montants entiers ≥ 0, `assertOneOf` sur les enums. `randomBytes` (crypto) pour les références, pas `Math.random()`.
- **XSS admin** : fonction `esc()` (échappe `& < > "`) appliquée à toutes les données issues de la DB injectées via `innerHTML`. Scan exhaustif des `admin/*.html` : **aucun champ DB interpolé sans échappement.**
- **Fuite d'erreurs** : `supabase.js` masque les détails internes (hint, schema, contraintes) côté client, log serveur uniquement.
- **Secrets** : aucun `.env`/`.pem`/`.key` suivi par git. `backup-secrets.sh` ne contient que des valeurs placeholder (dry-run). Historique git propre, aucun secret committé. `.gitignore` couvre `.env.local`, `.env*.local`, `.secrets-setup.env`.
- **En-têtes** (`vercel.json`) : HSTS preload, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, CSP présente. Admin/API en `no-store` + `noindex`.
- **CORS** : allowlist stricte (`info-experts.fr`, `www.`), pas de wildcard reflété.
- **Rate limiting** : par IP hashée (SHA-256 + sel), sur `order` et `admin-login`. Délai fixe 300ms anti-brute-force au login.

---

## MEDIUM-1 — CSP autorise `script-src 'unsafe-inline'`

**Fichier** : `vercel.json` ligne 116.
**Problème** : `script-src 'self' 'unsafe-inline' https://www.googletagmanager.com`. Le `'unsafe-inline'` annule en grande partie la protection CSP contre le XSS : si un XSS est introduit un jour (ex. nouvelle page mal échappée), la CSP ne le bloquera pas.
**Risque** : défense en profondeur affaiblie. Pas exploitable seul aujourd'hui (pas de XSS trouvé), mais supprime le filet de sécurité.
**Recommandation** : migrer vers une CSP à nonce ou hash pour les scripts inline. Compromis : GTM/GA et les `<style>` inline critiques (perf) compliquent la migration. À planifier sans casser le score PageSpeed. `style-src 'unsafe-inline'` est plus difficile à retirer (styles critiques inline) — acceptable en priorité basse.

---

## LOW-1 — Rate limit « fail-open »

**Fichier** : `lib/server/rate-limit.js` lignes 45-50.
**Problème** : si Supabase est indisponible ou la table absente, le contrôle est ignoré silencieusement (dégradation). Un attaquant qui fait tomber/saturer la vérification contourne la limite.
**Recommandation** : choix défendable (disponibilité > sécurité pour un site vitrine), mais documenter le risque. Envisager un fallback en mémoire pour le login.

## LOW-2 — Incohérence commentaire/limite

**Fichier** : `lib/server/admin-routes.js` ligne 355 dit « 10 tentatives », mais `rate-limit.js` `LIMIT = 20`. La vraie limite login est 20/heure/IP. Corriger le commentaire ou abaisser la limite login (un endpoint de login mérite < 10).

## LOW-3 — En-têtes obsolètes / à durcir

- `X-XSS-Protection: 1; mode=block` (ligne 107) : déprécié, peut introduire des bugs sur vieux navigateurs. Recommandé : `X-XSS-Protection: 0` (s'appuyer sur la CSP).
- CSP `img-src` autorise `data:` : vecteur mineur d'exfiltration, acceptable.

---

## INFO / vérifications faites sans souci

- Pas de `eval`, `document.write`, `dangerouslySetInnerHTML` dans le code du site.
- Endpoints admin protégés par `requireAdmin` ; actions mutantes restreintes au rôle `manager`.
- `cleanup-test-data` construit des filtres `in.(...)` à partir de références **issues de la DB** (pas d'entrée utilisateur), donc pas d'injection.
- Détail client (`loadDetailRecord`) échappe les valeurs PostgREST via `escapePostgrestString`.

---

## Plan d'action recommandé (par priorité)

1. **MEDIUM-1** : planifier migration CSP vers nonce pour `script-src` (sans dégrader PageSpeed).
2. **LOW-2** : aligner commentaire/limite de login (abaisser à 5–10/h).
3. **LOW-1** : ajouter fallback rate-limit pour le login admin.
4. **LOW-3** : passer `X-XSS-Protection` à `0`.

Aucune action urgente. Le site est bien sécurisé pour son périmètre (vitrine + prise de RDV/commandes + admin).
