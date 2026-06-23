// ── Constants ────────────────────────────────────────────────────────────────
const SPOTIFY_AUTH  = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN = 'https://accounts.spotify.com/api/token';
const API           = 'https://api.spotify.com/v1';
const SCOPES        = 'playlist-modify-private playlist-modify-public';
const BATCH_SIZE    = 100;

// ── PKCE helpers ─────────────────────────────────────────────────────────────
function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

function base64url(buf) {
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function sha256(plain) {
  const data = new TextEncoder().encode(plain);
  return crypto.subtle.digest('SHA-256', data);
}

async function pkceChallenge(verifier) {
  const hash = await sha256(verifier);
  return base64url(new Uint8Array(hash));
}

// ── Auth ─────────────────────────────────────────────────────────────────────
async function login() {
  const verifier  = base64url(randomBytes(48));
  const challenge = await pkceChallenge(verifier);
  const state     = base64url(randomBytes(16));

  sessionStorage.setItem('pkce_verifier', verifier);
  sessionStorage.setItem('oauth_state',   state);

  const params = new URLSearchParams({
    client_id:             CONFIG.CLIENT_ID,
    response_type:         'code',
    redirect_uri:          CONFIG.REDIRECT_URI,
    scope:                 SCOPES,
    state,
    code_challenge_method: 'S256',
    code_challenge:        challenge,
  });
  window.location.href = `${SPOTIFY_AUTH}?${params}`;
}

async function exchangeCode(code) {
  const verifier = sessionStorage.getItem('pkce_verifier');
  const res = await fetch(SPOTIFY_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  CONFIG.REDIRECT_URI,
      client_id:     CONFIG.CLIENT_ID,
      code_verifier: verifier,
    }),
  });
  sessionStorage.removeItem('pkce_verifier');
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${body}`);
  }
  return res.json();
}

function getToken()  { return sessionStorage.getItem('access_token'); }
function clearAuth() { sessionStorage.clear(); }

// ── Spotify API helpers ───────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    clearAuth();
    location.reload();
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Spotify API error ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function getMe() {
  return apiFetch('/me');
}

async function searchTrack(query) {
  const params = new URLSearchParams({ q: query, type: 'track', limit: '1' });
  const data   = await apiFetch(`/search?${params}`);
  return data?.tracks?.items?.[0]?.uri ?? null;
}

async function createPlaylist(userId, name) {
  return apiFetch(`/users/${userId}/playlists`, {
    method: 'POST',
    body: JSON.stringify({ name, public: false }),
  });
}

async function addTracks(playlistId, uris) {
  // Add in batches of 100
  for (let i = 0; i < uris.length; i += BATCH_SIZE) {
    await apiFetch(`/playlists/${playlistId}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ uris: uris.slice(i, i + BATCH_SIZE) }),
    });
  }
}

// ── UI helpers ────────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls)  e.className = cls;
  if (text) e.textContent = text;
  return e;
};

function showSection(id) {
  ['auth-section', 'app-section'].forEach(s => {
    $(s).classList.toggle('hidden', s !== id);
  });
}

function setProgress(pct, label) {
  $('progress-section').classList.remove('hidden');
  $('progress-fill').style.width = `${pct}%`;
  $('progress-label').textContent = label;
}

function showError(msg) {
  const box = $('error-box');
  box.textContent = msg;
  box.classList.remove('hidden');
}

function clearError() {
  $('error-box').classList.add('hidden');
  $('error-box').textContent = '';
}

function renderResults({ playlistName, playlistUrl, added, unmatched }) {
  const sec = $('results-section');
  sec.innerHTML = '';
  sec.classList.remove('hidden');

  // Stats card
  const statsCard = el('div', 'result-card');
  statsCard.innerHTML = `
    <h2>Done!</h2>
    <div class="stat">${added}</div>
    <div class="stat-label">track${added !== 1 ? 's' : ''} added to <strong>${playlistName}</strong></div>
    <a class="playlist-link" href="${playlistUrl}" target="_blank" rel="noopener">
      Open in Spotify ↗
    </a>`;
  sec.appendChild(statsCard);

  // Unmatched card
  if (unmatched.length) {
    const card = el('div', 'result-card');
    card.appendChild(el('h2', null, `${unmatched.length} unmatched line${unmatched.length !== 1 ? 's' : ''}`));
    const ul = el('ul', 'unmatched-list');
    unmatched.forEach(line => {
      const li = el('li');
      li.textContent = line;
      ul.appendChild(li);
    });
    card.appendChild(ul);
    sec.appendChild(card);
  }
}

// ── Default playlist name ─────────────────────────────────────────────────────
function defaultPlaylistName() {
  const d = new Date();
  return `Imported ${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── Main flow ─────────────────────────────────────────────────────────────────
async function createPlaylistFlow() {
  clearError();
  $('results-section').classList.add('hidden');
  $('progress-section').classList.add('hidden');
  $('create-btn').disabled = true;

  try {
    const rawText = $('songs-input').value;
    const lines   = rawText.split('\n').map(l => l.trim()).filter(Boolean);

    if (!lines.length) {
      showError('Paste at least one song before creating a playlist.');
      return;
    }

    const name = $('playlist-name').value.trim() || defaultPlaylistName();

    // Step 1: search all tracks
    const uris      = [];
    const unmatched = [];
    for (let i = 0; i < lines.length; i++) {
      setProgress(
        Math.round((i / lines.length) * 70),
        `Searching ${i + 1} / ${lines.length}: ${lines[i].slice(0, 40)}…`
      );
      const uri = await searchTrack(lines[i]);
      if (uri) uris.push(uri);
      else     unmatched.push(lines[i]);
    }

    if (!uris.length) {
      showError('No tracks matched. Check your song lines and try again.');
      return;
    }

    // Step 2: get user id
    setProgress(75, 'Getting your profile…');
    const me = await getMe();

    // Step 3: create playlist
    setProgress(80, 'Creating playlist…');
    const playlist = await createPlaylist(me.id, name);

    // Step 4: add tracks
    setProgress(88, `Adding ${uris.length} tracks…`);
    await addTracks(playlist.id, uris);

    setProgress(100, 'Done!');

    renderResults({
      playlistName: name,
      playlistUrl:  playlist.external_urls.spotify,
      added:        uris.length,
      unmatched,
    });

  } catch (err) {
    showError(err.message);
  } finally {
    $('create-btn').disabled = false;
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  const url    = new URL(location.href);
  const code   = url.searchParams.get('code');
  const state  = url.searchParams.get('state');
  const stored = sessionStorage.getItem('oauth_state');
  const token  = getToken();

  // Handle OAuth callback
  if (code && state && state === stored) {
    // Clean URL before exchanging so a reload doesn't re-use the code
    history.replaceState({}, '', location.pathname);
    sessionStorage.removeItem('oauth_state');

    try {
      const data = await exchangeCode(code);
      sessionStorage.setItem('access_token', data.access_token);
    } catch (err) {
      showError(`Login failed: ${err.message}`);
      showSection('auth-section');
      return;
    }
  }

  // Error from Spotify (e.g. user denied)
  if (url.searchParams.get('error')) {
    history.replaceState({}, '', location.pathname);
    showError(`Spotify auth error: ${url.searchParams.get('error')}`);
    showSection('auth-section');
    return;
  }

  if (getToken()) {
    // Load user info
    try {
      const me = await getMe();
      $('user-name').textContent = me.display_name || me.id;
    } catch {
      // Token invalid — start fresh
      clearAuth();
      showSection('auth-section');
      return;
    }
    $('playlist-name').placeholder = defaultPlaylistName();
    showSection('app-section');
  } else {
    showSection('auth-section');
  }

  // Wire up buttons
  $('login-btn').addEventListener('click', login);
  $('logout-btn').addEventListener('click', () => { clearAuth(); location.reload(); });
  $('create-btn').addEventListener('click', createPlaylistFlow);
}

boot().catch(console.error);
