const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function supabaseFetch(env: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string; SUPABASE_SERVICE_ROLE_KEY?: string }, path: string, init: RequestInit = {}) {
  const url = `${env.SUPABASE_URL}/rest/v1${path}`;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...init.headers,
  };

  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(`Supabase request failed (${response.status}): ${text}`);
  }
  return body;
}

async function handleConfig(request: Request, env: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string }) {
  if (request.method === "GET") {
    const data = await supabaseFetch(env, "/config?select=*&limit=1");
    const config = Array.isArray(data) && data.length > 0 ? data[0] : {};
    return jsonResponse({
      id: config.id,
      schoolName: config.schoolname || config.schoolName || "",
      adminPassword: config.adminpassword || config.adminPassword || "",
      positions: config.positions || [],
    });
  }

  if (request.method === "POST") {
    const newConfig = await request.json();
    const dbUpdate = {
      id: 1,
      schoolname: newConfig.schoolName,
      adminpassword: newConfig.adminPassword,
      positions: newConfig.positions,
    };
    await supabaseFetch(env, "/config?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([dbUpdate]),
    });
    return jsonResponse({ success: true });
  }

  return new Response(null, { status: 405, headers: corsHeaders });
}

async function handleVote(request: Request, env: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string }) {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: corsHeaders });
  }

  const vote = await request.json();
  await supabaseFetch(env, "/votes", {
    method: "POST",
    body: JSON.stringify([vote]),
  });
  return jsonResponse({ success: true });
}

async function handleResults(request: Request, env: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string }) {
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: corsHeaders });
  }

  const configData = await supabaseFetch(env, "/config?select=*&limit=1");
  const config = Array.isArray(configData) && configData.length > 0 ? configData[0] : { positions: [] };
  const votes = await supabaseFetch(env, "/votes?select=*");

  let totalVoters = 0;
  let totalVotesCast = 0;

  const perPosition = (config.positions || []).map((pos: any) => {
    const counts: Record<string, number> = {};
    (pos.candidates || []).forEach((c: any) => { counts[c.id] = 0; });

    const positionVotes = (votes || []).filter((v: any) => v.positionId === pos.id && v.round == pos.round);
    positionVotes.forEach((vote: any) => {
      if (counts.hasOwnProperty(vote.candidateId)) {
        counts[vote.candidateId]++;
        totalVotesCast++;
      }
    });

    const tv = positionVotes.length;
    totalVoters += tv;
    return { pos, counts, tv };
  });

  return jsonResponse({
    totalVoters,
    totalVotesCast,
    positionsConfigured: (config.positions || []).length,
    perPosition,
  });
}

export default {
  async fetch(request: Request, env: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string; ASSETS: any }) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (url.pathname === "/api/config") {
      return handleConfig(request, env);
    }

    if (url.pathname === "/api/vote") {
      return handleVote(request, env);
    }

    if (url.pathname === "/api/results") {
      return handleResults(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
