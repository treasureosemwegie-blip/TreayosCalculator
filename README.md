# Calculator

Static calculator app with a small Node server that also provides a shared, server-side AI proxy.

## Shared AI

The browser calls `/api/chat`. The server adds the API key, so visitors never see or configure it.

1. Copy `.env.example` to `.env`.
2. Put your provider key in `OPENAI_API_KEY` inside `.env`.
3. Run `npm start`.
4. Open `http://localhost:8000`.

Optional settings in `.env`:

- `AI_MODEL` (default `gpt-4o-mini`)
- `AI_BASE_URL` (default `https://api.openai.com/v1`)
- `PORT` (default `8000`)
- `AI_RATE_LIMIT` (requests per IP per 10 minutes, default `30`)
- `AI_GLOBAL_RATE_LIMIT` (all requests per 10 minutes, default `240`)
- `CORS_ORIGINS` (extra comma-separated browser origins allowed to call the API)

The server also accepts the local Capacitor app origins (`http://localhost`, `https://localhost`, `capacitor://localhost`, and `ionic://localhost`) for the Android wrapper.

## Android APK

The native Android wrapper is built with Capacitor. A ready-to-install debug APK is in:

```
dist\TreayosCalculator-debug.apk
```

### Install the debug APK

1. Copy the APK to the phone.
2. Allow installs from unknown sources for the file manager or browser you use to open it.
3. Open the APK and install.

The debug APK is signed with the standard Android debug key. It is for testing and side-loading, not Play Store distribution.

### Current build

The APK in `dist` was built with this embedded API address:

```
https://treayos-calculator.onrender.com
```

It uses the hosted Render backend, the HTTPS Capacitor scheme, and no cleartext traffic. The calculator, converter, and history work offline. MathsAI needs an internet connection and a working Render service.

The build is debug-signed, so it is for testing and side-loading, not Play Store distribution.

For local LAN development, set `CALC_API_BASE` to `http://192.168.1.151:8000`, set `server.androidScheme` in `capacitor.config.json` back to `http`, and re-add `android:usesCleartextTraffic="true"` before building.

### Read-aloud

Button callouts, the converter's **Hear result**, and MathsAI answer read-out use the Android system text-to-speech engine in the APK. The web/PWA version falls back to the browser's Web Speech API. No microphone permission is used; the app only speaks.

If read-aloud is silent, check:

1. Media volume is turned up.
2. Android **Settings → Accessibility → Text-to-speech output** has a speech engine and an English voice installed.
3. The app's sound toggle is on.

This build is version `1.2` (`versionCode 3`), so it updates over the previous `1.1` install. If Android refuses the update because of a signature mismatch, uninstall the old app first.

### Rebuild the APK

Requirements:

- Node.js 18 or newer
- JDK 17
- Android SDK with `platforms;android-34`, `build-tools;34.0.0`, and `platform-tools`
- `sdk.dir` set in `android/local.properties`

Build and copy the debug APK:

```powershell
npm install
npm run android:apk
```

Output:

```
android\app\build\outputs\apk\debug\app-debug.apk
dist\TreayosCalculator-debug.apk
```

To use a different AI server:

```powershell
$env:CALC_API_BASE = "https://your-server.example.com"
npm run android:apk
```

### Production release

The current `1.2` build already uses the hosted HTTPS backend, `server.androidScheme: "https"`, and no cleartext traffic.

Before a Play Store release:

1. Add a release signing key and build a signed AAB/APK.
2. Check the current Play Store target API requirement before publishing.

Keep `OPENAI_API_KEY` on the server. Never bundle `.env`, the API key, or other secrets in the Android app.

## Install as a PWA

The web app includes a manifest and service worker, so it can also be installed from Chrome without the APK.

1. Deploy the Node server behind HTTPS.
2. Open the site in Chrome on Android.
3. Tap the browser menu, then **Install app** or **Add to Home screen**.

The calculator, converter, and history work from the cached app shell when offline. MathsAI still needs the server and a network connection.

When changing the app shell files, bump `CACHE_NAME` in `sw.js` so installed copies refresh their cache.

## Deploy on Render

The repository includes a `render.yaml` Blueprint. It runs `server.js` as a normal Node web service; the server serves both the web app and `/api/chat`, so the API key stays on the server. No serverless rewrite is needed.

### 1. Push the project to GitHub

If the project is not already a Git repository:

```powershell
git init
git add .
git commit -m "Deploy Treayos"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

Do not commit `.env`. It should be excluded by `.gitignore`; check with `git status --short` before pushing. If the key was ever committed, rotate it.

### 2. Create the Render service

1. In Render, choose **New → Blueprint** and connect the GitHub repository. Render reads `render.yaml`.
2. When prompted, enter `OPENAI_API_KEY`. The Blueprint also sets `AI_MODEL=gemini-3-flash-preview` and `AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai` to match the Gemini-compatible setup; change both in the dashboard if you use a different provider.
3. If you create the service manually instead, use:
   - Runtime: **Node**
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/api/health`

Optional environment variables:

- `CORS_ORIGINS` — only needed if the web app and API are on different origins
- `AI_RATE_LIMIT` — requests per IP per 10 minutes (default `30`)
- `AI_GLOBAL_RATE_LIMIT` — all requests per 10 minutes (default `240`)

### 3. Verify the deployment

Open:

```text
https://YOUR-SERVICE.onrender.com/api/health
```

A working deployment returns `200` with `configured: true`. Then open the site root in Chrome and install it as a PWA if needed.

The free Render plan sleeps after inactivity, so the first request after a quiet period can take 30–60 seconds. Use a paid instance for always-on MathsAI.

### 4. Rebuild the Android APK

The current APK points to the LAN server. Rebuild it with the Render HTTPS URL:

```powershell
$env:CALC_API_BASE = "https://YOUR-SERVICE.onrender.com"
npm run android:apk
```

For a public APK, also complete the HTTPS and release-signing steps in [Production release](#production-release). The APK and the PWA share the same backend; hosting the website does not publish the APK.

`www/` is the Android bundle, not a generic web build. Deploy the project root through `server.js`; do not publish `www/` as the website.

If you add a custom domain in Render, use that HTTPS origin for `CALC_API_BASE` and for any `CORS_ORIGINS` entry.

Do not commit `.env`. The key belongs only in the hosting dashboard or environment.
