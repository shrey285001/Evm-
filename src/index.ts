const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request: Request, env: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string; ASSETS: any }) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/config") {
      return Response.json(
        {
          supabaseUrl: env.SUPABASE_URL,
          supabaseKey: env.SUPABASE_ANON_KEY,
        },
        { headers: corsHeaders }
      );
    }

    return env.ASSETS.fetch(request);
  },
};
