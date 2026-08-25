// Cloudflare Worker — Marathon de Vannes.
//
// Deux endpoints :
//   GET /setup?code=XXX  → TEMPORAIRE. Échange un code d'autorisation Strava
//                          contre un refresh_token et l'affiche en texte brut.
//                          À SUPPRIMER une fois le REFRESH_TOKEN enregistré
//                          (voir le bloc marqué « BLOC TEMPORAIRE » plus bas).
//   GET /activites       → Définitif. Renvoie les courses des 30 derniers jours
//                          en JSON allégé {date, distance_m, moving_time_s, name}.
//
// Variables d'environnement (Settings → Variables and Secrets) :
//   CLIENT_SECRET   (Secret)  — depuis « My API Application » sur Strava
//   REFRESH_TOKEN   (Secret)  — obtenu via /setup
//   ALLOWED_ORIGIN  (Text)    — origine autorisée en CORS, ex.
//                               https://latepictureclub.github.io
//                               Optionnel : « * » si absent.

const CLIENT_ID = '274097';
const TOKEN_URL = 'https://www.strava.com/oauth/token';
const ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities';
const TRENTE_JOURS_S = 30 * 24 * 60 * 60;

// Cache best-effort de l'access_token, en mémoire de l'isolate.
let cachedToken = null;

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function texte(corps, status = 200) {
  return new Response(corps, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function erreurJson(message, status, env) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders(env), 'Content-Type': 'application/json' },
  });
}

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expires_at > now + 60) {
    return cachedToken.access_token;
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
      refresh_token: env.REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json();

  if (!res.ok || !data.access_token) {
    throw new Error(
      `rafraîchissement du token refusé par Strava (${res.status}) : ${JSON.stringify(data)}`
    );
  }

  cachedToken = { access_token: data.access_token, expires_at: data.expires_at };
  return cachedToken.access_token;
}

// ---------------------------------------------------------------------------
// BLOC TEMPORAIRE — à supprimer après avoir enregistré REFRESH_TOKEN.
// Supprimez cette fonction ainsi que la branche `/setup` dans fetch().
// ---------------------------------------------------------------------------
async function handleSetup(url, env) {
  const code = url.searchParams.get('code');

  if (!code) {
    return texte(
      'Paramètre « code » manquant.\n\n' +
        "Autorisez l'application puis recopiez le paramètre code de l'URL de " +
        'redirection :\n\n' +
        `https://www.strava.com/oauth/authorize?client_id=${CLIENT_ID}` +
        '&redirect_uri=http://localhost&response_type=code' +
        '&approval_prompt=force&scope=activity:read_all\n\n' +
        'Puis appelez :  /setup?code=LE_CODE\n',
      400
    );
  }

  if (!env.CLIENT_SECRET) {
    return texte(
      'CLIENT_SECRET absent.\n\n' +
        'Dashboard Cloudflare → ce Worker → Settings → Variables and Secrets →\n' +
        'ajoutez CLIENT_SECRET (type Secret), puis relancez /setup?code=...\n',
      500
    );
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  });

  const data = await res.json();

  if (!res.ok || !data.refresh_token) {
    return texte(
      `Échange refusé par Strava (HTTP ${res.status}).\n\n` +
        `Réponse : ${JSON.stringify(data, null, 2)}\n\n` +
        'Causes fréquentes : code déjà utilisé, code expiré, CLIENT_SECRET\n' +
        'incorrect, ou scope insuffisant. Régénérez un code frais avec\n' +
        'scope=activity:read_all et réessayez.\n',
      502
    );
  }

  return texte(
    'refresh_token obtenu.\n\n' +
      '========================================\n' +
      data.refresh_token +
      '\n========================================\n\n' +
      'Étapes suivantes :\n' +
      '  1. Dashboard Cloudflare → ce Worker → Settings → Variables and Secrets\n' +
      '  2. Ajoutez REFRESH_TOKEN (type Secret) avec la valeur ci-dessus\n' +
      '  3. Ajoutez ALLOWED_ORIGIN (type Text) avec l\'origine de votre page,\n' +
      '     ex. https://latepictureclub.github.io\n' +
      '  4. Redéployez ce Worker SANS le bloc /setup\n' +
      '  5. Vérifiez en ouvrant /activites\n\n' +
      "Ce jeton n'expire pas. Ne le laissez pas dans votre historique de\n" +
      'navigation : supprimez cette URL une fois la valeur recopiée.\n'
  );
}
// ---------------------------------------------------------------------------
// FIN DU BLOC TEMPORAIRE
// ---------------------------------------------------------------------------

async function handleActivites(env) {
  if (!env.CLIENT_SECRET) {
    return erreurJson(
      'CLIENT_SECRET non configuré sur le Worker.',
      503,
      env
    );
  }

  if (!env.REFRESH_TOKEN) {
    return erreurJson(
      'REFRESH_TOKEN non configuré. Appelez /setup?code=... pour en obtenir un, ' +
        'puis enregistrez-le dans Settings → Variables and Secrets.',
      503,
      env
    );
  }

  const accessToken = await getAccessToken(env);
  const after = Math.floor(Date.now() / 1000) - TRENTE_JOURS_S;

  const res = await fetch(`${ACTIVITIES_URL}?after=${after}&per_page=100`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const corps = await res.text();
    throw new Error(`lecture des activités refusée (${res.status}) : ${corps}`);
  }

  const activites = await res.json();
  const runs = activites
    .filter((a) => a.type === 'Run')
    .map((a) => ({
      date: (a.start_date_local || a.start_date).slice(0, 10),
      distance_m: a.distance,
      moving_time_s: a.moving_time,
      name: a.name,
    }));

  return new Response(JSON.stringify(runs), {
    headers: { ...corsHeaders(env), 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    if (request.method !== 'GET') {
      return erreurJson('Méthode non autorisée.', 405, env);
    }

    try {
      // BLOC TEMPORAIRE — supprimer avec handleSetup().
      if (url.pathname === '/setup') {
        return await handleSetup(url, env);
      }

      if (url.pathname === '/activites') {
        return await handleActivites(env);
      }

      return erreurJson('Endpoint inconnu.', 404, env);
    } catch (err) {
      return erreurJson(err.message, 502, env);
    }
  },
};
