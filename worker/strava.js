// Cloudflare Worker — expose un seul endpoint GET /activites pour le plan Marathon de Vannes.
// Secrets attendus en variables d'environnement : CLIENT_SECRET, REFRESH_TOKEN.
// Variable non secrète : ALLOWED_ORIGIN (origine autorisée en CORS).

const CLIENT_ID = '274097';
const TOKEN_URL = 'https://www.strava.com/oauth/token';
const ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities';
const TRENTE_JOURS_S = 30 * 24 * 60 * 60;

// Mise en cache best-effort de l'access_token en mémoire de l'isolate.
let cachedToken = null;

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

  if (!res.ok) {
    throw new Error(`refresh Strava échoué (${res.status})`);
  }

  const data = await res.json();
  cachedToken = { access_token: data.access_token, expires_at: data.expires_at };
  return cachedToken.access_token;
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    if (url.pathname !== '/activites' || request.method !== 'GET') {
      return new Response('Not found', { status: 404, headers });
    }

    try {
      const accessToken = await getAccessToken(env);
      const after = Math.floor(Date.now() / 1000) - TRENTE_JOURS_S;

      const activitesRes = await fetch(
        `${ACTIVITIES_URL}?after=${after}&per_page=100`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!activitesRes.ok) {
        throw new Error(`lecture activités Strava échouée (${activitesRes.status})`);
      }

      const activites = await activitesRes.json();
      const runs = activites
        .filter((a) => a.type === 'Run')
        .map((a) => ({
          date: (a.start_date_local || a.start_date).slice(0, 10),
          distance_m: a.distance,
          moving_time_s: a.moving_time,
          name: a.name,
        }));

      return new Response(JSON.stringify(runs), {
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 502,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
  },
};
