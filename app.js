/* MTG Tracker — mobile tracker backed by a Google Sheet.
 * Plain JS, no build step. Data lives in the sheet (tabs: Players, Decks, Matches).
 */
'use strict';

const APP_VERSION = '20261008d';

// If anything goes wrong while drawing a screen, show a way out instead of a blank page.
window.addEventListener('error', () => {
  const v = document.getElementById('view');
  if (v && !v.children.length) {
    const tr = (k, d) => { try { return t(k); } catch (e) { return d; } };
    v.innerHTML = `<div class="empty"><h2>${tr('err_title', 'Something went wrong')}</h2><p>${tr('err_text', 'Reload to fix it.')}</p><button class="btn primary" onclick="location.reload()">${tr('reload', 'Reload')}</button></div>`;
  }
});

const CFG = window.APP_CONFIG || {};

/* ------------------------------------------------------------------ language */
const I18N = window.I18N || { en: {} };
function langSetting() { try { return JSON.parse(localStorage.getItem('mtg.lang')) || 'system'; } catch (e) { return 'system'; } }
function resolveLang() {
  const s = langSetting();
  if (s === 'en' || s === 'de') return s;
  return /^de\b/i.test(navigator.language || '') ? 'de' : 'en';
}
let LANG = resolveLang();
const locale = () => (LANG === 'de' ? 'de-DE' : 'en-GB');
function t(key, vars) {
  const v = (I18N[LANG] && I18N[LANG][key]) ?? (I18N.en && I18N.en[key]) ?? key;
  if (typeof v === 'function') return v(vars);
  return vars == null || typeof vars !== 'object' ? v : v.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
}
const cn = (c) => t('color_' + c);
function applyStaticTexts() {
  document.documentElement.lang = LANG;
  $$('#tabbar a').forEach((a) => { const sp = a.querySelector('span'); if (sp) sp.textContent = t('tab_' + a.dataset.tab); });
  const st = $('#btn-settings'); if (st) st.setAttribute('aria-label', t('settings'));
  const ad = $('#btn-add'); if (ad) ad.setAttribute('aria-label', t('add_match'));
}
const TABS = { players: 'Players', decks: 'Decks', matches: 'Matches', config: 'Config' };
const COLORS = ['W', 'U', 'B', 'R', 'G'];

/* ------------------------------------------------------------------ utils */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s ?? '').trim().toLowerCase();
const pct = (x) => (x == null || isNaN(x) ? '–' : Math.round(x * 100) + (LANG === 'de' ? '\u202f%' : '%'));
const plural = (n, w) => `${n} ${n === 1 ? w : /(ch|sh|s|x)$/.test(w) ? w + 'es' : w + 's'}`;

const store = {
  get(k, d) { try { const v = localStorage.getItem('mtg.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('mtg.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  del(k) { try { localStorage.removeItem('mtg.' + k); } catch (e) { /* ignore */ } },
};

function parseSheetId(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
  return '';
}

function parseCSV(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function parseDate(s) {
  if (!s) return null;
  s = String(s).trim();
  let m;
  if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/))) return new Date(+(m[3].length === 2 ? '20' + m[3] : m[3]), +m[2] - 1, +m[1]);
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return new Date(+m[1], +m[2] - 1, +m[3]);
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return new Date(+m[3], +m[1] - 1, +m[2]);
  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t);
}
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtDate = (d, opts) => (d ? d.toLocaleDateString(locale(), opts || { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function truthy(v) {
  const s = norm(v);
  return s === 'true' || s === 'yes' || s === 'y' || s === '1' || s === 'x' || s === 'ja' || s === 'wahr' || s === '✓';
}
function splitList(v) { return String(v ?? '').split(/[,;|]/).map((x) => x.trim()).filter(Boolean); }
function normColors(v) {
  const up = String(v ?? '').toUpperCase();
  return COLORS.filter((c) => up.includes(c));
}
function colLetter(n) { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
const qTab = (t) => `'${t.replace(/'/g, "''")}'`;

/* ------------------------------------------------------------------ password-locked sheet link */
// Format: v1.<iterations>.<salt>.<iv>.<ciphertext> (base64). PBKDF2-SHA256 → AES-GCM-256, all in the browser.
const KDF_ITER = 310000;
const b64enc = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64dec = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function lockSheetId(sheetId, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, KDF_ITER);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(sheetId));
  return ['v1', KDF_ITER, b64enc(salt), b64enc(iv), b64enc(ct)].join('.');
}
async function unlockSheetId(blob, password) {
  const [v, iter, salt, iv, ct] = String(blob).trim().split('.');
  if (v !== 'v1' || !ct) throw new Error(t('err_lock_damaged'));
  const key = await deriveKey(password, b64dec(salt), Number(iter));
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64dec(iv) }, key, b64dec(ct)));
  } catch (e) { throw new Error(t('err_wrong_pw')); }
}
const hasLockedSheet = () => !!(CFG.lockedSheet && String(CFG.lockedSheet).startsWith('v1.'));

/** Ask the browser to keep this site's data even when the phone runs low on space. */
let storagePersisted = null;
async function persistStorage() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return;
    storagePersisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch (e) { /* ignore */ }
}

/* ------------------------------------------------------------------ toast */
let toastTimer;
function toast(msg, isError) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, isError ? 4500 : 2400);
}

/* ------------------------------------------------------------------ sheet access */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

/** Write bridge: the Apps Script web app attached to the sheet (see Code.gs). */
function scriptUrl() {
  return store.get('scriptUrl', '') || (state.config && state.config.scripturl) || '';
}
async function callScript(action, payload = {}, url = scriptUrl()) {
  if (!url) throw new Error(t('err_no_script'));
  let res;
  try {
    // text/plain keeps this a "simple" request, so the browser sends no CORS preflight.
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, ...payload }) });
  } catch (e) {
    throw new Error(t('err_script_unreachable'));
  }
  let out;
  try { out = await res.json(); } catch (e) { throw new Error(t('err_script_bad')); }
  if (!out.ok) throw new Error(out.error || t('err_script_generic'));
  return out;
}

/** Read-only access without sign-in, works when the sheet is shared "Anyone with the link". */
async function fetchViaPublic(id) {
  const get = async (tab, mustHave) => {
    const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(tab)}&_=${Date.now()}`;
    let res;
    try { res = await fetch(url); } catch (e) { throw new HttpError(403, 'private'); }
    const text = await res.text();
    if (!res.ok || /^\s*</.test(text)) throw new HttpError(403, 'private');
    const rows = parseCSV(text);
    const head = (rows[0] || []).map(norm);
    if (!mustHave.every((h) => head.includes(h))) throw new Error(t('err_tab_missing', { tab, cols: mustHave.join(', ') }));
    return rows;
  };
  const [players, decks, matches, config] = await Promise.all([
    get(TABS.players, ['id', 'name']),
    get(TABS.decks, ['id', 'name', 'colors']),
    get(TABS.matches, ['playera', 'playerb', 'gamesa', 'gamesb']),
    get(TABS.config, ['key', 'value']).catch(() => [['key', 'value']]), // optional tab
  ]);
  return { players, decks, matches, config, title: '' };
}

/* ------------------------------------------------------------------ model */
function table(rows) {
  const header = (rows[0] || []).map((h) => String(h).trim());
  const keys = header.map(norm);
  const items = [];
  rows.slice(1).forEach((r, i) => {
    if (!r || r.every((c) => String(c ?? '').trim() === '')) return;
    const o = { _row: i + 2 };
    keys.forEach((k, j) => { if (k) o[k] = String(r[j] ?? '').trim(); });
    items.push(o);
  });
  return { header, keys, items };
}

function buildModel(raw) {
  const P = table(raw.players), D = table(raw.decks), M = table(raw.matches);

  const players = P.items.filter((p) => p.id || p.name).map((p) => ({ id: p.id || p.name, name: p.name || p.id, _row: p._row }));
  const playerByRef = new Map();
  players.forEach((p) => { playerByRef.set(norm(p.id), p); playerByRef.set(norm(p.name), p); });
  const resolvePlayer = (ref) => {
    if (!ref) return null;
    const p = playerByRef.get(norm(ref));
    if (p) return p;
    const ghost = { id: ref, name: ref, ghost: true };
    players.push(ghost); playerByRef.set(norm(ref), ghost);
    return ghost;
  };

  const playerCol = ['playerid', 'playerids', 'players', 'player'].find((k) => D.keys.includes(k)) || 'playerid';
  const decks = D.items.filter((d) => d.id || d.name).map((d) => ({
    id: d.id || d.name,
    name: d.name || d.id,
    colors: normColors(d.colors),
    tags: splitList(d.tags),
    active: d.active === undefined || d.active === '' ? true : truthy(d.active),
    playerIds: splitList(d[playerCol]).map((r) => (playerByRef.get(norm(r)) || resolvePlayer(r)).id),
    _row: d._row,
  }));
  const deckById = new Map(decks.map((d) => [d.id, d]));
  const deckByName = new Map();
  decks.forEach((d) => { const k = norm(d.name); if (!deckByName.has(k)) deckByName.set(k, []); deckByName.get(k).push(d); });
  const resolveDeck = (ref, player) => {
    if (!ref) return { id: '?', name: t('no_deck'), colors: [], tags: [], active: false, playerIds: [], ghost: true };
    if (deckById.has(ref)) return deckById.get(ref);
    const list = deckByName.get(norm(ref));
    if (list) return (player && list.find((d) => d.playerIds.includes(player.id))) || list[0];
    const ghost = { id: '?' + ref, name: ref, colors: [], tags: [], active: false, playerIds: player ? [player.id] : [], ghost: true };
    deckByName.set(norm(ref), [ghost]); deckById.set(ghost.id, ghost);
    return ghost;
  };

  let dateStyle = 'dmy';
  const matches = M.items.filter((m) => m.playera || m.playerb).map((m) => {
    const pa = resolvePlayer(m.playera), pb = resolvePlayer(m.playerb);
    if (/^\d{4}-/.test(m.date)) dateStyle = 'iso'; else if (/\//.test(m.date)) dateStyle = 'mdy';
    const ga = parseInt(m.gamesa, 10) || 0, gb = parseInt(m.gamesb, 10) || 0;
    const gd = parseInt(m.draws ?? m.gamesd ?? m.gamesdraw ?? m.draw ?? '', 10) || 0;
    return {
      id: m.id || 'row' + m._row, date: parseDate(m.date), dateRaw: m.date,
      pa, pb, da: resolveDeck(m.decka, pa), db: resolveDeck(m.deckb, pb),
      ga, gb, gd, onPlay: m.onplay || '', notes: m.notes || '', _row: m._row,
    };
  });
  matches.sort((a, b) => ((b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0)) || (b._row - a._row));

  const config = {};
  (raw.config || []).slice(1).forEach((r) => { if (r && r[0]) config[norm(r[0])] = String(r[1] ?? '').trim(); });

  return {
    title: config.title || '', config,
    players, decks, matches, deckById, playerByRef, dateStyle,
    headers: { players: P.header, decks: D.header, matches: M.header },
    playerCol,
    allTags: [...new Set(decks.flatMap((d) => d.tags.map((t) => t.toLowerCase())))].sort(),
  };
}

/** Both sides of a match from each side's perspective. */
function sides(m) {
  const res = (x, y) => (x > y ? 'W' : x < y ? 'L' : 'D');
  const playA = m.onPlay ? (norm(m.onPlay) === norm(m.pa && m.pa.name) || norm(m.onPlay) === norm(m.pa && m.pa.id) || norm(m.onPlay) === 'a') : null;
  return [
    { m, player: m.pa, deck: m.da, opp: m.pb, oppDeck: m.db, gw: m.ga, gl: m.gb, r: res(m.ga, m.gb), onPlay: playA },
    { m, player: m.pb, deck: m.db, opp: m.pa, oppDeck: m.da, gw: m.gb, gl: m.ga, r: res(m.gb, m.ga), onPlay: playA == null ? null : !playA },
  ];
}

function emptyRec() { return { m: 0, w: 0, l: 0, d: 0, gw: 0, gl: 0 }; }
function addRec(rec, s) { rec.m++; rec[s.r === 'W' ? 'w' : s.r === 'L' ? 'l' : 'd']++; rec.gw += s.gw; rec.gl += s.gl; return rec; }
const wr = (rec) => (rec.m ? rec.w / rec.m : null);
const gwr = (rec) => (rec.gw + rec.gl ? rec.gw / (rec.gw + rec.gl) : null);
const recStr = (rec) => `${rec.w}–${rec.l}${rec.d ? '–' + rec.d : ''}`;

function deckRecords(matches) {
  const map = new Map();
  for (const m of matches) for (const s of sides(m)) {
    if (!map.has(s.deck.id)) map.set(s.deck.id, emptyRec());
    addRec(map.get(s.deck.id), s);
  }
  return map;
}

/* ------------------------------------------------------------------ state */
const UI_DEFAULTS = {
  home: { period: 'all', colorMetric: 'played', tagMetric: 'played' },
  table: { sort: 'wr', dir: -1, player: '', colors: [], tags: [] },
  matches: { deck: '', player: '' },
  decks: { q: '', status: 'all', player: '', colors: [] },
};
const savedUi = store.get('ui', {});
const state = {
  sheetId: store.get('sheetId', '') || parseSheetId(CFG.defaultSheet),
  data: null, config: null, loading: false, error: null, notPublic: false, loadedAt: 0,
  ui: Object.fromEntries(Object.entries(UI_DEFAULTS).map(([k, v]) => [k, { ...v, ...(savedUi[k] || {}) }])),
};
state.ui.decks.q = '';

function getPath(path) { return path.split('.').reduce((o, k) => o[k], state.ui); }
function setPath(path, val) {
  const ks = path.split('.'); const last = ks.pop();
  ks.reduce((o, k) => o[k], state.ui)[last] = val;
  store.set('ui', state.ui);
}

/* ------------------------------------------------------------------ theme */
function applyTheme() {
  const t = store.get('theme', 'system');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
}

/* ------------------------------------------------------------------ loading */
async function load(opts = {}) {
  if (!state.sheetId) { render(); return; }
  state.loading = true; state.error = null;
  document.body.classList.add('loading');
  if (!state.data) render();
  try {
    let raw;
    try { raw = await fetchViaPublic(state.sheetId); }
    catch (e) {
      if (e.status === 403) { state.notPublic = true; throw new Error(t('err_not_public')); }
      throw e;
    }
    state.data = buildModel(raw); state.config = state.data.config; state.notPublic = false; state.loadedAt = Date.now();
    store.set('cache', { id: state.sheetId, raw, at: state.loadedAt });
    if (opts.toast) toast(t('data_updated'));
  } catch (e) {
    state.error = e;
    if (state.data) toast(e.message, true);
  } finally {
    state.loading = false;
    document.body.classList.remove('loading');
    render();
  }
}

function setSheet(input) {
  const id = parseSheetId(input);
  if (!id) return false;
  if (id !== state.sheetId) { state.data = null; state.config = null; store.del('cache'); store.del('scriptUrl'); }
  state.sheetId = id; store.set('sheetId', id);
  return true;
}

/* ------------------------------------------------------------------ routing & render */
function route() {
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: name || 'home', arg: arg ? decodeURIComponent(arg) : '' };
}

const VIEWS = { home: viewHome, table: viewTable, matches: viewMatches, decks: viewDecks, deck: viewDeck };
const TAB_TITLES = { home: 'Home', table: 'Table', matches: 'Matches', decks: 'Decks', deck: 'Deck' };

function render() {
  const r = route();
  const view = $('#view');
  // keep focus on text inputs across re-renders
  const ae = document.activeElement;
  const focusModel = ae && ae.dataset && ae.dataset.model && view.contains(ae) ? { m: ae.dataset.model, s: ae.selectionStart } : null;

  const tabName = r.name === 'deck' ? 'decks' : r.name;
  $$('#tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tabName));
  document.body.classList.toggle('no-chrome', !state.sheetId || (!state.data && !state.loading));

  const d = state.data;

  let html;
  if (!state.sheetId) html = hasLockedSheet() && !state.manualEntry ? viewUnlock() : viewOnboarding();
  else if (!d && state.loading) html = '<div class="skeleton" style="height:70px"></div><div class="skeleton"></div><div class="skeleton" style="height:180px"></div><div class="skeleton" style="height:140px"></div>';
  else if (!d) html = viewLoadError();
  else html = (VIEWS[r.name] || viewHome)(r.arg);
  view.innerHTML = html;

  if (focusModel) {
    const el = view.querySelector(`[data-model="${focusModel.m}"]`);
    if (el) { el.focus(); try { el.setSelectionRange(focusModel.s, focusModel.s); } catch (e) { /* ignore */ } }
  }
}

/* ------------------------------------------------------------------ shared bits */
const ICON = {
  chev: '<svg class="chev" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>',
};

/* Optional custom color icons: icons/W.svg, U.svg, B.svg, R.svg, G.svg, C.svg next to index.html.
   Each one is used if it loads; otherwise the letter pip is shown. */
const ICON_DIR = 'icons/';
const customIcons = {};
function probeIcons() {
  [...COLORS, 'C'].forEach((c) => {
    const img = new Image();
    img.onload = () => { customIcons[c] = img.src; scheduleRender(); };
    img.src = ICON_DIR + c + '.svg';
  });
}
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); sheetStack.forEach((s) => s.refresh()); });
}
function pip(c, cls = '') {
  if (customIcons[c]) return `<span class="pip icon${cls ? ' ' + cls : ''}" role="img" aria-label="${cn(c)}"><img src="${customIcons[c]}" alt=""></span>`;
  return `<span class="pip pip-${c}${cls ? ' ' + cls : ''}" role="img" aria-label="${cn(c)}">${c}</span>`;
}

function pips(colors, big) {
  const cs = colors && colors.length ? colors : ['C'];
  return `<span class="pips" title="${cs.map((c) => cn(c)).join(', ')}">${cs.map((c) => pip(c, big ? 'lg' : '')).join('')}</span>`;
}
function playerNames(deck) {
  const d = state.data;
  return deck.playerIds.map((id) => { const p = d.playerByRef.get(norm(id)); return p ? p.name : id; }).join(' & ') || '—';
}
function realPlayers() { return state.data.players.filter((p) => !p.ghost); }
function deckLink(deck, cls = '') {
  if (deck.ghost) return `<span class="${cls}">${esc(deck.name)}</span>`;
  return `<a class="${cls}" href="#/deck/${encodeURIComponent(deck.id)}">${esc(deck.name)}</a>`;
}

/** Horizontal bar chart: one series, direct labels on every bar. */
function hbars(rows, { max, axis, big, empty } = {}) {
  if (!rows.length) return `<p class="muted small">${empty || t('no_data')}</p>`;
  const top = max || Math.max(...rows.map((r) => r.value || 0), 1);
  return `<div class="hbars">${rows.map((r) => `
    <div class="hbar${big ? ' big' : ''}${r.href ? ' tap' : ''}" ${r.href ? `data-href="${r.href}"` : ''} title="${esc(r.title || '')}">
      <div class="hb-label">${r.icon || ''}<span>${esc(r.label)}</span></div>
      <div class="hb-track">
        <div class="hb-fill${r.ringed ? ' ringed' : ''}" style="width:${Math.max(0, Math.min(1, (r.value || 0) / top)) * 100}%;${r.color ? `background:${r.color}` : ''}"></div>
        ${axis != null ? `<div class="hb-axis" style="left:${(axis / top) * 100}%"></div>` : ''}
      </div>
      <div class="hb-value num">${r.valueHtml}</div>
    </div>`).join('')}</div>`;
}

function matchRow(m, focusDeckId, editable) {
  const aw = m.ga > m.gb, bw = m.gb > m.ga;
  const sideHtml = (p, deck, won, lost, cls, onPlay) => `
    <div class="side ${cls} ${won ? 'won' : lost ? 'lost' : ''}">
      <div class="player">${esc(p ? p.name : '?')}${onPlay ? ` <span class="faint" title="${t('on_play')}">▶</span>` : ''}</div>
      ${deckLink(deck, 'deck')}
      ${pips(deck.colors)}
    </div>`;
  const s = sides(m);
  return `<div class="match${editable ? ' tap' : ''}" ${editable ? `data-edit-match="${esc(m.id)}" role="button" tabindex="0"` : ''}>
    ${sideHtml(m.pa, m.da, aw, bw, 'a', s[0].onPlay === true)}
    <div class="score-wrap"><div class="score"><span class="${aw ? 'w' : bw ? 'l' : ''}">${m.ga}</span><span class="sep">:</span><span class="${bw ? 'w' : aw ? 'l' : ''}">${m.gb}</span></div>${m.gd ? `<div class="draws">+${t('draws_n', m.gd)}</div>` : ''}</div>
    ${sideHtml(m.pb, m.db, bw, aw, 'b', s[1].onPlay === true)}
    ${m.notes ? `<div class="note">${esc(m.notes)}</div>` : ''}
  </div>`;
}

function matchList(matches, opts = {}) {
  if (!matches.length) return `<div class="empty"><h2>${t('no_matches')}</h2><p>${opts.emptyText || t('nothing_matches')}</p></div>`;
  let html = ''; let lastKey = null; let open = false;
  for (const m of matches) {
    const key = m.date ? isoDate(m.date) : m.dateRaw || '—';
    if (key !== lastKey) {
      if (open) html += '</div>';
      html += `<div class="date-head">${m.date ? fmtDate(m.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : esc(m.dateRaw || t('no_date'))}</div><div class="list">`;
      open = true; lastKey = key;
    }
    html += matchRow(m, opts.focusDeckId, opts.editable);
  }
  return html + (open ? '</div>' : '');
}

function filterPeriod(matches, period) {
  if (period === 'all') return matches;
  const now = new Date();
  let from;
  if (period === '30') from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
  else if (period === '90') from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90);
  else if (period === 'year') from = new Date(now.getFullYear(), 0, 1);
  return matches.filter((m) => m.date && m.date >= from);
}

function colorChips(path, selected, withColorless) {
  const list = withColorless ? [...COLORS, 'C'] : COLORS;
  return list.map((c) => `<button class="chip mana${selected.includes(c) ? ' on' : ''}" data-toggle="${path}" data-val="${c}" aria-pressed="${selected.includes(c)}" aria-label="${cn(c)}">${pip(c)}</button>`).join('');
}
function playerSelect(path, value, allLabel) {
  return `<select class="select sm" data-model="${path}"><option value="">${allLabel || t('all_players')}</option>${realPlayers().map((p) => `<option value="${esc(p.id)}"${p.id === value ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
}
function segmented(path, value, options, cls = '') {
  return `<div class="segmented ${cls}" role="group">${options.map(([v, l]) => `<button data-set="${path}" data-val="${v}" class="${String(value) === String(v) ? 'on' : ''}" aria-pressed="${String(value) === String(v)}">${l}</button>`).join('')}</div>`;
}

/* ------------------------------------------------------------------ views: onboarding / errors */
function viewOnboarding() {
  const cfgBroken = !window.APP_CONFIG;
  return `<div class="onboard">
    ${cfgBroken ? `<div class="callout" style="border-color:var(--loss);margin-bottom:18px">${t('cfg_broken')}</div>` : ''}
    <div class="logo">${COLORS.map((c) => pip(c, 'lg')).join('')}</div>
    <h2>${t('onb_title')}</h2>
    <p class="lead">${t('onb_lead')}</p>
    <form data-form="onboard">
      <label class="field"><span class="label">${t('sheet_label')}</span>
        <input class="input" name="sheet" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://docs.google.com/spreadsheets/d/…" value="${esc(CFG.defaultSheet || '')}" required>
      </label>
      <p class="err-text hidden" id="onboard-err">${t('sheet_invalid')}</p>
      <button class="btn primary block" type="submit">${t('continue')}</button>
    </form>
    ${hasLockedSheet() ? `<div style="text-align:center;margin-top:14px"><button class="link-btn" data-act="password-entry">${t('use_password')}</button></div>` : ''}
    <div class="divider"></div>
    <div class="callout">${t('onb_callout')}</div>
  </div>`;
}

function viewUnlock() {
  return `<div class="onboard">
    <div class="logo">${COLORS.map((c) => pip(c, 'lg')).join('')}</div>
    <h2>${t('unlock_title')}</h2>
    <p class="lead">${t('unlock_lead')}</p>
    <form data-form="unlock">
      <label class="field"><span class="label">${t('league_password')}</span>
        <input class="input" type="password" name="password" autocomplete="current-password" required autofocus>
      </label>
      <p class="err-text hidden" id="unlock-err"></p>
      <button class="btn primary block" type="submit">${t('open_league')}</button>
    </form>
    <div style="text-align:center;margin-top:18px"><button class="link-btn" data-act="manual-sheet">${t('enter_link_instead')}</button></div>
  </div>`;
}

function viewLoadError() {
  const e = state.error;
  return `<div class="onboard">
    <h2>${state.notPublic ? t('not_public_title') : t('load_fail_title')}</h2>
    <p class="lead">${esc(e ? e.message : t('unknown_error'))}</p>
    <button class="btn primary block" data-act="refresh">${t('try_again')}</button>
    <div style="height:10px"></div>
    <button class="btn block" data-act="settings">${t('settings')}</button>
  </div>`;
}

/* ------------------------------------------------------------------ view: home */
function viewHome() {
  const d = state.data, ui = state.ui.home;
  let ms = filterPeriod(d.matches, ui.period);
  const allSides = ms.flatMap(sides);

  // KPIs
  const games = ms.reduce((a, m) => a + m.ga + m.gb, 0);
  const decksPlayed = new Set(allSides.map((s) => s.deck.id)).size;
  const last = d.matches[0];
  const kpis = `<div class="kpis">
    <div class="kpi"><div class="k-label">${t('kpi_matches')}</div><div class="k-value num">${ms.length}</div><div class="k-sub">${t('games_n', games)}</div></div>
    <div class="kpi"><div class="k-label">${t('kpi_decks_played')}</div><div class="k-value num">${decksPlayed}</div><div class="k-sub">${t('active_of', { a: d.decks.filter((x) => x.active).length, b: d.decks.length })}</div></div>
    <div class="kpi"><div class="k-label">${t('kpi_players')}</div><div class="k-value num">${realPlayers().length}</div><div class="k-sub">&nbsp;</div></div>
    <div class="kpi"><div class="k-label">${t('kpi_last_match')}</div><div class="k-value" style="font-size:18px;padding-top:5px">${last ? fmtDate(last.date, { day: 'numeric', month: 'short' }) : '—'}</div><div class="k-sub">${last && last.date ? last.date.getFullYear() : ''}</div></div>
  </div>`;

  // Players
  const pRec = new Map();
  for (const s of allSides) { if (!s.player) continue; if (!pRec.has(s.player.id)) pRec.set(s.player.id, { p: s.player, rec: emptyRec() }); addRec(pRec.get(s.player.id).rec, s); }
  const pRows = [...pRec.values()].sort((a, b) => (wr(b.rec) - wr(a.rec)) || (b.rec.m - a.rec.m)).map(({ p, rec }) => ({
    label: p.name, value: wr(rec),
    valueHtml: `${pct(wr(rec))}<small>${recStr(rec)}</small>`,
    title: t('player_tip', { name: p.name, w: rec.w, l: rec.l, d: rec.d, gw: rec.gw, gl: rec.gl, gwr: pct(gwr(rec)) }),
  }));
  const playersCard = `<section class="card">
    <h2>${t('player_wr_title')}</h2><p class="card-sub">${t('player_wr_sub')}</p>
    ${hbars(pRows, { max: 1, axis: 0.5, big: true })}
    ${pRows.length ? `<div class="legend-note">${[...pRec.values()].map(({ p, rec }) => t('games_note', { name: esc(p.name), gw: rec.gw, gl: rec.gl, p: pct(gwr(rec)) })).join(' · ')}</div>` : ''}
  </section>`;

  // Colors
  const cStat = {}; [...COLORS, 'C'].forEach((c) => { cStat[c] = { n: 0, rec: emptyRec() }; });
  for (const s of allSides) {
    if (s.deck.ghost) continue;
    const cs = s.deck.colors.length ? s.deck.colors : ['C'];
    cs.forEach((c) => { cStat[c].n++; addRec(cStat[c].rec, s); });
  }
  const totalSides = allSides.filter((s) => !s.deck.ghost).length || 1;
  const cRows = [...COLORS, 'C'].filter((c) => c !== 'C' || cStat.C.n).map((c) => {
    const st = cStat[c];
    const played = ui.colorMetric === 'played';
    return {
      label: cn(c), icon: pip(c),
      value: played ? st.n : wr(st.rec), color: `var(--mana-${c})`, ringed: true,
      valueHtml: played ? `${st.n}<small>${pct(st.n / totalSides)}</small>` : `${pct(wr(st.rec))}<small>${recStr(st.rec)}</small>`,
      title: t('color_tip', { c: cn(c), n: st.n, t: totalSides, rec: recStr(st.rec) }),
    };
  });
  const colorsCard = `<section class="card">
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <div><h2>${t('colors_title')}</h2><p class="card-sub">${ui.colorMetric === 'played' ? t('colors_sub_played') : t('colors_sub_wr')}</p></div>
      ${segmented('home.colorMetric', ui.colorMetric, [['played', t('played')], ['wr', t('win_pct')]])}
    </div>
    ${hbars(cRows, ui.colorMetric === 'wr' ? { max: 1, axis: 0.5 } : {})}
    <div class="legend-note">${t('colors_note')}</div>
  </section>`;

  // Tags
  const tStat = new Map();
  for (const s of allSides) {
    if (s.deck.ghost) continue;
    const ts = s.deck.tags.length ? s.deck.tags.map((x) => x.toLowerCase()) : [t('untagged')];
    ts.forEach((tg) => { if (!tStat.has(tg)) tStat.set(tg, { n: 0, rec: emptyRec() }); const st = tStat.get(tg); st.n++; addRec(st.rec, s); });
  }
  const tagPlayed = ui.tagMetric === 'played';
  const tRows = [...tStat.entries()]
    .sort((a, b) => (tagPlayed ? b[1].n - a[1].n : (wr(b[1].rec) - wr(a[1].rec)) || b[1].n - a[1].n))
    .map(([tg, st]) => ({
      label: tg, value: tagPlayed ? st.n : wr(st.rec),
      valueHtml: tagPlayed ? `${st.n}<small>${pct(st.n / totalSides)}</small>` : `${pct(wr(st.rec))}<small>${recStr(st.rec)}</small>`,
      title: t('tag_tip', { t: tg, n: st.n, rec: recStr(st.rec) }),
    }));
  const tagsCard = `<section class="card">
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <div><h2>${t('types_title')}</h2><p class="card-sub">${tagPlayed ? t('types_sub_played') : t('types_sub_wr')}</p></div>
      ${segmented('home.tagMetric', ui.tagMetric, [['played', t('played')], ['wr', t('win_pct')]])}
    </div>
    ${hbars(tRows, tagPlayed ? {} : { max: 1, axis: 0.5 })}
    <div class="legend-note">${t('types_note')}</div>
  </section>`;

  return `<div class="filters">
      ${segmented('home.period', ui.period, [['all', t('period_all')], ['year', t('period_year')], ['90', t('period_90')], ['30', t('period_30')]])}
    </div>
    ${kpis}${playersCard}${colorsCard}${tagsCard}`;
}

/* ------------------------------------------------------------------ view: league table */
function deckMatchesFilters(deck, f) {
  if (f.player && !deck.playerIds.includes(f.player)) return false;
  if (f.colors && f.colors.length) {
    if (f.colors.includes('C') ? deck.colors.length !== 0 : !f.colors.every((c) => deck.colors.includes(c))) return false;
  }
  if (f.tags && f.tags.length && !deck.tags.some((t) => f.tags.includes(t.toLowerCase()))) return false;
  return true;
}

function viewTable() {
  const d = state.data, ui = state.ui.table;
  const recs = deckRecords(d.matches);
  let rows = d.decks.filter((x) => x.active && deckMatchesFilters(x, { ...ui, player: '' })).map((deck) => ({ deck, rec: recs.get(deck.id) || emptyRec(), pn: playerNames(deck) }));
  const byWr = (a, b) => ((wr(b.rec) ?? -1) - (wr(a.rec) ?? -1)) || ((gwr(b.rec) ?? -1) - (gwr(a.rec) ?? -1)) || (b.rec.m - a.rec.m) || a.deck.name.localeCompare(b.deck.name);
  const cmp = {
    wr: byWr,
    matches: (a, b) => (b.rec.m - a.rec.m) || byWr(a, b),
    player: (a, b) => a.pn.localeCompare(b.pn) || byWr(a, b),
  }[ui.sort] || byWr;
  rows.sort((a, b) => cmp(a, b) * (ui.dir === -1 ? 1 : -1));
  const nFilters = ui.colors.length + ui.tags.length;
  const arrow = (ui.sort === 'player') === (ui.dir === -1) ? '↑' : '↓';
  const th = (key, label) => `<button data-sort="${key}" class="${ui.sort === key ? 'on' : ''}" aria-label="${t('sort_by', { x: label })}">${label}<span class="sort-ind">${ui.sort === key ? arrow : '↕'}</span></button>`;

  return `<div class="filters">
      <div class="chips">${colorChips('table.colors', ui.colors, true)}</div>
      ${d.allTags.length ? `<div class="chips">${d.allTags.map((t) => `<button class="chip${ui.tags.includes(t) ? ' on' : ''}" data-toggle="table.tags" data-val="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
    </div>
    <div class="toolbar"><span class="count">${t('active_decks_n', rows.length)}${nFilters ? ` · <button class="link-btn" data-act="clear-table">${t('clear_filters')}</button>` : ''}</span><span class="count">${t('tap_sort')}</span></div>
    ${rows.length ? `<div class="card" style="padding:10px 12px 4px"><table class="league">
      <thead><tr><th>#</th><th>${t('col_deck')}</th><th class="pl">${th('player', t('col_player'))}</th><th>${th('matches', t('col_m'))}</th><th>${th('wr', t('col_win'))}</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="tap" data-href="#/deck/${encodeURIComponent(r.deck.id)}">
        <td class="num">${i + 1}</td>
        <td class="deck-cell"><span class="name">${esc(r.deck.name)}</span><span class="meta">${pips(r.deck.colors)}</span></td>
        <td class="pl">${esc(r.pn)}</td>
        <td class="num"><span style="font-weight:600">${r.rec.m}</span><span class="rec">${recStr(r.rec)}</span></td>
        <td class="num"><span class="wr">${pct(wr(r.rec))}</span><span class="wr-bar"><i style="width:${(wr(r.rec) || 0) * 100}%"></i></span></td>
      </tr>`).join('')}</tbody></table></div>` : `<div class="empty"><h2>${t('no_decks')}</h2><p>${t('no_active_match')}</p></div>`}`;
}

/* ------------------------------------------------------------------ view: matches */
function viewMatches() {
  const d = state.data, ui = state.ui.matches;
  let ms = d.matches;
  if (ui.deck) ms = ms.filter((m) => m.da.id === ui.deck || m.db.id === ui.deck);
  if (ui.player) ms = ms.filter((m) => (m.pa && m.pa.id === ui.player) || (m.pb && m.pb.id === ui.player));
  const byName = (a, b) => a.name.localeCompare(b.name);
  const act = d.decks.filter((x) => x.active).sort(byName), inact = d.decks.filter((x) => !x.active).sort(byName);
  const opt = (x) => `<option value="${esc(x.id)}"${x.id === ui.deck ? ' selected' : ''}>${esc(x.name)}</option>`;
  let summary = '';
  if (ui.deck) {
    const rec = emptyRec();
    ms.flatMap(sides).filter((s) => s.deck.id === ui.deck).forEach((s) => addRec(rec, s));
    summary = ` · ${recStr(rec)} (${pct(wr(rec))})`;
  }
  return `<div class="filters">
      <select class="select" data-model="matches.deck"><option value="">${t('all_decks')}</option>
        <optgroup label="${t('active')}">${act.map(opt).join('')}</optgroup>
        ${inact.length ? `<optgroup label="${t('inactive')}">${inact.map(opt).join('')}</optgroup>` : ''}
      </select>
      <div class="row"><div class="grow">${playerSelect('matches.player', ui.player)}</div>${ui.deck || ui.player ? `<button class="link-btn" data-act="clear-matches">${t('clear')}</button>` : ''}</div>
    </div>
    <div class="toolbar"><span class="count">${t('matches_n', ms.length)}${summary}</span>${ui.deck ? `<a class="link-btn" href="#/deck/${encodeURIComponent(ui.deck)}">${t('deck_details')}</a>` : `<span class="count">${t('tap_to_edit')}</span>`}</div>
    ${matchList(ms, { editable: true, emptyText: d.matches.length ? t('nothing_matches') : t('first_match') })}`;
}

/* ------------------------------------------------------------------ view: decks */
function viewDecks() {
  const d = state.data, ui = state.ui.decks;
  const recs = deckRecords(d.matches);
  const q = norm(ui.q);
  const rows = d.decks.filter((x) =>
    (ui.status === 'all' || (ui.status === 'active') === x.active) &&
    deckMatchesFilters(x, ui) &&
    (!q || norm(x.name).includes(q) || x.tags.some((t) => norm(t).includes(q)))
  ).sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
  return `<div class="filters">
      <input class="input" type="search" placeholder="${t('search_ph')}" data-model="decks.q" value="${esc(ui.q)}">
      ${segmented('decks.status', ui.status, [['all', t('all')], ['active', t('active')], ['inactive', t('inactive')]])}
      <div class="row"><div class="grow">${playerSelect('decks.player', ui.player)}</div></div>
      <div class="chips">${colorChips('decks.colors', ui.colors, true)}</div>
    </div>
    <div class="toolbar"><span class="count">${t('decks_n', rows.length)}</span><button class="btn sm" data-act="new-deck">${ICON.plus}${t('new_deck')}</button></div>
    ${rows.length ? `<div class="list">${rows.map((x) => {
      const rec = recs.get(x.id) || emptyRec();
      return `<a class="list-item tap" href="#/deck/${encodeURIComponent(x.id)}">
        ${pips(x.colors)}
        <div class="li-main">
          <div class="li-title">${esc(x.name)}</div>
          <div class="li-sub"><span>${esc(playerNames(x))}</span>${x.active ? '' : `<span class="badge inactive">${t('inactive')}</span>`}${x.tags.map((tg) => `<span class="tag">${esc(tg)}</span>`).join('')}</div>
        </div>
        <div class="li-end"><div class="num" style="font-weight:650">${pct(wr(rec))}</div><div class="num small faint">${rec.m ? recStr(rec) : t('no_games')}</div></div>
        ${ICON.chev}
      </a>`;
    }).join('')}</div>` : `<div class="empty"><h2>${t('no_decks')}</h2><p>${t('nothing_matches')}</p></div>`}`;
}

/* ------------------------------------------------------------------ view: deck detail */
function viewDeck(id) {
  const d = state.data;
  const deck = d.deckById.get(id);
  if (!deck || deck.ghost) return `<div class="empty"><h2>${t('deck_not_found')}</h2><p><a href="#/decks">${t('back_to_decks')}</a></p></div>`;

  const ss = d.matches.flatMap(sides).filter((s) => s.deck.id === deck.id);
  const rec = ss.reduce(addRec, emptyRec());
  // current streak
  let streak = '';
  if (ss.length) { const r0 = ss[0].r; let n = 0; for (const s of ss) { if (s.r === r0) n++; else break; } streak = `${t('res_' + r0)}${n}`; }

  const group = (keyFn, labelFn) => {
    const map = new Map();
    for (const s of ss) for (const k of keyFn(s)) { if (!map.has(k)) map.set(k, { k, label: labelFn(k, s), rec: emptyRec(), s }); addRec(map.get(k).rec, s); }
    return [...map.values()];
  };
  const opp = group((s) => [s.oppDeck.id], (k, s) => s.oppDeck.name).sort((a, b) => (b.rec.m - a.rec.m) || (wr(b.rec) - wr(a.rec)));
  const byColor = group((s) => (s.oppDeck.ghost ? [] : s.oppDeck.colors.length ? s.oppDeck.colors : ['C']), (k) => cn(k))
    .sort((a, b) => [...COLORS, 'C'].indexOf(a.k) - [...COLORS, 'C'].indexOf(b.k));
  const byTag = group((s) => (s.oppDeck.ghost ? [] : s.oppDeck.tags.length ? s.oppDeck.tags.map((x) => x.toLowerCase()) : [t('untagged')]), (k) => k)
    .sort((a, b) => b.rec.m - a.rec.m);
  const byPilot = group((s) => (s.player ? [s.player.id] : []), (k, s) => s.player.name);
  const playKnown = ss.filter((s) => s.onPlay != null);
  const wrRow = (g, extra = {}) => ({ label: g.label, value: wr(g.rec), valueHtml: `${pct(wr(g.rec))}<small>${recStr(g.rec)}</small>`, title: `${g.label}: ${recStr(g.rec)}`, ...extra });

  return `<button class="link-btn back-link" data-act="back">${t('back')}</button>
    <div class="deck-hero">
      <div class="row" style="justify-content:space-between">
        ${pips(deck.colors, true)}
        <button class="btn sm" data-act="edit-deck" data-id="${esc(deck.id)}">${ICON.edit}${t('edit')}</button>
      </div>
      <h2>${esc(deck.name)}</h2>
      <div class="meta"><span class="badge ${deck.active ? 'active' : 'inactive'}">${deck.active ? t('active') : t('inactive')}</span><span>${esc(playerNames(deck))}</span>${deck.tags.map((tg) => `<span class="tag">${esc(tg)}</span>`).join('')}</div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="k-label">${t('kpi_winrate')}</div><div class="k-value num">${pct(wr(rec))}</div><div class="k-sub num">${t('rec_in', { rec: recStr(rec), matches: t('matches_n', rec.m) })}</div></div>
      <div class="kpi"><div class="k-label">${t('kpi_games')}</div><div class="k-value num">${pct(gwr(rec))}</div><div class="k-sub num">${t('games_rec', { gw: rec.gw, gl: rec.gl })}</div></div>
      <div class="kpi"><div class="k-label">${t('kpi_streak')}</div><div class="k-value num">${streak || '—'}</div><div class="k-sub">${t('current')}</div></div>
      <div class="kpi"><div class="k-label">${t('kpi_last_played')}</div><div class="k-value" style="font-size:18px;padding-top:5px">${ss[0] ? fmtDate(ss[0].m.date, { day: 'numeric', month: 'short' }) : '—'}</div><div class="k-sub">${ss[0] && ss[0].m.date ? ss[0].m.date.getFullYear() : ''}</div></div>
    </div>
    ${ss.length ? `
    <section class="card"><h2>${t('form_title')}</h2><p class="card-sub">${t('form_sub', { n: Math.min(10, ss.length) })}</p>
      <div class="form">${ss.slice(0, 10).map((s) => `<span class="res ${s.r}" title="${esc(t('form_tip', { date: fmtDate(s.m.date), opp: s.oppDeck.name, gw: s.gw, gl: s.gl }))}">${t('res_' + s.r)}</span>`).join('')}</div>
    </section>
    ${byPilot.length > 1 ? `<section class="card"><h2>${t('by_pilot')}</h2><p class="card-sub">${t('match_wr')}</p>${hbars(byPilot.map((g) => wrRow(g)), { max: 1, axis: 0.5 })}</section>` : ''}
    ${playKnown.length ? `<section class="card"><h2>${t('playdraw_title')}</h2><p class="card-sub">${t('playdraw_sub', { k: playKnown.length, n: ss.length })}</p>${hbars(
      [[t('on_play'), true], [t('on_draw'), false]].map(([l, v]) => ({ label: l, rec: playKnown.filter((s) => s.onPlay === v).reduce(addRec, emptyRec()) })).filter((g) => g.rec.m).map((g) => wrRow(g)), { max: 1, axis: 0.5 })}</section>` : ''}
    <section class="card"><h2>${t('matchups')}</h2><p class="card-sub">${t('matchups_sub')}</p>
      ${opp.map((g) => `<div class="mu-row">
        <div style="min-width:0">${g.s.oppDeck.ghost ? `<span class="name">${esc(g.label)}</span>` : `<a class="name" href="#/deck/${encodeURIComponent(g.k)}" style="text-decoration:none">${esc(g.label)}</a>`}<span class="sub">${pips(g.s.oppDeck.colors)} ${esc(g.s.opp ? g.s.opp.name : '')}</span></div>
        <span class="num muted small">${recStr(g.rec)}</span>
        <span class="num" style="font-weight:700;min-width:42px;text-align:right">${pct(wr(g.rec))}</span>
      </div>`).join('')}
    </section>
    <section class="card"><h2>${t('vs_colors')}</h2><p class="card-sub">${t('vs_colors_sub')}</p>
      ${hbars(byColor.map((g) => wrRow(g, { icon: pip(g.k) })), { max: 1, axis: 0.5 })}</section>
    <section class="card"><h2>${t('vs_types')}</h2><p class="card-sub">${t('vs_types_sub')}</p>
      ${hbars(byTag.map((g) => wrRow(g)), { max: 1, axis: 0.5 })}</section>
    <div class="section-title">${t('history')}</div>
    ${matchList(ss.map((s) => s.m), { focusDeckId: deck.id })}
    ` : `<div class="empty"><h2>${t('no_matches_yet')}</h2><p>${t('no_matches_yet_sub')}</p></div>`}`;
}

/* ------------------------------------------------------------------ bottom sheets */
const sheetStack = [];
function openSheet({ title, render: renderBody, foot, onMount }) {
  const titleFn = typeof title === 'function' ? title : () => title;
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(titleFn())}">
    <div class="sheet-head"><h3>${esc(titleFn())}</h3><button class="icon-btn" data-close aria-label="${t('close')}">${ICON.close}</button></div>
    <div class="sheet-body"></div>
    ${foot ? `<div class="sheet-foot">${foot}</div>` : ''}
  </div>`;
  const s = {
    el: back, body: back.querySelector('.sheet-body'),
    refresh() {
      const st = this.body.scrollTop; this.body.innerHTML = renderBody(); this.body.scrollTop = st;
      const h = back.querySelector('.sheet-head h3'); if (h) h.textContent = titleFn();
      const c = back.querySelector('[data-close].icon-btn'); if (c) c.setAttribute('aria-label', t('close'));
    },
    close() { back.remove(); const i = sheetStack.indexOf(s); if (i >= 0) sheetStack.splice(i, 1); if (!sheetStack.length) document.body.style.overflow = ''; },
  };
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) s.close(); });
  $('#sheet-root').appendChild(back);
  sheetStack.push(s);
  document.body.style.overflow = 'hidden';
  s.refresh();
  if (onMount) onMount(s);
  return s;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetStack.length) sheetStack[sheetStack.length - 1].close(); });

function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.textContent = label || t('saving'); }
  else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}

/* ------------------------------------------------------------------ settings */
function openSettings() {
  const sheetUrl = state.sheetId ? `https://docs.google.com/spreadsheets/d/${state.sheetId}/edit` : '';
  let lockResult = '';
  const s = openSheet({
    title: () => t('settings'),
    render: () => {
      const theme = store.get('theme', 'system');
      return `
      <form data-form="sheet">
        <label class="field"><span class="label">${t('sheet_label')}</span>
          <input class="input" name="sheet" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(sheetUrl)}" placeholder="https://docs.google.com/spreadsheets/d/…">
        </label>
        <p class="err-text hidden" data-err>${t('sheet_invalid')}</p>
        <div class="row"><button class="btn primary grow" type="submit">${t('load_sheet')}</button>${sheetUrl ? `<a class="btn" href="${esc(sheetUrl)}" target="_blank" rel="noopener">${t('open')}</a>` : ''}</div>
      </form>
      <div class="divider"></div>
      <div class="field"><span class="label">${t('language')}</span>
        <div class="segmented big" role="group">${[['system', t('lang_system')], ['en', 'English'], ['de', 'Deutsch']].map(([v, l]) => `<button data-lang-set="${v}" class="${langSetting() === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      </div>
      <div class="field"><span class="label">${t('appearance')}</span>
        <div class="segmented big" role="group">${[['system', t('theme_system')], ['light', t('theme_light')], ['dark', t('theme_dark')]].map(([v, l]) => `<button data-theme-set="${v}" class="${theme === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      </div>
      <div class="divider"></div>
      ${installSection()}
      <div class="field"><span class="label">${t('write_access')}</span>
        <div class="account"><span class="dot ${scriptUrl() ? 'on' : ''}"></span><div class="grow small">${scriptUrl()
          ? t('wa_on')
          : t('wa_off')}</div></div>
        <form data-form="script">
          <label class="field" style="margin-bottom:10px"><span class="label">${t('script_url')}</span>
            <input class="input" name="url" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(scriptUrl())}" placeholder="https://script.google.com/macros/s/…/exec">
          </label>
          <button class="btn ${scriptUrl() ? '' : 'primary'} block" type="submit">${scriptUrl() ? t('test_update') : t('connect')}</button>
        </form>
      </div>
      <details class="adv"${lockResult ? ' open' : ''}>
        <summary>${t('advanced')}</summary>
        <div class="field" style="margin-top:10px"><span class="label">${t('lock_title')}</span>
          <p class="hint" style="margin:0 0 10px">${t('lock_hint')}</p>
          ${lockResult ? `
            <textarea class="input" readonly rows="4" style="font-family:ui-monospace,monospace;font-size:12px" data-lock-out>lockedSheet: '${esc(lockResult)}',</textarea>
            <div class="row" style="margin-top:8px"><button class="btn primary grow" data-act="copy-lock">${t('copy_line')}</button><button class="btn" data-act="lock-again">${t('start_over')}</button></div>
            <p class="hint" style="margin:8px 0 0">${t('lock_github')}</p>`
          : `<form data-form="lock">
            <input class="input" type="password" name="p1" placeholder="${t('new_pw')}" autocomplete="new-password" style="margin-bottom:8px">
            <input class="input" type="password" name="p2" placeholder="${t('repeat_pw')}" autocomplete="new-password" style="margin-bottom:8px">
            <button class="btn block" type="submit"${state.sheetId ? '' : ' disabled'}>${t('create_lock')}</button>
          </form>`}
        </div>
        <div class="divider"></div>
        <button class="btn block danger" data-act="reset">${t('reset')}</button>
      </details>
      <div class="divider"></div>
      <button class="btn block" data-act="reload-data-s">${t('reload_now')}</button>
      <p class="hint" style="margin-top:12px">${state.loadedAt ? t('data_loaded', { time: new Date(state.loadedAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) }) : t('data_not_loaded')} · ${t('version', { v: APP_VERSION })}${storagePersisted === true ? ' · ' + t('persist_yes') : storagePersisted === false ? ' · ' + t('persist_no') : ''}</p>`;
    },
  });
  s.el.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.dataset.form === 'sheet') {
      if (!setSheet(f.sheet.value)) { $('[data-err]', s.el).classList.remove('hidden'); return; }
      s.close(); location.hash = '#/home'; load();
    } else if (f.dataset.form === 'lock') {
      const p1 = f.p1.value, p2 = f.p2.value;
      if (p1.length < 8) { toast(t('pw_short'), true); return; }
      if (p1 !== p2) { toast(t('pw_mismatch'), true); return; }
      lockSheetId(state.sheetId, p1).then((blob) => unlockSheetId(blob, p1).then((check) => {
        if (check !== state.sheetId) throw new Error('Check failed');
        lockResult = blob; s.refresh();
      })).catch((err) => toast(t('lock_fail', { e: err.message }), true));
    } else if (f.dataset.form === 'script') {
      const url = f.url.value.trim();
      const btn = f.querySelector('button[type=submit]');
      if (!/^https:\/\/script\.google(usercontent)?\.com\/.+/.test(url)) { toast(t('script_url_invalid'), true); return; }
      (async () => {
        busy(btn, true, t('connecting'));
        try {
          const info = await callScript('ping', {}, url);
          await callScript('setConfig', { key: 'scriptUrl', value: url }, url);
          if (info.title) await callScript('setConfig', { key: 'title', value: info.title }, url);
          store.set('scriptUrl', url);
          toast(t('connected_toast'));
          await load();
          s.refresh();
        } catch (err) { busy(btn, false); toast(err.message, true); }
      })();
    }
  });
  s.el.addEventListener('click', async (e) => {
    const th = e.target.closest('[data-theme-set]');
    if (th) { store.set('theme', th.dataset.themeSet); applyTheme(); s.refresh(); return; }
    const lg = e.target.closest('[data-lang-set]');
    if (lg) { setLanguage(lg.dataset.langSet); return; }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'reload-data-s') { s.close(); load({ toast: true }); return; }
    if (a.dataset.act === 'copy-lock') {
      const text = $('[data-lock-out]', s.el).value;
      try { await navigator.clipboard.writeText(text); toast(t('copied')); }
      catch (err) { $('[data-lock-out]', s.el).select(); toast(t('copy_manual'), true); }
      return;
    }
    if (a.dataset.act === 'lock-again') { lockResult = ''; s.refresh(); return; }
    if (a.dataset.act === 'install') {
      if (!installPrompt) return;
      installPrompt.prompt();
      try { await installPrompt.userChoice; } catch (err) { /* ignore */ }
      installPrompt = null; s.refresh();
    } else if (a.dataset.act === 'reset') {
      ['sheetId', 'cache', 'ui', 'scriptUrl'].forEach((k) => store.del(k));
      location.hash = ''; location.reload();
    }
  });
}

/* ------------------------------------------------------------------ writes */
function nextId(list, fallbackPrefix) {
  let prefix = fallbackPrefix, max = 0, width = 2;
  for (const x of list) {
    const m = String(x.id).match(/^([A-Za-z_-]*)(\d+)$/);
    if (m) { prefix = m[1]; max = Math.max(max, +m[2]); width = Math.max(width, m[2].length); }
  }
  return prefix + String(max + 1).padStart(width, '0');
}

/* ------------------------------------------------------------------ add match */
function openMatchForm(edit) {
  const d = state.data;
  if (!d) { toast(t('load_first'), true); return; }
  if (edit && String(edit.id).startsWith('row')) { toast(t('err_no_match_id'), true); return; }
  const ps = realPlayers();
  const last = d.matches[0];
  const f = edit ? (() => {
    const sd = sides(edit);
    const quick = [[2, 0], [2, 1], [1, 2], [0, 2]].some(([a, b]) => a === edit.ga && b === edit.gb) && !edit.gd;
    return {
      date: edit.date ? isoDate(edit.date) : isoDate(new Date()),
      pa: edit.pa ? edit.pa.id : '', pb: edit.pb ? edit.pb.id : '',
      da: edit.da.id === '?' ? '' : edit.da.id, db: edit.db.id === '?' ? '' : edit.db.id,
      ga: edit.ga, gb: edit.gb, gd: edit.gd || 0, custom: !quick,
      onPlay: sd[0].onPlay === true ? 'a' : sd[1].onPlay === true ? 'b' : '',
      notes: edit.notes || '', allDecks: false, err: '', confirmDelete: false,
    };
  })() : {
    date: isoDate(new Date()),
    pa: (last && last.pa && !last.pa.ghost && last.pa.id) || (ps[0] && ps[0].id) || '',
    pb: (last && last.pb && !last.pb.ghost && last.pb.id) || (ps[1] && ps[1].id) || '',
    da: '', db: '', ga: null, gb: null, gd: 0, onPlay: '', notes: '', allDecks: false, err: '',
  };
  // Editing: offer inactive decks too (and keep the match's current deck even if it isn't in the Decks tab).
  const decksFor = (pid, dkey) => {
    const list = state.data.decks.filter((x) => (edit || x.active) && (f.allDecks || x.playerIds.includes(pid)));
    if (edit) {
      const cur = state.data.deckById.get(f[dkey]);
      if (cur && !list.includes(cur)) list.push(cur);
    }
    return list.sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
  };
  const players = edit ? [...ps, ...[edit.pa, edit.pb].filter((p) => p && p.ghost)] : ps;
  const pName = (id) => { const p = state.data.playerByRef.get(norm(id)); return p ? p.name : '—'; };
  const sideBox = (key, dkey, label) => {
    const list = decksFor(f[key], dkey);
    if (f[dkey] && !list.some((x) => x.id === f[dkey])) f[dkey] = '';
    return `<div class="side-box">
      <label class="field"><span class="label">${label}</span>
        <select class="select" data-f="${key}">${players.map((p) => `<option value="${esc(p.id)}"${p.id === f[key] ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label class="field"><span class="label"><span>${t('deck')}</span><button type="button" class="link-btn" data-new-deck="${key}">${t('plus_new_deck')}</button></span>
        <select class="select" data-f="${dkey}"><option value="">${t('choose_deck')}</option>${list.map((x) => `<option value="${esc(x.id)}"${x.id === f[dkey] ? ' selected' : ''}>${esc(x.name)} · ${x.colors.join('') || 'C'}${x.active ? '' : t('inactive_suffix')}</option>`).join('')}</select></label>
      ${!list.length ? `<p class="hint">${t(edit ? 'no_decks_for' : 'no_active_decks_for', { name: esc(pName(f[key])) })}</p>` : ''}
    </div>`;
  };
  const results = [[2, 0], [2, 1], [1, 2], [0, 2]];
  const deDate = (iso) => { const [y, m, d] = String(iso).split('-'); return d && m && y ? `${d}.${m}.${y}` : '—'; };
  const quickOn = (a, b) => !f.custom && f.ga === a && f.gb === b && !f.gd;
  const numBox = (key, label) => `<input class="num-box" type="number" inputmode="numeric" min="0" max="9" data-f="${key}" value="${f[key] ?? ''}" placeholder="0" aria-label="${esc(label)}">`;
  const clampGames = (v) => (v === '' || v == null || isNaN(v) ? null : Math.max(0, Math.min(9, Math.round(Number(v)))));
  const s = openSheet({
    title: edit ? t('edit_match') : t('new_match'),
    foot: edit
      ? `<button class="btn danger" data-delete>${t('delete')}</button><button class="btn primary" data-save>${t('save_changes')}</button>`
      : `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" data-save>${t('save_match')}</button>`,
    render: () => `
      <div class="field"><span class="label">${t('date')}</span>
        <div class="date-field">
          <span class="input date-display">${deDate(f.date)}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
          <input type="date" data-f="date" value="${f.date}" max="${isoDate(new Date())}" aria-label="${t('date')}">
        </div>
      </div>
      ${sideBox('pa', 'da', t('player1'))}
      <div class="vs">${t('vs')}</div>
      ${sideBox('pb', 'db', t('player2'))}
      <label class="switch" style="margin-bottom:14px"><span class="small">${t(edit ? 'show_all_decks_edit' : 'show_all_decks')}</span><input type="checkbox" data-f="allDecks" ${f.allDecks ? 'checked' : ''}></label>
      <div class="field"><span class="label">${t('result')}</span>
        <div class="result-grid">${results.map(([a, b]) => `<button type="button" data-result="${a}-${b}" class="${quickOn(a, b) ? 'on' : ''}"><b>${a}–${b}</b><span>${t('wins', { name: esc(pName(a > b ? f.pa : f.pb)) })}</span></button>`).join('')}</div>
        ${f.custom ? `
        <div class="custom-result">
          <div class="cr-row">
            <span class="cr-name">${esc(pName(f.pa))}</span>${numBox('ga', t('games_won_aria', { name: pName(f.pa) }))}<span class="cr-sep">–</span>${numBox('gb', t('games_won_aria', { name: pName(f.pb) }))}<span class="cr-name right">${esc(pName(f.pb))}</span>
          </div>
          <div class="cr-row draws"><span class="cr-name">${t('drawn_games')}</span>${numBox('gd', t('drawn_games'))}<button type="button" class="link-btn" data-custom="off">${t('cancel')}</button></div>
        </div>` : `<button type="button" class="link-btn other-result" data-custom="on">${t('other_result')}</button>`}
        ${f.ga != null && f.gb != null && f.ga + f.gb + (f.gd || 0) > 0 ? `<p class="hint" style="margin:8px 0 0">${f.ga === f.gb ? t('match_draw') : t('wins_match', { name: esc(pName(f.ga > f.gb ? f.pa : f.pb)) })}${f.gd ? ` · ${t('drawn_games_n', f.gd)}` : ''}</p>` : ''}
      </div>
      <div class="field"><span class="label">${t('on_play_label')} <span class="faint" style="font-weight:500">${t('optional')}</span></span>
        <div class="segmented">${[['', t('unknown')], ['a', pName(f.pa)], ['b', pName(f.pb)]].map(([v, l]) => `<button type="button" data-onplay="${v}" class="${f.onPlay === v ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
      </div>
      <label class="field"><span class="label">${t('notes')} <span class="faint" style="font-weight:500">${t('optional')}</span></span><input class="input" data-f="notes" value="${esc(f.notes)}" placeholder="${t('notes_ph')}"></label>
      ${f.err ? `<p class="err-text">${esc(f.err)}</p>` : ''}`,
  });
  s.el.addEventListener('change', (e) => {
    const k = e.target.dataset.f; if (!k) return;
    if (k === 'ga' || k === 'gb' || k === 'gd') { f[k] = clampGames(e.target.value); if (k === 'gd' && f.gd == null) f.gd = 0; s.refresh(); return; }
    if (k === 'date') { if (e.target.value) f.date = e.target.value; s.refresh(); return; }
    f[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (k === 'pa' || k === 'pb' || k === 'allDecks') s.refresh();
  });
  s.el.addEventListener('input', (e) => { if (e.target.dataset.f === 'notes') f.notes = e.target.value; });
  s.el.addEventListener('click', async (e) => {
    if (f.confirmDelete && !e.target.closest('[data-delete]')) {
      f.confirmDelete = false;
      const db = s.el.querySelector('[data-delete]'); if (db) { db.textContent = t('delete'); db.classList.remove('confirm'); }
    }
    const r = e.target.closest('[data-result]');
    if (r) { [f.ga, f.gb] = r.dataset.result.split('-').map(Number); f.gd = 0; f.custom = false; s.refresh(); return; }
    const cu = e.target.closest('[data-custom]');
    if (cu) {
      if (cu.dataset.custom === 'on') { f.custom = true; if (f.ga == null) f.ga = 1; if (f.gb == null) f.gb = 0; }
      else { f.custom = false; f.ga = null; f.gb = null; f.gd = 0; }
      s.refresh(); return;
    }
    const di = e.target.closest('.date-field input');
    if (di && di.showPicker && window.matchMedia('(pointer: fine)').matches) { try { di.showPicker(); } catch (x) { /* ignore */ } return; }
    const st = e.target.closest('[data-step]');
    if (st) { const k = st.dataset.step; f[k] = clampGames((f[k] || 0) + Number(st.dataset.d)); if (k !== 'gd' && f[k] === 0 && Number(st.dataset.d) < 0) f[k] = 0; s.refresh(); return; }
    const op = e.target.closest('[data-onplay]');
    if (op) { f.onPlay = op.dataset.onplay; s.refresh(); return; }
    const nd = e.target.closest('[data-new-deck]');
    if (nd) {
      const side = nd.dataset.newDeck;
      openDeckEditor(null, { playerId: f[side], onSaved: (deck) => { f[side === 'pa' ? 'da' : 'db'] = deck.id; s.refresh(); } });
      return;
    }
    const del = e.target.closest('[data-delete]');
    if (del && edit) {
      if (!f.confirmDelete) { f.confirmDelete = true; del.textContent = t('confirm_delete'); del.classList.add('confirm'); return; }
      busy(del, true, t('deleting'));
      try {
        await callScript('deleteMatch', { id: edit.id });
        s.close(); toast(t('match_deleted')); await load();
      } catch (err) {
        busy(del, false); f.confirmDelete = false; del.textContent = t('delete'); del.classList.remove('confirm');
        f.err = scriptError(err); s.refresh(); s.body.scrollTop = s.body.scrollHeight;
      }
      return;
    }
    const save = e.target.closest('[data-save]');
    if (!save) return;
    f.err = '';
    if (!f.date) f.err = t('e_date');
    else if (!f.pa || !f.pb) f.err = t('e_players');
    else if (f.pa === f.pb) f.err = t('e_diff');
    else if (!f.da || !f.db) f.err = t('e_decks');
    else if (f.ga == null || f.gb == null) f.err = t('e_games');
    else if (f.ga + f.gb + (f.gd || 0) === 0) f.err = t('e_one');
    if (f.err) { s.refresh(); s.body.scrollTop = s.body.scrollHeight; return; }
    busy(save, true);
    try {
      const D = state.data;
      const ga = f.ga, gb = f.gb, gd = f.gd || 0;
      const deck = (id) => D.deckById.get(id);
      const data = {
        date: f.date,
        playerA: pName(f.pa), deckA: deck(f.da).name,
        playerB: pName(f.pb), deckB: deck(f.db).name,
        onPlay: f.onPlay === 'a' ? pName(f.pa) : f.onPlay === 'b' ? pName(f.pb) : '',
        gamesA: ga, gamesB: gb, notes: f.notes.trim(),
      };
      if (edit) { if (gd || edit.gd) data.draws = gd || ''; await callScript('updateMatch', { id: edit.id, data }); }
      else { if (gd) data.draws = gd; await callScript('addMatch', { data }); }
      s.close();
      toast(edit ? t('match_updated') : t('match_saved'));
      await load();
    } catch (err) {
      busy(save, false);
      f.err = scriptError(err); s.refresh(); s.body.scrollTop = s.body.scrollHeight;
    }
  });
}

/** Friendlier message when the sheet still runs an older Code.gs without the newer actions. */
function scriptError(err) {
  return /Unknown action/i.test(err.message || '') ? t('err_script_old') : err.message;
}

/* ------------------------------------------------------------------ deck editor */
function openDeckEditor(deckId, opts = {}) {
  const d = state.data;
  if (!d) return;
  const deck = deckId ? d.deckById.get(deckId) : null;
  const f = deck
    ? { name: deck.name, colors: [...deck.colors], tags: deck.tags.join(', '), players: [...deck.playerIds], active: deck.active, err: '' }
    : { name: '', colors: [], tags: '', players: opts.playerId ? [opts.playerId] : [], active: true, err: '' };
  const tagList = () => splitList(f.tags);
  const s = openSheet({
    title: deck ? t('edit_deck') : t('new_deck'),
    foot: `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" data-save>${deck ? t('save_changes') : t('add_deck')}</button>`,
    render: () => {
      const cur = tagList().map((x) => x.toLowerCase());
      return `
      <label class="field"><span class="label">${t('name')}</span><input class="input" data-f="name" value="${esc(f.name)}" placeholder="${t('name_ph')}" autocomplete="off"></label>
      <div class="field"><span class="label">${t('colors')}</span>
        <div class="chips wrap">${COLORS.map((c) => `<button type="button" class="chip mana${f.colors.includes(c) ? ' on' : ''}" data-color="${c}" aria-pressed="${f.colors.includes(c)}" style="padding:0 12px 0 6px">${pip(c)}${cn(c)}</button>`).join('')}</div>
        <p class="hint" style="margin:6px 0 0">${t('colorless_hint')}</p>
      </div>
      <label class="field"><span class="label">${t('tags')}</span><input class="input" data-f="tags" value="${esc(f.tags)}" placeholder="${t('tags_ph')}" autocomplete="off" autocapitalize="off"></label>
      ${d.allTags.length ? `<div class="chips wrap" style="margin:-6px 0 14px">${d.allTags.map((tg) => `<button type="button" class="chip${cur.includes(tg) ? ' on' : ''}" data-tag="${esc(tg)}">${esc(tg)}</button>`).join('')}</div>` : ''}
      <div class="field"><span class="label">${t('players')}</span>
        <div class="chips wrap">${realPlayers().map((p) => `<button type="button" class="chip${f.players.includes(p.id) ? ' on' : ''}" data-player="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div>
      </div>
      <label class="switch" style="margin-bottom:14px"><span><b>${t('active')}</b><br><span class="small faint">${t('active_hint')}</span></span><input type="checkbox" data-f="active" ${f.active ? 'checked' : ''}></label>
      ${deck ? `<p class="hint">${t('rename_hint')}</p>` : ''}
      ${f.err ? `<p class="err-text">${esc(f.err)}</p>` : ''}`;
    },
  });
  s.el.addEventListener('input', (e) => { const k = e.target.dataset.f; if (k === 'name' || k === 'tags') f[k] = e.target.value; });
  s.el.addEventListener('change', (e) => {
    const k = e.target.dataset.f;
    if (k === 'active') f.active = e.target.checked;
    if (k === 'tags') s.refresh();
  });
  s.el.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-color]');
    if (c) { const v = c.dataset.color; f.colors = f.colors.includes(v) ? f.colors.filter((x) => x !== v) : COLORS.filter((x) => x === v || f.colors.includes(x)); s.refresh(); return; }
    const tgb = e.target.closest('[data-tag]');
    if (tgb) {
      const v = tgb.dataset.tag; const list = tagList();
      const has = list.some((x) => x.toLowerCase() === v);
      f.tags = (has ? list.filter((x) => x.toLowerCase() !== v) : [...list, v]).join(', ');
      s.refresh(); return;
    }
    const p = e.target.closest('[data-player]');
    if (p) { const v = p.dataset.player; f.players = f.players.includes(v) ? f.players.filter((x) => x !== v) : [...f.players, v]; s.refresh(); return; }
    const save = e.target.closest('[data-save]');
    if (!save) return;
    const D = state.data;
    f.name = f.name.trim(); f.err = '';
    if (!f.name) f.err = t('e_name');
    else if (!f.players.length) f.err = t('e_player');
    else if (D.decks.some((x) => x !== deck && !x.ghost && norm(x.name) === norm(f.name))) f.err = t('e_dup');
    if (f.err) { s.refresh(); s.body.scrollTop = s.body.scrollHeight; return; }
    busy(save, true);
    try {
      const values = {
        name: f.name, colors: f.colors.join(''), tags: tagList().join(', '),
        active: f.active, [D.playerCol]: f.players.join(', '),
      };
      let id;
      if (deck) {
        id = deck.id;
        await callScript('updateDeck', { id, data: values });
      } else {
        id = (await callScript('addDeck', { data: values })).id;
      }
      s.close();
      toast(deck ? t('deck_updated') : t('deck_added'));
      await load();
      if (opts.onSaved) {
        const saved = state.data && (state.data.deckById.get(id) || state.data.decks.find((x) => norm(x.name) === norm(f.name)));
        if (saved) opts.onSaved(saved);
      }
    } catch (err) {
      busy(save, false);
      f.err = err.message; s.refresh(); s.body.scrollTop = s.body.scrollHeight;
    }
  });
}

/* ------------------------------------------------------------------ events */
document.addEventListener('click', async (e) => {
  if (e.target.closest('#sheet-root')) return; // sheets handle their own clicks
  const set = e.target.closest('[data-set]');
  if (set) {
    const path = set.dataset.set;
    if (path === 'table.sort') { setPath('table.dir', getPath('table.sort') === set.dataset.val ? -getPath('table.dir') : -1); }
    setPath(path, set.dataset.val); render(); return;
  }
  const tog = e.target.closest('[data-toggle]');
  if (tog) {
    const path = tog.dataset.toggle, v = tog.dataset.val;
    let arr = getPath(path).slice();
    if (path.endsWith('colors') && (v === 'C' || arr.includes('C'))) arr = arr.includes(v) ? [] : [v];
    else arr = arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
    setPath(path, arr); render(); return;
  }
  const sort = e.target.closest('[data-sort]');
  if (sort) {
    const k = sort.dataset.sort;
    setPath('table.dir', getPath('table.sort') === k ? -getPath('table.dir') : -1);
    setPath('table.sort', k); render(); return;
  }
  const act = e.target.closest('[data-act]');
  if (act) {
    const a = act.dataset.act;
    if (a === 'settings') openSettings();
    else if (a === 'refresh') load();
    else if (a === 'flip-dir') { setPath('table.dir', -getPath('table.dir')); render(); }
    else if (a === 'clear-table') { setPath('table.colors', []); setPath('table.tags', []); render(); }
    else if (a === 'clear-matches') { setPath('matches.deck', ''); setPath('matches.player', ''); render(); }
    else if (a === 'new-deck') openDeckEditor(null);
    else if (a === 'back') { if (history.length > 1) history.back(); else location.hash = '#/decks'; }
    else if (a === 'reload-data') load({ toast: true });
    else if (a === 'manual-sheet') { state.manualEntry = true; render(); }
    else if (a === 'password-entry') { state.manualEntry = false; render(); }
    else if (a === 'edit-deck') openDeckEditor(act.dataset.id);
    return;
  }
  const em = e.target.closest('[data-edit-match]');
  if (em && !e.target.closest('a')) {
    const m = state.data && state.data.matches.find((x) => String(x.id) === em.dataset.editMatch);
    if (m) openMatchForm(m);
    return;
  }
  const href = e.target.closest('[data-href]');
  if (href && !e.target.closest('a')) { location.hash = href.dataset.href; }
});

function onModel(e) {
  const el = e.target.closest('[data-model]');
  if (!el || el.closest('#sheet-root')) return;
  const v = el.type === 'checkbox' ? el.checked : el.value;
  setPath(el.dataset.model, v);
  render();
}
document.addEventListener('change', (e) => { if (e.target.type !== 'search' && e.target.type !== 'text') onModel(e); });
document.addEventListener('input', (e) => { if (e.target.type === 'search' || e.target.type === 'text') onModel(e); });

document.addEventListener('submit', (e) => {
  const f = e.target;
  if (f.dataset.form === 'unlock') {
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]'); const err = $('#unlock-err');
    busy(btn, true, t('unlocking')); err.classList.add('hidden');
    unlockSheetId(CFG.lockedSheet, f.password.value)
      .then((id) => { if (!setSheet(id)) throw new Error(t('err_unlock_value')); persistStorage(); load(); })
      .catch((ex) => { busy(btn, false); err.textContent = ex.message; err.classList.remove('hidden'); f.password.select(); });
    return;
  }
  if (f.dataset.form !== 'onboard') return;
  e.preventDefault();
  if (!setSheet(f.sheet.value)) { $('#onboard-err').classList.remove('hidden'); return; }
  persistStorage();
  load();
});

$('#btn-settings').addEventListener('click', openSettings);
$('#btn-add').addEventListener('click', () => openMatchForm());
// Refresh data automatically when the app comes back to the foreground (no refresh button needed).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.data && !state.loading && Date.now() - state.loadedAt > 60000) load();
});
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

/* ------------------------------------------------------------------ install as app */
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; sheetStack.forEach((s) => s.refresh()); });
window.addEventListener('appinstalled', () => { installPrompt = null; toast(t('app_installed')); sheetStack.forEach((s) => s.refresh()); });
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function installSection() {
  let body;
  if (isStandalone()) body = `<div class="account"><span class="dot on"></span><div class="grow small">${t('installed')}</div></div>`;
  else if (installPrompt) body = `<button class="btn primary block" data-act="install">${t('install_btn')}</button><p class="hint" style="margin:8px 0 0">${t('install_hint')}</p>`;
  else if (isIOS()) body = `<p class="small muted" style="margin:0">${t('install_ios')}</p>`;
  else body = `<p class="small muted" style="margin:0">${t('install_chrome')}</p>`;
  return `<div class="field"><span class="label">${t('install_label')}</span>${body}</div><div class="divider"></div>`;
}
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

function setLanguage(v) {
  try { localStorage.setItem('mtg.lang', JSON.stringify(v)); } catch (e) { /* ignore */ }
  LANG = resolveLang();
  applyStaticTexts();
  if (state.data) state.data.matches.forEach((m) => { if (m.da.ghost && m.da.id === '?') m.da.name = t('no_deck'); if (m.db.ghost && m.db.id === '?') m.db.name = t('no_deck'); });
  render();
  sheetStack.forEach((x) => x.refresh());
}

/* ------------------------------------------------------------------ boot */
applyTheme();
applyStaticTexts();
probeIcons();
(function boot() {
  const cache = store.get('cache', null);
  if (state.sheetId && cache && cache.id === state.sheetId) {
    try { state.data = buildModel(cache.raw); state.config = state.data.config; state.loadedAt = cache.at; } catch (e) { /* ignore bad cache */ }
  }
  render();
  if (state.sheetId) { load(); persistStorage(); }
})();
