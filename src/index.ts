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

type Env = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  ASSETS: any;
};

function getSupabaseKey(env: { SUPABASE_ANON_KEY: string; SUPABASE_SERVICE_ROLE_KEY?: string; SUPABASE_SECRET_KEY?: string }, requireWrite = false) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || env.SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error('Supabase key is not configured in worker environment. Set SUPABASE_ANON_KEY and/or SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY.');
  }
  if (requireWrite && !(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY)) {
    throw new Error('Supabase write key is required for this operation. Set SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY in worker environment.');
  }
  return key;
}

async function supabaseFetch(env: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string; SUPABASE_SERVICE_ROLE_KEY?: string; SUPABASE_SECRET_KEY?: string }, path: string, init: RequestInit = {}, requireWrite = false) {
  const url = `${env.SUPABASE_URL}/rest/v1${path}`;
  const key = getSupabaseKey(env, requireWrite);
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

function quoteSupabaseString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

async function getPositionsWithCandidates(env: Env) {
  try {
    const positions = await supabaseFetch(env, "/positions?select=id,title,round,active&order=round.asc,id.asc");
    const candidates = await supabaseFetch(env, "/candidates?select=id,position_id,name,house,symbol,avatar&order=position_id.asc,id.asc");
    const positionsArray = Array.isArray(positions) ? positions : [];
    const candidatesArray = Array.isArray(candidates) ? candidates : [];
    return positionsArray.map((pos: any) => ({
      ...pos,
      candidates: candidatesArray
        .filter((c: any) => c.position_id === pos.id)
        .map((c: any) => ({
          id: c.id,
          name: c.name || "",
          house: c.house || "",
          symbol: c.symbol || "",
          avatar: c.avatar || "",
        })),
    }));
  } catch (err) {
    const config = await getOrCreateConfig(env);
    return config.positions || [];
  }
}

async function upsertConfigAndDynamicData(env: Env, newConfig: any) {
  const configUpdate = {
    id: 1,
    schoolname: newConfig.schoolName,
    adminpassword: newConfig.adminPassword,
  };
  await supabaseFetch(env, "/config?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify([configUpdate]),
  }, true);

  const positions = Array.isArray(newConfig.positions) ? newConfig.positions : [];
  if (positions.length === 0) {
    return;
  }

  const positionRows = positions.map((pos: any) => ({
    id: pos.id,
    title: pos.title,
    round: pos.round,
    active: pos.active,
  }));
  await supabaseFetch(env, "/positions?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(positionRows),
  }, true);

  const candidateRows = positions.flatMap((pos: any) => {
    return (Array.isArray(pos.candidates) ? pos.candidates : []).map((cand: any) => ({
      id: cand.id,
      position_id: pos.id,
      name: cand.name,
      house: cand.house || "",
      symbol: cand.symbol || "",
      avatar: cand.avatar || "",
    }));
  });
  if (candidateRows.length > 0) {
    await supabaseFetch(env, "/candidates?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(candidateRows),
    }, true);
  }
}

async function getOrCreateConfig(env: Env) {
  const data = await supabaseFetch(env, "/config?select=*&limit=1");
  const config = Array.isArray(data) && data.length > 0 ? data[0] : null;
  if (config) {
    return config;
  }

  const defaultConfig = {
    id: 1,
    schoolname: "",
    adminpassword: "",
    positions: [],
  };
  await supabaseFetch(env, "/config?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify([defaultConfig]),
  }, true);
  return defaultConfig;
}

async function handleConfig(request: Request, env: Env) {
  if (request.method === "GET") {
    const config = await getOrCreateConfig(env);
    const positions = await getPositionsWithCandidates(env);
    return jsonResponse({
      id: config.id,
      schoolName: config.schoolname || config.schoolName || "",
      adminPassword: config.adminpassword || config.adminPassword || "",
      positions,
    });
  }

  if (request.method === "POST") {
    const newConfig = await request.json();
    await upsertConfigAndDynamicData(env, newConfig);
    return jsonResponse({ success: true });
  }

  return new Response(null, { status: 405, headers: corsHeaders });
}

async function handleVote(request: Request, env: Env) {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: corsHeaders });
  }

  const vote = await request.json();
  await supabaseFetch(env, "/votes", {
    method: "POST",
    body: JSON.stringify([vote]),
  }, true);
  return jsonResponse({ success: true });
}

async function handleResults(request: Request, env: Env) {
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: corsHeaders });
  }

  const config = await getOrCreateConfig(env);
  const positions = await getPositionsWithCandidates(env);
  const votes = await supabaseFetch(env, "/votes?select=*");

  let totalVoters = 0;
  let totalVotesCast = 0;

  const perPosition = (positions || []).map((pos: any) => {
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
  async fetch(request: Request, env: Env) {
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
