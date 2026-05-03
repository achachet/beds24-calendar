// ============================================
// Beds24 API V2 — Module de communication
// ============================================

import { getRefreshToken } from "./auth.js";

// En dev : vite proxy vers /api/v2 (CORS-safe)
// En prod : appel direct
const BASE = import.meta.env.PROD ? "https://beds24.com/api/v2" : "/api/v2";

let _token = null;
let _tokenExpires = 0;

/** Récupère un token valide (refresh si expiré) */
async function getToken() {
  if (_token && Date.now() < _tokenExpires) return _token;

  console.log("🔑 Refresh du token...");
  const res = await fetch(`${BASE}/authentication/token`, {
    method: "GET",
    headers: { refreshToken: getRefreshToken() },
  });
  const data = await res.json();
  if (!data.token) throw new Error("Échec refresh token: " + JSON.stringify(data));

  _token = data.token;
  // Expire 1h avant pour être safe (token dure 24h)
  _tokenExpires = Date.now() + (data.expiresIn - 3600) * 1000;
  console.log("🔑 Token OK, expire dans", data.expiresIn, "s");
  return _token;
}

/** Appel GET authentifié */
async function apiGet(path) {
  const token = await getToken();
  console.log("📡 GET", path);
  const res = await fetch(`${BASE}${path}`, {
    headers: { token },
  });
  const data = await res.json();
  console.log("   →", data);
  if (data.success === false) throw new Error(data.error || "API error");
  return data;
}

/** Appel POST authentifié */
async function apiPost(path, body) {
  const token = await getToken();
  console.log("📡 POST", path, body);
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  console.log("   →", data);
  return data;
}

// ---------- Propriétés ----------

const BLOCKED_PROPERTY_IDS = new Set([306154]);

export async function getProperties() {
  const data = await apiGet("/properties");
  return (data.data || [])
    .filter((p) => !BLOCKED_PROPERTY_IDS.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      currency: p.currency || "EUR",
    }));
}

// ---------- Calendrier ----------

/**
 * Récupère le calendrier (availability + minStay) pour une propriété.
 * L'API retourne des plages compressées qu'on décompresse en jours individuels.
 */
export async function getCalendar(propertyId, from, to) {
  // Deux appels en parallèle : availability jour par jour + calendar (minStay/prix)
  const [availData, calData] = await Promise.all([
    apiGet(`/inventory/rooms/availability?propertyId=${propertyId}&startDate=${from}&endDate=${to}`),
    apiGet(`/inventory/rooms/calendar?propertyId=${propertyId}&startDate=${from}&endDate=${to}&includeMinStay=true&includePrices=true&includeNumAvail=true`),
  ]);

  // Extraire le premier room (chaque propriété a 1 room dans ton cas)
  const availRoom = availData.data?.[0];
  const calRoom = calData.data?.[0];
  const roomId = availRoom?.roomId || calRoom?.roomId;

  // Construire la map jour par jour
  const days = {};

  // Availability : { "2026-03-20": false, ... }
  if (availRoom?.availability) {
    for (const [date, avail] of Object.entries(availRoom.availability)) {
      days[date] = { date, roomId, availability: avail ? 1 : 0 };
    }
  }

  // Calendar : plages compressées [{ from, to, minStay, price1, inventory }, ...]
  if (calRoom?.calendar) {
    for (const range of calRoom.calendar) {
      const start = new Date(range.from);
      const end = new Date(range.to);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        if (!days[dateStr]) days[dateStr] = { date: dateStr, roomId };
        if (range.minStay != null) days[dateStr].minStay = range.minStay;
        if (range.price1 != null) days[dateStr].price1 = range.price1;
        if (range.numAvail != null) days[dateStr].numAvail = range.numAvail;
      }
    }
  }

  return { roomId, days };
}

/**
 * Met à jour le calendrier pour un room.
 */
// ---------- Réservations ----------

/**
 * Récupère les réservations qui chevauchent la plage [from, to].
 * Retourne un tableau de { id, arrival, departure, guestName, channel, status }.
 */
export async function getBookings(propertyId, from, to) {
  // arrivalTo=to & departureFrom=from → toutes les réservations qui chevauchent la période
  const data = await apiGet(`/bookings?propertyId=${propertyId}&arrivalTo=${to}&departureFrom=${from}`);
  return (data.data || []).map((b) => ({
    id: b.id,
    roomId: b.roomId,
    arrival: b.arrival,
    departure: b.departure,
    guestName: [b.firstName, b.lastName].filter(Boolean).join(" ") || "Sans nom",
    firstName: b.firstName || "",
    lastName: b.lastName || "",
    phone: b.phone || b.mobile || "",
    email: b.email || "",
    numAdult: b.numAdult ?? null,
    numChild: b.numChild ?? null,
    channel: b.apiSource || b.referer || "",
    status: b.status,
    notes: b.notes || "",
  }));
}

// ---------- Mise à jour calendrier ----------

export async function updateCalendar(roomId, from, to, { availability, minStay, price1 }) {
  // L'API v2 attend un format avec un calendar array dans chaque objet
  const calendarEntry = { from, to };
  if (availability != null) calendarEntry.numAvail = availability;
  if (minStay != null) calendarEntry.minStay = minStay;
  if (price1 != null) calendarEntry.price1 = price1;

  const body = { roomId, calendar: [calendarEntry] };

  const result = await apiPost("/inventory/rooms/calendar", [body]);

  // Vérifier le résultat (c'est un tableau)
  if (Array.isArray(result) && result[0]?.success) return result[0];
  if (Array.isArray(result) && result[0]?.error) throw new Error(result[0].error);
  throw new Error("Réponse inattendue: " + JSON.stringify(result));
}
