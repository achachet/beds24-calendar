# Déploiement sur Render (Static Site)

## Local — première fois

```bash
cp .env.example .env
# édite .env : choisis un APP_PASSWORD et colle ton BEDS24_REFRESH_TOKEN
npm install
set -a; source .env; set +a; npm run dev
```

Le mot de passe (`APP_PASSWORD`) sera demandé au premier chargement et stocké en localStorage.

## Render

1. **New → Static Site** → connecte le repo Git
2. Build settings :
   - **Build command** : `npm install && npm run build`
   - **Publish directory** : `dist`
3. **Environment variables** (onglet Environment) :
   - `APP_PASSWORD` = mot de passe à partager avec les utilisateurs autorisés
   - `BEDS24_REFRESH_TOKEN` = ton refresh token Beds24
4. Deploy

Le token est chiffré au build (AES-256-GCM, PBKDF2 250k iterations). Le ciphertext est bundlé dans le JS, le mot de passe le déchiffre côté navigateur.

## Notes

- Pour changer `APP_PASSWORD` ou `BEDS24_REFRESH_TOKEN` : modifie l'env var sur Render → trigger un redeploy. Les utilisateurs devront réentrer le nouveau mot de passe (l'ancien stocké en localStorage ne déchiffrera plus).
- Pour bloquer une propriété supplémentaire : ajoute son ID dans `BLOCKED_PROPERTY_IDS` ([src/api.js](src/api.js)).
- Le token Beds24 est read-only ? Vérifie dans Beds24 → API V2 → permissions de l'invite code utilisé. Si oui : un utilisateur curieux pourrait extraire le token déchiffré de la mémoire navigateur, mais ne pourrait que lire — pas de risque de modification.

## CORS

L'app appelle directement `https://beds24.com/api/v2/...` en production. Si Beds24 bloque CORS depuis ton domaine Render, il faudra basculer sur un proxy (Cloudflare Worker, Render Web Service, etc.).
