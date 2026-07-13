const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request: Request, env: { ASSETS: any }) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const apiUrl = `${url.protocol}//${url.host}${url.pathname}${url.search}`;
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
