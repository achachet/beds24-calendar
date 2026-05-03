// ============================================
// Calendrier Beds24 — Vue multi-propriétés (pastilles)
// ============================================

import { getProperties, getCalendar, getBookings, updateCalendar } from "./api.js";
import { ensureAuth, logout } from "./auth.js";

const MONTHS_TO_SHOW = 36;

const COLOR_PALETTE = [
  "#FF385C", "#008489", "#6B47DC", "#E08600", "#2D8CFF",
  "#00A699", "#C13584", "#FD7E14", "#20C997", "#914669",
  "#3B82F6", "#DC3545", "#7C3AED", "#0EA5E9", "#F59E0B",
];

const state = {
  properties: [],
  selectedIds: [],          // [propId, ...] — ordre = ordre des lanes
  data: {},                 // propId → { roomId, calendarData, bookings }
  selectionStart: null,
  selectionEnd: null,
};

const cache = {}; // propId → { roomId, calendarData, bookings }

// ---------- DOM refs ----------
const propertyLegend = document.getElementById("property-legend");
const selectAllBtn = document.getElementById("select-all-btn");
const selectNoneBtn = document.getElementById("select-none-btn");
const monthsContainer = document.getElementById("months-container");
const selectionBar = document.getElementById("selection-bar");
const selectionInfo = document.getElementById("selection-info");

const editPanel = document.getElementById("edit-panel");
const panelTitle = document.getElementById("panel-title");
const panelSummary = document.getElementById("panel-summary");
const editAvailability = document.getElementById("edit-availability");
const editMinStay = document.getElementById("edit-min-stay");
const editPrice = document.getElementById("edit-price");
const saveBtn = document.getElementById("save-changes");
const saveStatus = document.getElementById("save-status");

const bookingModal = document.getElementById("booking-modal");
const bookingModalBody = document.getElementById("booking-modal-body");
const bookingModalTitle = document.getElementById("booking-modal-title");
const bookingColorDot = document.getElementById("booking-color-dot");

// ---------- Init ----------

async function init() {
  document.getElementById("close-panel").addEventListener("click", closeEditPanel);
  saveBtn.addEventListener("click", onSave);
  document.getElementById("booking-modal-close").addEventListener("click", closeBookingModal);
  bookingModal.querySelector(".booking-modal-backdrop").addEventListener("click", closeBookingModal);
  selectAllBtn.addEventListener("click", () => onSelectAll(true));
  selectNoneBtn.addEventListener("click", () => onSelectAll(false));
  document.getElementById("logout-btn").addEventListener("click", logout);

  await ensureAuth();
  window.addEventListener("popstate", () => {
    state.selectedIds = parseUrlIds();
    refreshAll();
    renderLegend();
  });

  try {
    showLoading("Chargement des propriétés…");
    state.properties = await getProperties();
    hideLoading();

    state.selectedIds = parseUrlIds();
    renderLegend();
    await refreshAll();
  } catch (err) {
    hideLoading();
    alert("Erreur : " + err.message);
  }
}

async function onSelectAll(all) {
  state.selectedIds = all ? state.properties.map((p) => p.id) : [];
  syncUrl();
  renderLegend();
  clearSelection();
  await refreshAll();
}

// ---------- URL sync ----------

function parseUrlIds() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("props");
  if (!raw) return [];
  const ids = raw.split(",").map((s) => Number(s.trim())).filter(Boolean);
  // garder seulement ceux qui existent
  return ids.filter((id) => state.properties.some((p) => p.id === id));
}

function syncUrl() {
  const params = new URLSearchParams(window.location.search);
  if (state.selectedIds.length > 0) {
    params.set("props", state.selectedIds.join(","));
  } else {
    params.delete("props");
  }
  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}

// ---------- Legend (toggleable inline) ----------

function renderLegend() {
  propertyLegend.innerHTML = "";
  state.properties.forEach((p, idx) => {
    const color = colorForIndex(idx);
    const selected = state.selectedIds.includes(p.id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "legend-item" + (selected ? " selected" : "");
    btn.style.setProperty("--legend-color", color);
    btn.innerHTML = `
      <span class="legend-dot"></span>
      <span class="legend-name">${escapeHtml(p.name)}</span>
    `;
    btn.addEventListener("click", () => onTogglePropertyId(p.id, !selected));
    propertyLegend.appendChild(btn);
  });
}

async function onTogglePropertyId(id, checked) {
  if (checked) {
    if (!state.selectedIds.includes(id)) state.selectedIds.push(id);
  } else {
    state.selectedIds = state.selectedIds.filter((x) => x !== id);
  }
  syncUrl();
  renderLegend();
  clearSelection();
  await refreshAll();
}

// ---------- Couleurs ----------

function colorForIndex(idx) {
  return COLOR_PALETTE[idx % COLOR_PALETTE.length];
}
function colorForId(propId) {
  const idx = state.properties.findIndex((p) => p.id === propId);
  return colorForIndex(idx);
}

// ---------- Data loading ----------

async function refreshAll() {
  if (state.selectedIds.length === 0) {
    state.data = {};
    renderAllMonths();
    return;
  }

  const now = new Date();
  const from = formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = formatDate(new Date(now.getFullYear(), now.getMonth() + MONTHS_TO_SHOW, 0));

  const toLoad = state.selectedIds.filter((id) => !cache[id]);
  if (toLoad.length > 0) {
    showLoading(`Chargement de ${toLoad.length} propriété${toLoad.length > 1 ? "s" : ""}…`);
    try {
      await Promise.all(toLoad.map(async (id) => {
        const [calResult, bookings] = await Promise.all([
          getCalendar(id, from, to),
          getBookings(id, from, to),
        ]);
        cache[id] = {
          roomId: calResult.roomId,
          calendarData: calResult.days,
          bookings,
        };
      }));
    } catch (err) {
      hideLoading();
      console.error(err);
      alert("Erreur de chargement : " + err.message);
      return;
    }
    hideLoading();
  }

  state.data = {};
  for (const id of state.selectedIds) state.data[id] = cache[id];
  renderAllMonths();
}

// ---------- Rendering ----------

const MONTH_NAMES = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];
const DAY_HEADERS = ["L", "M", "M", "J", "V", "S", "D"];
const todayStr = formatDate(new Date());

function renderAllMonths() {
  monthsContainer.innerHTML = "";
  if (state.selectedIds.length === 0) {
    monthsContainer.innerHTML = `<div class="empty-state">Sélectionnez une ou plusieurs propriétés pour voir le calendrier.</div>`;
    return;
  }

  const now = new Date();
  const startYear = now.getFullYear();
  const startMonth = now.getMonth();

  for (let i = 0; i < MONTHS_TO_SHOW; i++) {
    const year = startYear + Math.floor((startMonth + i) / 12);
    const month = (startMonth + i) % 12;
    monthsContainer.appendChild(renderOneMonth(year, month));
  }
}

function renderOneMonth(year, month) {
  const section = document.createElement("section");
  section.className = "month-section";

  const title = document.createElement("h2");
  title.className = "month-title";
  title.textContent = `${MONTH_NAMES[month]} ${year}`;
  section.appendChild(title);

  const header = document.createElement("div");
  header.className = "calendar-header";
  for (const d of DAY_HEADERS) {
    const cell = document.createElement("div");
    cell.textContent = d;
    header.appendChild(cell);
  }
  section.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "calendar-grid";

  const firstDay = new Date(year, month, 1);
  let startDow = firstDay.getDay() - 1;
  if (startDow < 0) startDow = 6;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < startDow; i++) {
    const cell = document.createElement("div");
    cell.className = "day-cell empty";
    grid.appendChild(cell);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = formatDate(new Date(year, month, d));
    grid.appendChild(createDayCell(d, dateStr));
  }

  section.appendChild(grid);
  return section;
}

function getBookingForPropOnDate(propId, dateStr) {
  const data = state.data[propId];
  if (!data) return null;
  return data.bookings.find((b) => dateStr >= b.arrival && dateStr < b.departure) || null;
}

/**
 * Retourne tous les segments à dessiner sur une cellule pour une propriété.
 * kind: 'arrival' | 'middle' | 'departure'
 * Une cellule peut contenir 'departure' + 'arrival' simultanément (back-to-back).
 */
function getCellSegmentsForProp(propId, dateStr) {
  const data = state.data[propId];
  if (!data) return [];
  const out = [];
  for (const b of data.bookings) {
    if (dateStr === b.arrival && dateStr === b.departure) continue; // edge case impossible
    if (dateStr === b.arrival) out.push({ booking: b, kind: "arrival" });
    else if (dateStr === b.departure) out.push({ booking: b, kind: "departure" });
    else if (dateStr > b.arrival && dateStr < b.departure) out.push({ booking: b, kind: "middle" });
  }
  return out;
}

function createDayCell(dayNum, dateStr) {
  const cell = document.createElement("div");
  cell.className = "day-cell";
  cell.dataset.date = dateStr;

  if (dateStr === todayStr) cell.classList.add("today");
  if (isDateInSelection(dateStr)) cell.classList.add("selected");

  // Day number
  const dayEl = document.createElement("div");
  dayEl.className = "day-number";
  dayEl.textContent = dayNum;
  cell.appendChild(dayEl);

  const singleProp = state.selectedIds.length === 1 ? state.selectedIds[0] : null;

  // En mode mono-propriété : afficher le prix si pas de booking (cohérent avec l'avant)
  if (singleProp) {
    const dayData = (state.data[singleProp]?.calendarData || {})[dateStr] || {};
    const booking = getBookingForPropOnDate(singleProp, dateStr);
    if (dayData.availability === 0 && !booking) cell.classList.add("unavailable");
    if (!booking && dayData.price1 != null) {
      const price = document.createElement("div");
      price.className = "day-price";
      price.textContent = `${Number(dayData.price1).toFixed(0)} €`;
      cell.appendChild(price);
    }
    if (!booking && dayData.minStay > 1) {
      const ms = document.createElement("div");
      ms.className = "day-minstay";
      ms.textContent = `min ${dayData.minStay}n`;
      cell.appendChild(ms);
    }
  }

  // Lanes (1 par propriété sélectionnée)
  const lanes = document.createElement("div");
  lanes.className = "day-lanes";
  state.selectedIds.forEach((propId) => {
    const lane = document.createElement("div");
    lane.className = "lane";
    const segments = getCellSegmentsForProp(propId, dateStr);
    for (const seg of segments) {
      const pill = document.createElement("div");
      pill.className = "pill pill-" + seg.kind;
      pill.style.background = colorForId(propId);
      if (seg.kind === "arrival") {
        const label = document.createElement("span");
        label.className = "pill-label";
        const occ = (seg.booking.numAdult ?? 0) + (seg.booking.numChild ?? 0);
        label.textContent = occ > 0 ? `${seg.booking.guestName} · ${occ}` : seg.booking.guestName;
        pill.appendChild(label);
      }
      pill.addEventListener("click", (e) => {
        e.stopPropagation();
        openBookingModal(seg.booking, propId);
      });
      lane.appendChild(pill);
    }
    lanes.appendChild(lane);
  });
  cell.appendChild(lanes);

  cell.addEventListener("click", (e) => onDayClick(dateStr, e));
  return cell;
}

// ---------- Sélection (édition mono-prop) ----------

function onDayClick(dateStr, event) {
  if (state.selectedIds.length !== 1) return; // édition active seulement en mono-prop

  if (event.shiftKey && state.selectionStart) {
    state.selectionEnd = dateStr;
    if (state.selectionStart > state.selectionEnd) {
      [state.selectionStart, state.selectionEnd] = [state.selectionEnd, state.selectionStart];
    }
  } else {
    state.selectionStart = dateStr;
    state.selectionEnd = dateStr;
  }

  updateSelectionHighlight();
  updateSelectionInfo();
  openEditPanel();
}

function updateSelectionHighlight() {
  document.querySelectorAll(".day-cell.selected").forEach((el) => el.classList.remove("selected"));
  if (!state.selectionStart || !state.selectionEnd) return;
  document.querySelectorAll(".day-cell[data-date]").forEach((el) => {
    const d = el.dataset.date;
    if (d >= state.selectionStart && d <= state.selectionEnd) el.classList.add("selected");
  });
}

function isDateInSelection(dateStr) {
  if (!state.selectionStart || !state.selectionEnd) return false;
  return dateStr >= state.selectionStart && dateStr <= state.selectionEnd;
}

function clearSelection() {
  state.selectionStart = null;
  state.selectionEnd = null;
  selectionBar.classList.add("hidden");
  selectionInfo.textContent = "";
  closeEditPanel();
  updateSelectionHighlight();
}

function updateSelectionInfo() {
  if (!state.selectionStart) {
    selectionBar.classList.add("hidden");
    return;
  }
  selectionBar.classList.remove("hidden");
  const start = formatDateFR(state.selectionStart);
  const end = formatDateFR(state.selectionEnd);
  selectionInfo.textContent =
    state.selectionStart === state.selectionEnd
      ? `Sélection : ${start}`
      : `Sélection : ${start} → ${end}`;
}

// ---------- Edit Panel (mono-prop) ----------

function openEditPanel() {
  if (state.selectedIds.length !== 1) return;
  const propId = state.selectedIds[0];
  const dayData = (state.data[propId]?.calendarData || {})[state.selectionStart] || {};
  editAvailability.value = dayData.availability != null ? dayData.availability : 1;
  editMinStay.value = dayData.minStay || 1;
  editPrice.value = dayData.price1 != null ? dayData.price1 : "";

  const start = formatDateFR(state.selectionStart);
  const end = formatDateFR(state.selectionEnd);
  panelTitle.textContent =
    state.selectionStart === state.selectionEnd
      ? `Modifier le ${start}`
      : `Modifier : ${start} → ${end}`;

  updatePanelSummary();
  saveStatus.textContent = "";
  saveStatus.className = "save-status";
  editPanel.classList.remove("hidden");
  document.getElementById("app").classList.add("panel-open");
}

function closeEditPanel() {
  editPanel.classList.add("hidden");
  document.getElementById("app").classList.remove("panel-open");
}

function updatePanelSummary() {
  if (state.selectedIds.length !== 1) { panelSummary.innerHTML = ""; return; }
  const propId = state.selectedIds[0];
  const dates = getSelectedDates();
  if (dates.length === 0) { panelSummary.innerHTML = ""; return; }

  const calendarData = state.data[propId]?.calendarData || {};
  const prices = [];
  let unavailCount = 0;
  let bookedCount = 0;
  const minStays = [];
  const bookingsInRange = [];

  for (const dateStr of dates) {
    const d = calendarData[dateStr] || {};
    if (d.price1 != null) prices.push(Number(d.price1));
    if (d.availability === 0) unavailCount++;
    if (d.minStay != null) minStays.push(d.minStay);
    const booking = getBookingForPropOnDate(propId, dateStr);
    if (booking) {
      bookedCount++;
      if (!bookingsInRange.find((b) => b.id === booking.id)) bookingsInRange.push(booking);
    }
  }

  let html = `<div class="summary-title">Résumé (${dates.length} jour${dates.length > 1 ? "s" : ""})</div>`;
  if (prices.length > 0) {
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    html += `<div class="summary-row"><span>Prix</span><span>${minP === maxP ? `${minP} €` : `${minP} – ${maxP} €`}</span></div>`;
  }
  if (minStays.length > 0) {
    const minM = Math.min(...minStays);
    const maxM = Math.max(...minStays);
    html += `<div class="summary-row"><span>Min nuits</span><span>${minM === maxM ? minM : `${minM} – ${maxM}`}</span></div>`;
  }
  if (bookedCount > 0) {
    html += `<div class="summary-row booked"><span>Réservés</span><span>${bookedCount} jour${bookedCount > 1 ? "s" : ""}</span></div>`;
  }
  if (unavailCount > 0 && unavailCount !== bookedCount) {
    html += `<div class="summary-row"><span>Bloqués</span><span>${unavailCount - bookedCount} jour${(unavailCount - bookedCount) > 1 ? "s" : ""}</span></div>`;
  }
  panelSummary.innerHTML = html;
}

function getSelectedDates() {
  if (!state.selectionStart || !state.selectionEnd) return [];
  const dates = [];
  const start = new Date(state.selectionStart);
  const end = new Date(state.selectionEnd);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(formatDate(d));
  }
  return dates;
}

async function onSave() {
  if (state.selectedIds.length !== 1) return;
  const propId = state.selectedIds[0];
  const roomId = state.data[propId]?.roomId;
  if (!roomId || !state.selectionStart) return;

  const data = {
    availability: Number(editAvailability.value),
    minStay: Number(editMinStay.value),
    price1: editPrice.value !== "" ? Number(editPrice.value) : null,
  };

  saveBtn.disabled = true;
  saveBtn.textContent = "Enregistrement…";
  saveStatus.textContent = "";

  try {
    await updateCalendar(roomId, state.selectionStart, state.selectionEnd, data);
    const calendarData = state.data[propId].calendarData;
    for (const dateStr of getSelectedDates()) {
      calendarData[dateStr] = { ...calendarData[dateStr], date: dateStr, ...data };
    }
    cache[propId].calendarData = calendarData;
    renderAllMonths();
    updatePanelSummary();
    saveStatus.textContent = "Enregistré !";
    saveStatus.className = "save-status success";
  } catch (err) {
    console.error(err);
    saveStatus.textContent = "Erreur : " + err.message;
    saveStatus.className = "save-status error";
  }
  saveBtn.disabled = false;
  saveBtn.textContent = "Enregistrer";
}

// ---------- Booking Modal ----------

function openBookingModal(booking, propId) {
  const prop = state.properties.find((p) => p.id === propId);
  bookingModalTitle.textContent = booking.guestName;
  bookingColorDot.style.background = colorForId(propId);

  const occAdult = booking.numAdult ?? 0;
  const occChild = booking.numChild ?? 0;
  const occTotal = occAdult + occChild;

  const rows = [];
  if (prop) rows.push(["Propriété", escapeHtml(prop.name)]);
  rows.push(["Check-in", formatDateFR(booking.arrival)]);
  rows.push(["Check-out", formatDateFR(booking.departure)]);
  const nights = nightsBetween(booking.arrival, booking.departure);
  rows.push(["Nuits", String(nights)]);
  if (occTotal > 0) {
    let occText = `${occTotal}`;
    if (occChild > 0) occText += ` (${occAdult} adulte${occAdult > 1 ? "s" : ""}, ${occChild} enfant${occChild > 1 ? "s" : ""})`;
    rows.push(["Occupants", occText]);
  }
  if (booking.phone) {
    rows.push(["Téléphone", `<a href="tel:${escapeHtml(booking.phone)}">${escapeHtml(booking.phone)}</a>`]);
  }
  if (booking.email) {
    rows.push(["Email", `<a href="mailto:${escapeHtml(booking.email)}">${escapeHtml(booking.email)}</a>`]);
  }
  if (booking.channel) rows.push(["Source", escapeHtml(booking.channel)]);
  if (booking.status) rows.push(["Statut", escapeHtml(booking.status)]);

  bookingModalBody.innerHTML = rows.map(([k, v]) =>
    `<div class="booking-row"><span class="booking-key">${k}</span><span class="booking-val">${v}</span></div>`
  ).join("");

  bookingModal.classList.remove("hidden");
}

function closeBookingModal() {
  bookingModal.classList.add("hidden");
}

// ---------- Loading ----------

function showLoading(msg) {
  let overlay = document.querySelector(".loading-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "loading-overlay";
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `<div class="spinner"></div>${msg}`;
  overlay.style.display = "flex";
}

function hideLoading() {
  const overlay = document.querySelector(".loading-overlay");
  if (overlay) overlay.style.display = "none";
}

// ---------- Helpers ----------

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

function nightsBetween(a, b) {
  const ms = new Date(b) - new Date(a);
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function formatDateFR(dateStr) {
  const monthNames = ["janv.", "fév.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const [y, m, d] = dateStr.split("-");
  return `${parseInt(d)} ${monthNames[parseInt(m) - 1]} ${y}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

init();
