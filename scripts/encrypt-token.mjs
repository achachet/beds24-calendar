// Build-time : chiffre le refresh token Beds24 avec APP_PASSWORD
// Sortie : src/encrypted-token.js (importé par auth.js)

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../src/encrypted-token.js");

const token = process.env.BEDS24_REFRESH_TOKEN;
const password = process.env.APP_PASSWORD;

if (!token || !password) {
  console.error("❌ BEDS24_REFRESH_TOKEN et APP_PASSWORD requis dans l'env");
  process.exit(1);
}

const ITERATIONS = 250_000;
const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");

const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
const authTag = cipher.getAuthTag();

// Concat ciphertext + authTag (format attendu par Web Crypto subtle)
const payload = Buffer.concat([ciphertext, authTag]);

const out = `// Auto-généré par scripts/encrypt-token.mjs — NE PAS ÉDITER
export const ENCRYPTED_TOKEN = {
  salt: "${salt.toString("base64")}",
  iv: "${iv.toString("base64")}",
  data: "${payload.toString("base64")}",
  iterations: ${ITERATIONS},
};
`;

fs.writeFileSync(OUT, out);
console.log(`✅ Token chiffré écrit dans ${OUT}`);
