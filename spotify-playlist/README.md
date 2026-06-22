# Spotify Playlist Importer

Paste a list of songs → get a Spotify playlist. Runs entirely in the browser (no backend, no build step).

## One-time setup

### 1. Create a Spotify app

1. Go to <https://developer.spotify.com/dashboard> and click **Create app**.
2. Give it any name/description. Set **Redirect URI** to the URL where you'll host this folder (see step 3).
3. Select **Web API** under "Which API/SDKs are you planning to use?"
4. Save.

### 2. Fill in `config.js`

Open `config.js` and set:

```js
const CONFIG = {
  CLIENT_ID:    'paste-your-client-id-here',
  REDIRECT_URI: 'https://YOUR_HOST/spotify-playlist/',
};
```

The `REDIRECT_URI` must match **exactly** what you registered in the Spotify dashboard (trailing slash matters).

### 3. Add yourself as a user (dev-mode apps)

In the Spotify dashboard → your app → **Settings** → **User Management**, add your Spotify email address. Dev-mode apps support up to 25 users — no Spotify review needed for personal use.

### 4. Host the folder

**GitHub Pages (recommended — zero extra accounts)**

1. Push this repo to GitHub.
2. Go to repo **Settings → Pages** → Source: `main` branch, `/ (root)`.
3. Your app will be at `https://<you>.github.io/djben/spotify-playlist/`.
4. Use that URL as the Redirect URI in both the Spotify dashboard and `config.js`.

**Local testing**

```bash
cd spotify-playlist
python3 -m http.server 8000
# open http://127.0.0.1:8000
```
Register `http://127.0.0.1:8000` (no trailing slash) as a Redirect URI in the dashboard, and use it in `config.js`.

Other static hosts (Vercel, Netlify, Cloudflare Pages) work identically — just match the redirect URI.

## Usage

1. Open the app URL on your phone and tap **Log in with Spotify**.
2. Approve the permissions.
3. Paste your song list (one per line). Any format works; `Artist - Title` gives the best matches.
4. Edit the playlist name if you like, then tap **Create Playlist**.
5. The app searches Spotify for each line, creates a private playlist, and adds all matched tracks.
6. A summary shows how many tracks were added and lists any lines that didn't match.

## Notes

- The access token lasts ~1 hour per session. Just log in again when it expires.
- Auto-picking the top search result is fast but occasionally grabs a cover or remix for ambiguous lines. Check the results summary and re-add any mismatches manually.
- The playlist is created **private** by default. Open it in Spotify and make it public there if you want.
- "Add to Home Screen" on iOS/Android makes the app icon appear on your home screen (PWA manifest included).
