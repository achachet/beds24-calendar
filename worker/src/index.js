// ============================================
// Beds24 CORS proxy — Cloudflare Worker
// ============================================
// Forward /api/v2/* → https://beds24.com/api/v2/*
// Ajoute les headers CORS pour autoriser ton domaine Render.
// Bloque la propriété 306154 (defense in depth).
// ============================================

const TARGET = "https://beds24.com";
const BLOCKED_PROPERTY_IDS = new Set(["306154"]);

// Modifier via wrangler secret ou env var
const ALLOWED_ORIGINS = [
  "https://beds24-calendar.onrender.com",
  "http://localhost:5173",
  "http://localhost:4173",
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, token, refreshToken",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function blockPropertyCheck(url) {
  // Bloque toute requête mentionnant un ID de propriété banni
  const params = url.searchParams;
  const propId = params.get("propertyId");
  if (propId && BLOCKED_PROPERTY_IDS.has(propId)) return true;
  // Vérifie aussi un éventuel propertyId dans le path
  for (const blocked of BLOCKED_PROPERTY_IDS) {
    if (url.pathname.includes(`/${blocked}`)) return true;
  }
  return false;
}

async function filterPropertiesResponse(response) {
  // Strip la prop bloquée du payload de /properties
  const data = await response.json();
  if (Array.isArray(data?.data)) {
    data.data = data.data.filter((p) => !BLOCKED_PROPERTY_IDS.has(String(p.id)));
  }
  return new Response(JSON.stringify(data), {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/v2/")) {
      return new Response("Not found", { status: 404, headers: cors });
    }

    // Filtre prop bloquée
    if (blockPropertyCheck(url)) {
      return new Response(JSON.stringify({ error: "Forbidden property" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Forward vers Beds24
    const targetUrl = TARGET + url.pathname + url.search;
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("origin");
    headers.delete("referer");

    const init = {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
      redirect: "follow",
    };

    let upstream;
    try {
      upstream = await fetch(targetUrl, init);
    } catch (err) {
      return new Response(JSON.stringify({ error: "Upstream fetch failed: " + err.message }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Filtre la réponse de /properties pour stripper la prop bannie
    if (url.pathname === "/api/v2/properties" && upstream.ok) {
      const filtered = await filterPropertiesResponse(upstream);
      return new Response(filtered.body, {
        status: filtered.status,
        headers: { ...Object.fromEntries(filtered.headers), ...cors },
      });
    }

    // Sinon, on relaie tel quel + headers CORS
    const respHeaders = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors)) respHeaders.set(k, v);
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  },
};
