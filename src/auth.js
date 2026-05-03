// ============================================
// Auth — décryption du token Beds24 + login modal
// ============================================
//
// Le mot de passe est stocké dans localStorage (permanent).
// On l'utilise pour décrypter le ENCRYPTED_TOKEN bundlé au build.
// ============================================

import { ENCRYPTED_TOKEN } from "./encrypted-token.js";

const LS_KEY = "beds24_pw";

let _cachedToken = null;

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveKey(password, salt, iterations) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

async function decryptToken(password) {
  if (!ENCRYPTED_TOKEN.data) {
    throw new Error("Aucun token chiffré bundlé (build manquant ?)");
  }
  const salt = b64ToBytes(ENCRYPTED_TOKEN.salt);
  const iv = b64ToBytes(ENCRYPTED_TOKEN.iv);
  const data = b64ToBytes(ENCRYPTED_TOKEN.data);
  const key = await deriveKey(password, salt, ENCRYPTED_TOKEN.iterations);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(plain);
}

/**
 * Garantit qu'on a un token déchiffré disponible.
 * Affiche un modal de login si nécessaire. Boucle jusqu'à succès.
 */
export async function ensureAuth() {
  if (_cachedToken) return _cachedToken;

  let pw = localStorage.getItem(LS_KEY);

  // Tente de décrypter avec le pw stocké
  if (pw) {
    try {
      _cachedToken = await decryptToken(pw);
      return _cachedToken;
    } catch {
      // mauvais pw → on demande à nouveau
      localStorage.removeItem(LS_KEY);
      pw = null;
    }
  }

  // Boucle login
  while (true) {
    pw = await promptPassword();
    try {
      _cachedToken = await decryptToken(pw);
      localStorage.setItem(LS_KEY, pw);
      hideLoginModal();
      return _cachedToken;
    } catch {
      setLoginError("Mot de passe incorrect");
    }
  }
}

export function getRefreshToken() {
  if (!_cachedToken) throw new Error("ensureAuth() doit être appelé d'abord");
  return _cachedToken;
}

export function logout() {
  localStorage.removeItem(LS_KEY);
  _cachedToken = null;
  location.reload();
}

// ---------- Modal ----------

function promptPassword() {
  return new Promise((resolve) => {
    const modal = document.getElementById("login-modal");
    const input = document.getElementById("login-password");
    const submit = document.getElementById("login-submit");
    const form = document.getElementById("login-form");

    setLoginError("");
    modal.classList.remove("hidden");
    input.value = "";
    setTimeout(() => input.focus(), 50);

    const onSubmit = (e) => {
      e.preventDefault();
      const val = input.value;
      if (!val) return;
      submit.disabled = true;
      submit.textContent = "Vérification…";
      // Petit délai pour laisser le UI respirer
      setTimeout(() => {
        submit.disabled = false;
        submit.textContent = "Se connecter";
        form.removeEventListener("submit", onSubmit);
        resolve(val);
      }, 50);
    };

    form.addEventListener("submit", onSubmit);
  });
}

function setLoginError(msg) {
  const el = document.getElementById("login-error");
  if (el) el.textContent = msg;
}

function hideLoginModal() {
  document.getElementById("login-modal").classList.add("hidden");
}
