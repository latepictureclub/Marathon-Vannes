# Worker Strava — déploiement

Un seul endpoint : `GET /activites`, renvoie vos runs des 30 derniers jours
en JSON allégé. Le Worker détient les secrets, `index.html` n'en voit aucun.

## Prérequis

- Un compte Cloudflare (gratuit).
- `wrangler` (CLI Cloudflare) : `npm install -g wrangler`, puis `wrangler login`.
- Un `refresh_token` Strava, obtenu une fois avec `../setup-token.sh` (à la racine du dépôt).

## 1. Obtenir le refresh_token

Depuis la racine du dépôt :

```
./setup-token.sh
```

Le script demande le Client Secret Strava et un code d'autorisation frais
(scope `activity:read_all`), puis affiche le `refresh_token` dans le terminal.
Il n'écrit rien sur disque — copiez la valeur affichée avant de continuer.

## 2. Déployer le Worker

Depuis `worker/`, sans fichier de config (`wrangler.toml`) :

```
wrangler deploy strava.js --name marathon-vannes-strava --compatibility-date 2026-01-01 \
  --var ALLOWED_ORIGIN:https://votre-utilisateur.github.io
```

Remplacez `https://votre-utilisateur.github.io` par l'origine exacte où est
servi `index.html` (celle de GitHub Pages, sans slash final).

## 3. Déclarer les secrets

```
wrangler secret put CLIENT_SECRET --name marathon-vannes-strava
wrangler secret put REFRESH_TOKEN --name marathon-vannes-strava
```

Collez respectivement le Client Secret Strava et le refresh_token obtenu à
l'étape 1 quand la commande le demande.

## 4. Vérifier

```
curl https://marathon-vannes-strava.<votre-sous-domaine>.workers.dev/activites
```

Doit renvoyer un tableau JSON `[{date, distance_m, moving_time_s, name}, ...]`.

## 5. Brancher index.html

Dans `index.html`, remplacez la constante `STRAVA_ENDPOINT` par l'URL réelle
du Worker (celle testée à l'étape 4, avec `/activites`).

## Limites

- Cache client de 15 minutes côté `index.html` (une seule clé localStorage).
- Quotas Strava : 100 requêtes / 15 min, 1000 / jour — largement suffisant
  pour un usage personnel avec ce cache.

## Redéployer après une modification de strava.js

```
wrangler deploy strava.js --name marathon-vannes-strava --compatibility-date 2026-01-01 \
  --var ALLOWED_ORIGIN:https://votre-utilisateur.github.io
```

Les secrets déjà déclarés (`CLIENT_SECRET`, `REFRESH_TOKEN`) sont conservés
d'un déploiement à l'autre ; inutile de les redéclarer.
