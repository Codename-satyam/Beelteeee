(function () {
  'use strict';

  // Storage: browser localStorage (shared between tabs of the same browser) PLUS optional Supabase sync.
  // If shared/supabase-config.js is missing or empty the site runs in local-only mode.
  // With Supabase configured, controller pages (body[data-controller]) require sign-in and every change
  // is saved to the database and pushed to the other streamer / the live overlay.
  const STORAGE_KEY = 'entity-championship-state-v1';
  const CHANNEL_NAME = 'entity-championship-sync-v1';
  let channel = null;
  try { if ('BroadcastChannel' in window) channel = new BroadcastChannel(CHANNEL_NAME); } catch (_) {}

  const TABLE = 'tournament_state';
  const ROW_ID = 'main';
  let supabaseClient = null;
  let cloudStatus = 'Local mode';
  let serverState = null;   // last state confirmed by Supabase
  let serverRev = 0;        // revision of serverState
  let pending = [];         // local changes not yet confirmed by Supabase
  let flushing = null;
  let authorized = true;    // becomes false until sign-in when Supabase is on and the page is a controller page
  let session = null;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const needsAuth = () => Boolean(document.body && document.body.hasAttribute('data-controller'));

  function emptyState() {
    return {
      version: 1,
      tournamentName: 'THE ENTITY CHAMPIONSHIP',
      teams: [],
      matches: [],
      activeMatchId: null,
      generated: false,
      updatedAt: new Date().toISOString()
    };
  }

  function normalizeState(value) {
    const state = value && typeof value === 'object' ? value : {};
    const normalized = { ...emptyState(), ...state };
    if (!Array.isArray(normalized.teams)) normalized.teams = [];
    if (!Array.isArray(normalized.matches)) normalized.matches = [];
    // Remove obsolete Killer-draft data from older exported state files.
    normalized.matches = normalized.matches.map((match) => {
      if (!match || typeof match !== 'object') return match;
      const next = { ...match };
      delete next.killerDraft;
      return next;
    });
    return normalized;
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      return normalizeState(JSON.parse(raw));
    } catch (err) {
      console.error('Unable to read tournament state', err);
      return emptyState();
    }
  }

  let cachedState = loadLocal();

  function announce() {
    window.dispatchEvent(new CustomEvent('entity-state-change'));
    try { if (channel) channel.postMessage({ type: 'changed', at: Date.now() }); } catch (_) {}
  }

  function setCache(state, persistLocal = true) {
    if (!state || !Array.isArray(state.teams) || !Array.isArray(state.matches)) {
      throw new Error('Invalid tournament state: teams and matches must be arrays.');
    }
    cachedState = normalizeState(state);
    if (persistLocal) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedState));
      } catch (err) {
        console.error('Unable to save tournament state', err);
        throw new Error('Browser storage is unavailable or full. Export a backup and try again.');
      }
    }
    announce();
  }

  function load() { return cachedState; }
  function update(mutator) {
    if (supabaseClient && needsAuth() && !authorized) throw new Error('Sign in with an authorized controller email first (box at the top of the page).');
    const state = clone(load());
    mutator(state);
    state.updatedAt = new Date().toISOString();
    setCache(state);
    if (supabaseClient) { pending.push(mutator); flushPending().catch((err) => console.error('Tournament cloud save failed:', err)); }
    return cachedState;
  }
  function save(state) {
    const snapshot = clone(state);
    update((s) => { Object.keys(s).forEach((k) => delete s[k]); Object.assign(s, clone(snapshot)); });
    return cachedState;
  }

  // ---------- Supabase sync ----------
  function showCloudMessage(message, bad) {
    cloudStatus = message;
    const sync = document.getElementById('sync-detail');
    if (sync) sync.textContent = `SYNC · ${message.toUpperCase()}`;
    const ind = document.getElementById('save-indicator');
    if (ind) { ind.textContent = message; ind.style.color = bad ? '#ff8a95' : ''; }
  }
  function isCloudConfigured() {
    const c = window.ENTITY_SUPABASE_CONFIG || {};
    return Boolean(c.url && c.anonKey && !/YOUR[-_]/i.test(c.url + c.anonKey) && window.supabase && typeof window.supabase.createClient === 'function');
  }
  // Re-apply our not-yet-confirmed changes on top of a (newer) shared state.
  function replay(base, list) {
    const next = clone(base);
    list.forEach((fn) => { try { fn(next); } catch (e) { console.warn('Skipped a change that no longer applies:', e.message); } });
    return next;
  }
  function applyRemote(state, revision) {
    if (!state || !Array.isArray(state.teams) || !Array.isArray(state.matches)) return;
    if (serverState && revision && revision <= serverRev) return; // echo of our own save or an old event
    serverState = state; serverRev = revision || serverRev;
    setCache(replay(serverState, pending));
  }
  async function fetchRemoteState() {
    if (!supabaseClient) return;
    const { data, error } = await supabaseClient.from(TABLE).select('state, revision').eq('id', ROW_ID).maybeSingle();
    if (error) { showCloudMessage(`Read error: ${error.message}`, true); throw error; }
    if (data && data.state) applyRemote(data.state, Number(data.revision) || 0);
    else if (!serverState) { serverState = clone(emptyState()); serverRev = 0; }
  }
  // If the other streamer saved first we take THEIR state and re-apply our change on top (no lost clicks).
  function flushPending() {
    if (flushing) return flushing;
    flushing = (async () => {
      try {
        if (!serverState) await fetchRemoteState();
        let conflicts = 0;
        while (pending.length) {
          const batch = pending.slice();
          const next = replay(serverState, batch);
          next.updatedAt = new Date().toISOString();
          const { data, error } = await supabaseClient.rpc('save_tournament_state', { p_state: next, p_expected_revision: serverRev });
          if (error) throw error;
          if (data && data.ok === true) {
            serverState = next; serverRev = Number(data.revision) || serverRev + 1;
            pending.splice(0, batch.length);
            setCache(replay(serverState, pending));
            showCloudMessage('Saved · live sync active');
            conflicts = 0;
          } else {
            if (++conflicts > 6) throw new Error('Too many save conflicts. Reload the page.');
            if (data && data.state) { serverState = data.state; serverRev = Number(data.revision) || serverRev; }
            else await fetchRemoteState();
          }
        }
      } catch (err) {
        pending = [];
        serverState = null; serverRev = 0;   // force the re-fetch below to replace the unsaved optimistic state
        showCloudMessage(`Save error: ${err.message || 'database write failed'}`, true);
        fetchRemoteState().catch(() => {});
        throw err;
      } finally { flushing = null; }
    })();
    return flushing;
  }
  async function refreshAuth() {
    if (!supabaseClient) { authorized = true; return; }
    const { data } = await supabaseClient.auth.getSession();
    session = data && data.session;
    authorized = false;
    if (session) { const r = await supabaseClient.rpc('is_controller'); authorized = !r.error && r.data === true; }
    renderAuth();
  }
  function renderAuth() {
    if (!needsAuth() || !supabaseClient) return;
    let box = document.getElementById('entity-auth');
    if (!box) {
      const shell = document.querySelector('.shell'); if (!shell) return;
      box = document.createElement('div'); box.id = 'entity-auth'; box.className = 'entity-auth-widget';
      const top = shell.querySelector('.topbar'); shell.insertBefore(box, top ? top.nextSibling : shell.firstChild);
      box.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-auth]'); if (!btn) return;
        if (btn.dataset.auth === 'out') { await supabaseClient.auth.signOut(); refreshAuth(); return; }
        const input = document.getElementById('entity-auth-email'); const email = input && input.value.trim();
        if (!email) return;
        btn.disabled = true;
        const { error } = await supabaseClient.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href.split('#')[0].split('?')[0] } });
        const note = document.getElementById('entity-auth-note');
        if (note) note.textContent = error ? `Could not send link: ${error.message}` : 'Link sent. Open it on this device, then come back to this tab.';
        btn.disabled = false;
      });
    }
    if (authorized) box.innerHTML = `<div class="entity-auth-copy"><strong>CONTROLLER ACCESS</strong><span>${escHtml(session.user.email)} · changes sync to every screen</span></div><button class="button" data-auth="out" type="button">Sign out</button>`;
    else if (session) box.innerHTML = `<div class="entity-auth-copy"><strong>NOT AUTHORIZED</strong><span>${escHtml(session.user.email)} is not on the controllers list.</span></div><button class="button" data-auth="out" type="button">Sign out</button>`;
    else box.innerHTML = `<div class="entity-auth-copy"><strong>SIGN IN REQUIRED</strong><span>Enter your authorized email to get a one-time sign-in link.</span><span class="entity-auth-note" id="entity-auth-note"></span></div><div class="actions"><input type="email" id="entity-auth-email" placeholder="you@example.com" autocomplete="email" style="min-width:220px;padding:10px;background:#08080b;color:#fff;border:1px solid #33333d"><button class="button primary" data-auth="in" type="button">Send sign-in link</button></div>`;
  }
  function initCloud() {
    if (!isCloudConfigured()) { authorized = true; showCloudMessage('Local browser storage'); return; }
    const config = window.ENTITY_SUPABASE_CONFIG;
    supabaseClient = window.supabase.createClient(config.url, config.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    authorized = !needsAuth();
    showCloudMessage('Connecting to Supabase…');
    supabaseClient.auth.onAuthStateChange(() => { window.setTimeout(() => refreshAuth().catch(() => {}), 0); });
    refreshAuth().catch(() => {});
    fetchRemoteState().then(() => showCloudMessage('Connected · live updates active')).catch((err) => showCloudMessage(`Connection error: ${err.message}`, true));
    supabaseClient.channel('entity-tournament-state')
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: `id=eq.${ROW_ID}` }, (payload) => {
        if (payload.eventType === 'DELETE' || !payload.new) return;
        applyRemote(payload.new.state, Number(payload.new.revision) || 0);
      })
      .subscribe((status) => { if (status === 'SUBSCRIBED') showCloudMessage('Connected · live updates active'); });
    // Safety net: if realtime is blocked or not enabled, still pick up the other streamer's changes within ~3s.
    window.setInterval(() => { if (!flushing && !pending.length && !document.hidden) fetchRemoteState().catch(() => {}); }, 3000);
  }

  function subscribe(callback) {
    const onStorage = (event) => {
      if (supabaseClient) return; // cloud is the source of truth; another tab's localStorage copy may be older
      if (!event.key || event.key === STORAGE_KEY) {
        cachedState = loadLocal();
        callback(load());
      }
    };
    const onLocal = () => callback(load());
    const onChannel = () => callback(load());
    window.addEventListener('storage', onStorage);
    window.addEventListener('entity-state-change', onLocal);
    if (channel) channel.addEventListener('message', onChannel);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('entity-state-change', onLocal);
      if (channel) channel.removeEventListener('message', onChannel);
    };
  }

  // ---------- Activity log + undo ----------
  // Every scoring change records a compact "before" snapshot of only the matches it can touch, so the
  // newest change can be undone with one click. The log lives inside the synced state (state.auditLog),
  // so both streamers see the same history. It also exports to CSV for VOD editors.
  const AUDIT_MAX = 60;
  const SNAP_TARGET = ['scorecard', 'scoreA', 'scoreB', 'status', 'winnerId', 'tiebreakWinnerId'];
  const SNAP_ANCESTOR = ['teamAId', 'teamBId', 'scorecard', 'scoreA', 'scoreB', 'status', 'winnerId', 'tiebreakWinnerId', 'toss', 'roles', 'mapVeto', 'setupComplete'];
  const SNAP_STATUS = ['status'];
  function who() { return (session && session.user && session.user.email) || 'local'; }
  function pickFields(match, keys) { const out = {}; keys.forEach((k) => { out[k] = match[k] === undefined ? null : clone(match[k]); }); return out; }
  // Call at the START of a mutator, before changing anything. opts: { game, kind, moment, withAncestors }
  function auditRecord(state, label, matchId, opts) {
    opts = opts || {};
    const target = state.matches.find((m) => m.id === matchId);
    const snaps = new Map();
    if (target) {
      snaps.set(target.id, SNAP_TARGET);
      if (opts.withAncestors) {
        let p = target;
        while (p && p.parentMatchId) { snaps.set(p.parentMatchId, SNAP_ANCESTOR); p = state.matches.find((m) => m.id === p.parentMatchId); }
      }
    }
    state.matches.forEach((m) => { if (m.status === 'in_progress' && !snaps.has(m.id)) snaps.set(m.id, SNAP_STATUS); });
    const entry = {
      id: uid('log'), at: new Date().toISOString(), who: who(), kind: opts.kind || 'score', label,
      matchId: matchId || null, game: opts.game || null, moment: opts.moment || '',
      matchLabel: target ? `${teamName(state, target.teamAId)} vs ${teamName(state, target.teamBId)}` : '',
      prev: { activeMatchId: state.activeMatchId || null, matches: [...snaps].map(([id, keys]) => ({ id, fields: pickFields(state.matches.find((m) => m.id === id) || {}, keys) })) },
      undone: false
    };
    state.auditLog = (state.auditLog || []).concat(entry).slice(-AUDIT_MAX);
    return entry;
  }
  function auditList(state) { return (state && state.auditLog) || []; }
  function auditLastUndoable(state) {
    const log = auditList(state);
    for (let i = log.length - 1; i >= 0; i--) if (log[i].prev && !log[i].undone) return log[i];
    return null;
  }
  // Restores the newest undoable change. Returns that entry, or null when there is nothing to undo.
  function auditUndo(state) {
    const entry = auditLastUndoable(state);
    if (!entry) return null;
    entry.prev.matches.forEach((snap) => {
      const match = state.matches.find((m) => m.id === snap.id);
      if (match) Object.keys(snap.fields).forEach((k) => { match[k] = clone(snap.fields[k]); });
    });
    state.activeMatchId = entry.prev.activeMatchId;
    entry.undone = true;
    state.auditLog = state.auditLog.concat({ id: uid('log'), at: new Date().toISOString(), who: who(), kind: 'undo', label: `Undid: ${entry.label}`, matchId: entry.matchId, game: entry.game, moment: '', matchLabel: entry.matchLabel, undone: false }).slice(-AUDIT_MAX);
    return entry;
  }
  function auditCsv(state) {
    const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = [['timestamp_utc', 'who', 'match', 'game', 'change', 'moment', 'status']];
    auditList(state).forEach((e) => rows.push([e.at, e.who, e.matchLabel, e.game ? `Game ${e.game}` : '', e.label, e.moment || '', e.kind === 'undo' ? 'undo' : (e.undone ? 'undone' : 'active')]));
    return rows.map((r) => r.map(q).join(',')).join('\r\n');
  }

  function randInt(max) {
    if (window.crypto && crypto.getRandomValues) {
      const limit = Math.floor(4294967296 / max) * max;
      const buf = new Uint32Array(1);
      do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
      return buf[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  function shuffle(items) {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function uid(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
  function teamName(state, id) {
    if (!id) return 'TBD';
    const team = state.teams.find((item) => item.id === id);
    return team ? team.name : 'TBD';
  }
  function roundName(index, total) {
    if (index === total - 1) return 'FINAL';
    if (index === total - 2) return 'SEMIFINAL';
    if (index === total - 3) return 'QUARTERFINAL';
    return `ROUND ${index + 1}`;
  }
  function isResolved(match) { return match && (match.status === 'completed' || match.status === 'bye'); }

  function resetMatchResult(match) {
    match.scoreA = null;
    match.scoreB = null;
    match.winnerId = null;
    match.status = 'pending';
    match.toss = null;
    match.roles = null;
    match.mapVeto = null;
    match.setupComplete = false;
    match.scorecard = null;
    match.tiebreakWinnerId = null;
    delete match.killerDraft;
  }

  function buildBracket(names) {
    const clean = [];
    const seen = new Set();
    names.forEach((raw) => {
      const name = String(raw || '').trim();
      const key = name.toLocaleLowerCase();
      if (name && !seen.has(key)) {
        seen.add(key);
        clean.push({ id: uid('team'), name });
      }
    });
    if (clean.length < 2) throw new Error('Enter at least two distinct team names.');

    const bracketSize = 2 ** Math.ceil(Math.log2(clean.length));
    const roundCount = Math.log2(bracketSize);
    const firstRoundMatchCount = bracketSize / 2;
    const playInCount = clean.length - firstRoundMatchCount;
    const base = uid('bracket');
    const matches = [];
    const order = shuffle(clean);

    // Exactly `playInCount` first-round slots are real matches; the others receive byes.
    // This supports every team count from 2 through the next power of two minus 1.
    const allSlots = Array.from({ length: firstRoundMatchCount }, (_, i) => i);
    const playInSlots = new Set(clean.length === bracketSize ? allSlots : shuffle(allSlots).slice(0, playInCount));
    const firstRoundSlots = Array.from({ length: firstRoundMatchCount }, () => ({ a: null, b: null }));
    let teamIndex = 0;
    for (let slot = 0; slot < firstRoundMatchCount; slot++) {
      firstRoundSlots[slot].a = order[teamIndex++]?.id || null;
      if (playInSlots.has(slot)) firstRoundSlots[slot].b = order[teamIndex++]?.id || null;
    }

    for (let roundIndex = 0; roundIndex < roundCount; roundIndex++) {
      const count = bracketSize / (2 ** (roundIndex + 1));
      for (let slot = 0; slot < count; slot++) {
        const firstRound = roundIndex === 0;
        const first = firstRound ? firstRoundSlots[slot] : null;
        const match = {
          id: `${base}-r${roundIndex + 1}-m${slot + 1}`,
          roundIndex,
          roundName: firstRound && clean.length !== bracketSize ? 'PRELIMINARY' : roundName(roundIndex, roundCount),
          matchNumber: slot + 1,
          teamAId: firstRound ? (first?.a || null) : null,
          teamBId: firstRound ? (first?.b || null) : null,
          sourceAId: roundIndex > 0 ? `${base}-r${roundIndex}-m${slot * 2 + 1}` : null,
          sourceBId: roundIndex > 0 ? `${base}-r${roundIndex}-m${slot * 2 + 2}` : null,
          parentMatchId: roundIndex < roundCount - 1 ? `${base}-r${roundIndex + 2}-m${Math.floor(slot / 2) + 1}` : null,
          parentSlot: roundIndex < roundCount - 1 ? (slot % 2 === 0 ? 'a' : 'b') : null,
          scoreA: null,
          scoreB: null,
          status: 'pending',
          winnerId: null,
          toss: null,
          roles: null,
          mapVeto: null,
          setupComplete: false,
          scorecard: null,
          tiebreakWinnerId: null
        };
        if (firstRound && (!match.teamAId || !match.teamBId)) {
          match.status = 'bye';
          match.winnerId = match.teamAId || match.teamBId || null;
        }
        matches.push(match);
      }
    }

    const state = { ...emptyState(), teams: clean, matches, generated: true, activeMatchId: null };
    propagateAdvances(state);
    const firstPlayable = state.matches.find((match) => match.status === 'pending' && match.teamAId && match.teamBId);
    if (firstPlayable) state.activeMatchId = firstPlayable.id;
    return state;
  }

  function propagateAdvances(state) {
    const sorted = state.matches.slice().sort((a, b) => a.roundIndex - b.roundIndex || a.matchNumber - b.matchNumber);
    sorted.forEach((match) => {
      if (match.sourceAId || match.sourceBId) {
        const sourceA = state.matches.find((item) => item.id === match.sourceAId);
        const sourceB = state.matches.find((item) => item.id === match.sourceBId);
        if (sourceA && isResolved(sourceA)) match.teamAId = sourceA.winnerId || null;
        if (sourceB && isResolved(sourceB)) match.teamBId = sourceB.winnerId || null;
        if (match.status !== 'completed' && sourceA && sourceB && isResolved(sourceA) && isResolved(sourceB)) {
          if (!match.teamAId || !match.teamBId) {
            match.status = 'bye';
            match.winnerId = match.teamAId || match.teamBId || null;
          } else if (match.status === 'bye') {
            match.status = 'pending';
            match.winnerId = null;
          }
        }
      }
      if (isResolved(match) && match.parentMatchId) {
        const parent = state.matches.find((item) => item.id === match.parentMatchId);
        if (!parent) return;
        const slotKey = match.parentSlot === 'a' ? 'teamAId' : 'teamBId';
        const old = parent[slotKey];
        if (old !== (match.winnerId || null)) {
          parent[slotKey] = match.winnerId || null;
          if (parent.status === 'completed' || parent.scoreA != null || parent.scoreB != null || parent.toss || parent.mapVeto || parent.scorecard) invalidateMatchAndDescendants(state, parent.id);
        }
      }
    });
    return state;
  }

  function invalidateMatchAndDescendants(state, matchId) {
    const match = state.matches.find((item) => item.id === matchId);
    if (!match) return;
    resetMatchResult(match);
    state.matches.filter((item) => item.sourceAId === matchId || item.sourceBId === matchId)
      .forEach((child) => invalidateMatchAndDescendants(state, child.id));
  }

  function setLive(state, matchId) {
    const match = state.matches.find((item) => item.id === matchId);
    if (!match || !match.teamAId || !match.teamBId || match.status === 'bye') return;
    state.matches.forEach((item) => { if (item.status === 'in_progress') item.status = item.winnerId ? 'completed' : 'pending'; });
    if (match.status !== 'completed') match.status = 'in_progress';
    state.activeMatchId = matchId;
  }

  function savePoints(state, matchId, scoreA, scoreB, complete, tieWinnerId) {
    const match = state.matches.find((item) => item.id === matchId);
    if (!match || !match.teamAId || !match.teamBId) throw new Error('Choose a match with two teams first.');
    const a = Number(scoreA), b = Number(scoreB);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isInteger(a * 2) || !Number.isInteger(b * 2) || a < 0 || b < 0) {
      throw new Error('Scores must be non-negative and may use half points.');
    }
    const oldWinner = match.winnerId;
    const hadResult = match.status === 'completed';
    state.matches.forEach((other) => { if (other.id !== match.id && other.status === 'in_progress') other.status = other.winnerId ? 'completed' : 'pending'; });
    let winnerId = null;
    if (complete) {
      if (a > b) winnerId = match.teamAId;
      else if (b > a) winnerId = match.teamBId;
      else if (tieWinnerId === match.teamAId || tieWinnerId === match.teamBId) winnerId = tieWinnerId;
      else throw new Error('The score is tied. Choose the tiebreak winner before completing this match.');
    }
    match.scoreA = a;
    match.scoreB = b;
    match.status = complete ? 'completed' : 'in_progress';
    match.winnerId = winnerId;
    state.activeMatchId = match.id;
    if (hadResult && oldWinner !== winnerId && match.parentMatchId) {
      const parent = state.matches.find((item) => item.id === match.parentMatchId);
      if (parent) invalidateMatchAndDescendants(state, parent.id);
    }
    propagateAdvances(state);
    return match;
  }

  function addToss(state, matchId, toss) {
    const match = state.matches.find((item) => item.id === matchId);
    if (!match || !match.teamAId || !match.teamBId) throw new Error('Choose a match with two teams first.');
    match.toss = { ...toss, savedAt: new Date().toISOString() };
    state.activeMatchId = matchId;
    return match;
  }

  // Side choice: the toss winner picks Killer or Survivor for Game 1 (Game 2 swaps automatically).
  function setSideChoice(state, matchId, teamId, role) {
    const match = state.matches.find((item) => item.id === matchId);
    if (!match || !match.teamAId || !match.teamBId) throw new Error('Choose a match with two teams first.');
    if (teamId !== match.teamAId && teamId !== match.teamBId) throw new Error('Unknown team.');
    if (role !== 'killer' && role !== 'survivor') throw new Error('Role must be killer or survivor.');
    const other = teamId === match.teamAId ? match.teamBId : match.teamAId;
    match.roles = {
      chooserId: teamId, choice: role,
      game1KillerId: role === 'killer' ? teamId : other,
      game1SurvivorId: role === 'killer' ? other : teamId,
      savedAt: new Date().toISOString()
    };
    return match;
  }

  // Single source of truth for who plays which side in a given game.
  // Matches without a saved choice (older data) keep the legacy rule: Team A is Killer in Game 1.
  function rolesFor(match, gameNo) {
    match = match || {};
    const r = match.roles;
    const valid = r && (r.game1KillerId === match.teamAId || r.game1KillerId === match.teamBId);
    const g1Killer = valid ? r.game1KillerId : match.teamAId;
    const g1Survivor = g1Killer === match.teamAId ? match.teamBId : match.teamAId;
    return Number(gameNo) === 2 ? { killerId: g1Survivor, survivorId: g1Killer } : { killerId: g1Killer, survivorId: g1Survivor };
  }

  function activeMatch(state) {
    // Single source of truth for "the current match" (used by every screen).
    // The LIVE match wins, so merely browsing a match or finishing one can't move the overlays.
    const ok = (m) => m.teamAId && m.teamBId && m.status !== 'bye';
    return state.matches.find((m) => m.status === 'in_progress' && ok(m)) ||
      state.matches.find((m) => m.id === state.activeMatchId && ok(m) && m.status !== 'completed') ||
      state.matches.find((m) => m.status === 'pending' && ok(m)) ||
      state.matches.slice().reverse().find((m) => m.status === 'completed' && ok(m)) || null;
  }

  window.Entity = {
    STORAGE_KEY,
    load,
    save,
    update,
    subscribe,
    uid,
    teamName,
    roundName,
    buildBracket,
    shuffle,
    flush: () => (flushing || Promise.resolve()).catch(() => {}),
    propagateAdvances,
    setLive,
    savePoints,
    addToss,
    setSideChoice,
    rolesFor,
    activeMatch,
    who,
    audit: { record: auditRecord, list: auditList, lastUndoable: auditLastUndoable, undo: auditUndo, toCsv: auditCsv },
    cloud: { configured: isCloudConfigured, get client() { return supabaseClient; }, get isController() { return authorized; }, get status() { return cloudStatus; } }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initCloud, { once: true }); else initCloud();
})();
