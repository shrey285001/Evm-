const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request: Request, env: { BACKEND_URL?: string; ASSETS: any }) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const backendUrl = env.BACKEND_URL || "http://127.0.0.1:3000";

    if (url.pathname.startsWith("/api/")) {
      const apiUrl = `${backendUrl}${url.pathname}${url.search}`;
      const backendRequest = new Request(apiUrl, {
        method: request.method,
        headers: request.headers,
        body: request.method === "GET" || request.method === "HEAD" ? null : request.body,
        redirect: "manual",
      });

      const response = await fetch(backendRequest);
      const responseBody = await response.arrayBuffer();
      const headers = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => headers.set(key, value));

      return new Response(responseBody, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    return env.ASSETS.fetch(request);
  },
};
