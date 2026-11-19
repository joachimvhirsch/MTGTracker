/* MTG Tracker — Sealed mode: self-organised mini tournaments (Swiss system).
 * Loaded before app.js; everything here runs only when app.js calls it.
 * Sheet tabs (created by Code.gs): Tournaments, TournamentPlayers, TournamentMatches.
 */
'use strict';

const SEALED_DEFAULT_MINUTES = 50;
const SEALED_VIEWS = {
  stats: (a) => viewSealedStats(a),
  table: (a) => viewSealedTable(a),
  tournaments: (a) => viewSealedTournaments(a),
  t: (id) => viewTournament(id),
};

/* ------------------------------------------------------------------ model */
function buildSealed(raw) {
  const T = table(raw.tournaments || [[]]), TP = table(raw.tplayers || [[]]), TM = table(raw.tmatches || [[]]);
  const num = (v) => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
  const tournaments = T.items.filter((x) => x.id).map((x) => ({
    id: x.id, name: x.name || x.id, date: parseDate(x.date), dateRaw: x.date || '',
    setCode: x.setcode || '', setName: x.setname || '', setIcon: x.seticon || '',
    status: norm(x.status) === 'finished' ? 'finished' : 'running',
    roundMinutes: num(x.roundminutes) || SEALED_DEFAULT_MINUTES,
    timerRound: num(x.timerround) || 0, roundStart: x.roundstart || '',
    players: [], matches: [], rounds: 0,
  }));
  const byId = new Map(tournaments.map((x) => [x.id, x]));
  TP.items.forEach((p) => {
    const tn = byId.get(p.tournamentid);
    if (!tn || !p.player) return;
    tn.players.push({ name: p.player, colors: normColors(p.colors), rank: num(p.rank), points: num(p.points) });
  });
  TM.items.forEach((m) => {
    const tn = byId.get(m.tournamentid);
    if (!tn || !m.playera) return;
    tn.matches.push({ id: m.id, round: num(m.round) || 1, table: num(m.table) || 0, a: m.playera, b: m.playerb || '', ga: num(m.gamesa), gb: num(m.gamesb), gd: num(m.draws) || 0 });
  });
  tournaments.forEach((tn) => {
    tn.matches.sort((x, y) => x.round - y.round || x.table - y.table);
    tn.rounds = tn.matches.reduce((a, m) => Math.max(a, m.round), 0);
  });
  tournaments.sort((a, b) => (a.status === b.status ? 0 : a.status === 'running' ? -1 : 1)
    || ((b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0)) || String(b.id).localeCompare(String(a.id)));
  return { tournaments, byId };
}
const isBye = (m) => !m.b;
const isReported = (m) => isBye(m) || (m.ga != null && m.gb != null);
const roundMatches = (tn, r) => tn.matches.filter((m) => m.round === r);
const recommendedRounds = (n) => Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));
function playerColors(tn, name) { const p = tn.players.find((x) => x.name === name); return p ? p.colors : []; }

/* ------------------------------------------------------------------ standings (official MTG tiebreakers) */
// 3 points per match win, 1 per draw. A bye counts as a 2–0 win but is not an opponent.
// Tiebreakers: OMW% (opponents' match win %), GW% (game win %), OGW% — each percentage floored at 33%.
function standings(tn) {
  const P = new Map();
  const get = (n) => {
    if (!P.has(n)) P.set(n, { name: n, colors: playerColors(tn, n), pts: 0, mp: 0, w: 0, l: 0, d: 0, gw: 0, gl: 0, gd: 0, opps: [], byes: 0 });
    return P.get(n);
  };
  tn.players.forEach((p) => get(p.name));
  for (const m of tn.matches) {
    if (!isReported(m)) continue;
    const A = get(m.a);
    if (isBye(m)) { A.pts += 3; A.mp++; A.w++; A.gw += 2; A.byes++; continue; }
    const B = get(m.b);
    A.mp++; B.mp++; A.opps.push(m.b); B.opps.push(m.a);
    A.gw += m.ga; A.gl += m.gb; B.gw += m.gb; B.gl += m.ga; A.gd += m.gd; B.gd += m.gd;
    if (m.ga > m.gb) { A.w++; B.l++; A.pts += 3; } else if (m.gb > m.ga) { B.w++; A.l++; B.pts += 3; } else { A.d++; B.d++; A.pts++; B.pts++; }
  }
  const list = [...P.values()];
  list.forEach((p) => {
    const g = p.gw + p.gl + p.gd;
    p.mwp = p.mp ? Math.max(1 / 3, p.pts / (3 * p.mp)) : 0;
    p.gwp = g ? Math.max(1 / 3, (3 * p.gw + p.gd) / (3 * g)) : 0;
  });
  list.forEach((p) => {
    const os = p.opps.map((n) => P.get(n)).filter(Boolean);
    p.omw = os.length ? os.reduce((a, o) => a + o.mwp, 0) / os.length : 0;
    p.ogw = os.length ? os.reduce((a, o) => a + o.gwp, 0) / os.length : 0;
  });
  list.sort((a, b) => b.pts - a.pts || b.omw - a.omw || b.gwp - a.gwp || b.ogw - a.ogw || a.name.localeCompare(b.name));
  list.forEach((p, i) => { p.rank = i + 1; });
  return list;
}

/* ------------------------------------------------------------------ Swiss pairing */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** Pairings for the next round: round 1 random, later by points (random within a point group), no rematches, bye to the lowest-ranked player without one. */
function pairNextRound(tn) {
  const round = tn.rounds + 1;
  const names = tn.players.map((p) => p.name);
  const played = new Set(); const hadBye = new Set();
  tn.matches.forEach((m) => { if (isBye(m)) hadBye.add(m.a); else { played.add(m.a + '|' + m.b); played.add(m.b + '|' + m.a); } });
  let order;
  if (round === 1) order = shuffle(names);
  else {
    const groups = new Map();
    standings(tn).filter((p) => names.includes(p.name)).forEach((p) => { if (!groups.has(p.pts)) groups.set(p.pts, []); groups.get(p.pts).push(p.name); });
    order = [...groups.keys()].sort((a, b) => b - a).flatMap((k) => shuffle(groups.get(k)));
  }
  let bye = null;
  if (order.length % 2) {
    for (let i = order.length - 1; i >= 0; i--) if (!hadBye.has(order[i])) { bye = order[i]; break; }
    if (bye == null) bye = order[order.length - 1];
    order = order.filter((n) => n !== bye);
  }
  const pair = (list) => {
    if (!list.length) return [];
    const [p, ...rest] = list;
    for (let i = 0; i < rest.length; i++) {
      if (played.has(p + '|' + rest[i])) continue;
      const sub = pair(rest.filter((_, j) => j !== i));
      if (sub) return [[p, rest[i]], ...sub];
    }
    return null;
  };
  let pairs = pair(order); let rematch = false;
  if (!pairs) { rematch = true; pairs = []; for (let i = 0; i < order.length; i += 2) pairs.push([order[i], order[i + 1]]); }
  const matches = pairs.map(([a, b], i) => ({ table: i + 1, playerA: a, playerB: b }));
  if (bye) matches.push({ table: matches.length + 1, playerA: bye, playerB: '', gamesA: 2, gamesB: 0 });
  return { round, matches, rematch };
}

/* ------------------------------------------------------------------ shared round timer + alarm */
function timerInfo(tn) {
  if (!tn || tn.status !== 'running' || !tn.roundStart || tn.timerRound !== tn.rounds || !tn.rounds) return null;
  const start = Date.parse(tn.roundStart);
  if (isNaN(start)) return null;
  const end = start + tn.roundMinutes * 60000;
  return { start, end, left: end - Date.now() };
}
const fmtClock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

let audioCtx = null; let alarmTimer = null; let alarmSheet = null; let wakeLock = null;
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* no audio */ }
}
function beep(at, freq) {
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = 'square'; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.25, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
  o.connect(g).connect(audioCtx.destination); o.start(at); o.stop(at + 0.3);
}
function ringAlarm(tn) {
  unlockAudio();
  let n = 0;
  const burst = () => {
    if (audioCtx) { const now = audioCtx.currentTime; [0, 0.35, 0.7].forEach((d, i) => beep(now + d, i === 2 ? 1320 : 880)); }
    try { navigator.vibrate && navigator.vibrate([400, 150, 400, 150, 700]); } catch (e) { /* ignore */ }
    if (++n >= 20) stopAlarm();
  };
  stopAlarm(); burst(); alarmTimer = setInterval(burst, 1800);
  alarmSheet = openSheet({
    title: () => t('time_up'),
    foot: `<button class="btn primary" data-stop-alarm>${t('stop_alarm')}</button>`,
    render: () => `<div class="alarm-box">${TAB_ICONS.trophy}<p>${esc(t('time_up_text', { n: tn.rounds }))}</p></div>`,
  });
  alarmSheet.el.addEventListener('click', (e) => { if (e.target.closest('[data-stop-alarm], [data-close]') || e.target === alarmSheet.el) stopAlarm(); });
}
function stopAlarm() {
  if (alarmTimer) { clearInterval(alarmTimer); alarmTimer = null; }
  try { navigator.vibrate && navigator.vibrate(0); } catch (e) { /* ignore */ }
  if (alarmSheet) { const s = alarmSheet; alarmSheet = null; s.close(); }
}
async function keepScreenOn(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { /* not supported */ }
}
function currentTournament() {
  const r = route();
  if (r.mode !== 'sealed' || r.arg !== 't' || !state.data || !state.data.sealed) return null;
  return state.data.sealed.byId.get(r.arg2) || null;
}
function tickTimers() {
  const tn = currentTournament();
  const info = timerInfo(tn);
  keepScreenOn(!!info && info.left > 0);
  $$('[data-timer]').forEach((el) => {
    if (!info) return;
    el.textContent = info.left > 0 ? fmtClock(info.left) : '0:00';
    el.classList.toggle('over', info.left <= 0);
    el.classList.toggle('soon', info.left > 0 && info.left < 5 * 60000);
  });
  if (info && info.left <= 0 && info.left > -90000) {
    const key = tn.id + '|' + tn.roundStart;
    if (store.get('alarmed', '') !== key) { store.set('alarmed', key); ringAlarm(tn); }
  }
}
function initSealed() {
  document.addEventListener('pointerdown', unlockAudio, { passive: true });
  setInterval(tickTimers, 1000);
  // Keep a running tournament in sync across phones (other players enter results / start the timer).
  setInterval(() => {
    const tn = currentTournament();
    if (tn && tn.status === 'running' && !state.loading && document.visibilityState === 'visible' && !sheetStack.length) load();
  }, 20000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tickTimers(); });
}

/* ------------------------------------------------------------------ shared UI bits */
function setIcon(tn, cls = '') {
  return tn.setIcon
    ? `<span class="set-icon ${cls}"><img src="${esc(tn.setIcon)}" alt="" loading="lazy"></span>`
    : `<span class="set-icon none ${cls}">${TAB_ICONS.trophy}</span>`;
}
function tDate(tn) { return tn.date ? fmtDate(tn.date) : esc(tn.dateRaw); }
function inPeriod(d, period) {
  if (period === 'all') return true;
  if (!d) return false;
  const now = new Date();
  const from = period === 'year' ? new Date(now.getFullYear(), 0, 1) : new Date(now.getFullYear(), now.getMonth(), now.getDate() - Number(period));
  return d >= from;
}
function periodFilter(path, value) {
  return segmented(path, value, [['all', t('period_all')], ['year', t('period_year')], ['90', t('period_90')], ['30', t('period_30')]]);
}
function sealedUi() {
  if (!state.ui.sealed) state.ui.sealed = { period: 'all', tPeriod: 'all', sort: 'wr', dir: -1, colorMetric: 'played' };
  return state.ui.sealed;
}
/** Every player's matches (byes excluded) in the given tournaments, from each side. */
function sealedSides(list) {
  const out = [];
  for (const tn of list) for (const m of tn.matches) {
    if (isBye(m) || !isReported(m)) continue;
    const res = (x, y) => (x > y ? 'W' : x < y ? 'L' : 'D');
    out.push({ tn, player: m.a, colors: playerColors(tn, m.a), gw: m.ga, gl: m.gb, r: res(m.ga, m.gb) });
    out.push({ tn, player: m.b, colors: playerColors(tn, m.b), gw: m.gb, gl: m.ga, r: res(m.gb, m.ga) });
  }
  return out;
}
function addSide(rec, s) { rec.m++; rec[s.r === 'W' ? 'w' : s.r === 'L' ? 'l' : 'd']++; rec.gw += s.gw; rec.gl += s.gl; return rec; }
const newRec = () => ({ m: 0, w: 0, l: 0, d: 0, gw: 0, gl: 0 });

/* ------------------------------------------------------------------ view: statistics */
function viewSealedStats() {
  const S = state.data.sealed, ui = sealedUi();
  const list = S.tournaments.filter((tn) => inPeriod(tn.date, ui.period));
  const sides = sealedSides(list);
  const players = new Set(list.flatMap((tn) => tn.players.map((p) => p.name)));
  const lastT = S.tournaments.filter((tn) => tn.date).sort((a, b) => b.date - a.date)[0];
  const kpis = `<div class="kpis">
    <div class="kpi"><div class="k-label">${t('kpi_tournaments')}</div><div class="k-value num">${list.length}</div><div class="k-sub">${t('finished_n', list.filter((x) => x.status === 'finished').length)}</div></div>
    <div class="kpi"><div class="k-label">${t('kpi_matches')}</div><div class="k-value num">${sides.length / 2}</div><div class="k-sub">${t('games_n', sides.reduce((a, s) => a + s.gw, 0))}</div></div>
    <div class="kpi"><div class="k-label">${t('kpi_players')}</div><div class="k-value num">${players.size}</div><div class="k-sub">&nbsp;</div></div>
    <div class="kpi"><div class="k-label">${t('kpi_last_tournament')}</div><div class="k-value" style="font-size:18px;padding-top:5px">${lastT ? fmtDate(lastT.date, { day: 'numeric', month: 'short' }) : '—'}</div><div class="k-sub">${lastT ? esc(lastT.setName || lastT.name) : ''}</div></div>
  </div>`;
  const pRec = new Map();
  sides.forEach((s) => { if (!pRec.has(s.player)) pRec.set(s.player, newRec()); addSide(pRec.get(s.player), s); });
  const wrOf = (r) => (r.m ? r.w / r.m : null);
  const pRows = [...pRec.entries()].sort((a, b) => (wrOf(b[1]) - wrOf(a[1])) || b[1].m - a[1].m).map(([n, r]) => ({
    label: n, value: wrOf(r), valueHtml: `${pct(wrOf(r))}<small>${recStr(r)}</small>`, title: `${n}: ${recStr(r)}`,
  }));
  const titles = new Map();
  list.filter((tn) => tn.status === 'finished').forEach((tn) => tn.players.filter((p) => p.rank === 1).forEach((p) => titles.set(p.name, (titles.get(p.name) || 0) + 1)));
  const tRows = [...titles.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n, c]) => ({ label: n, value: c, valueHtml: String(c), title: `${n}: ${c}` }));
  const cStat = {}; [...COLORS, 'C'].forEach((c) => { cStat[c] = { n: 0, rec: newRec() }; });
  const colored = sides.filter((s) => s.colors.length);
  colored.forEach((s) => s.colors.forEach((c) => { cStat[c].n++; addSide(cStat[c].rec, s); }));
  const played = ui.colorMetric === 'played';
  const cRows = COLORS.map((c) => ({
    label: cn(c), icon: pip(c), color: `var(--mana-${c})`, ringed: true,
    value: played ? cStat[c].n : wrOf(cStat[c].rec),
    valueHtml: played ? `${cStat[c].n}<small>${pct(colored.length ? cStat[c].n / colored.length : null)}</small>` : `${pct(wrOf(cStat[c].rec))}<small>${recStr(cStat[c].rec)}</small>`,
  }));
  return `<div class="filters">${periodFilter('sealed.period', ui.period)}</div>
    ${kpis}
    <section class="card"><h2>${t('player_wr_title')}</h2><p class="card-sub">${t('player_wr_sub')}</p>${hbars(pRows, { max: 1, axis: 0.5, big: true })}</section>
    <section class="card"><h2>${t('titles_title')}</h2><p class="card-sub">${t('titles_sub')}</p>${hbars(tRows, {})}</section>
    <section class="card">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div><h2>${t('colors_title')}</h2><p class="card-sub">${played ? t('sealed_colors_sub_played') : t('colors_sub_wr')}</p></div>
        ${segmented('sealed.colorMetric', ui.colorMetric, [['played', t('played')], ['wr', t('win_pct')]])}
      </div>
      ${colored.length ? hbars(cRows, played ? {} : { max: 1, axis: 0.5 }) : `<p class="muted small">${t('sealed_no_colors')}</p>`}
    </section>
    ${S.tournaments.length ? '' : `<div class="empty"><h2>${t('no_tournaments')}</h2><p>${t('no_tournaments_sub')}</p></div>`}`;
}

/* ------------------------------------------------------------------ view: table (players across tournaments) */
function viewSealedTable() {
  const S = state.data.sealed, ui = sealedUi();
  const list = S.tournaments.filter((tn) => inPeriod(tn.date, ui.tPeriod));
  const rows = new Map();
  const row = (n) => { if (!rows.has(n)) rows.set(n, { name: n, t: 0, titles: 0, places: [], rec: newRec() }); return rows.get(n); };
  list.forEach((tn) => tn.players.forEach((p) => {
    const r = row(p.name); r.t++;
    if (tn.status === 'finished' && p.rank) { r.places.push(p.rank); if (p.rank === 1) r.titles++; }
  }));
  sealedSides(list).forEach((s) => addSide(row(s.player).rec, s));
  const wrOf = (r) => (r.rec.m ? r.rec.w / r.rec.m : null);
  const avg = (r) => (r.places.length ? r.places.reduce((a, b) => a + b, 0) / r.places.length : null);
  const byWr = (a, b) => ((wrOf(b) ?? -1) - (wrOf(a) ?? -1)) || b.titles - a.titles || a.name.localeCompare(b.name);
  const cmp = {
    wr: byWr, t: (a, b) => b.t - a.t || byWr(a, b), titles: (a, b) => b.titles - a.titles || byWr(a, b),
    avg: (a, b) => ((avg(a) ?? 99) - (avg(b) ?? 99)) || byWr(a, b), matches: (a, b) => b.rec.m - a.rec.m || byWr(a, b),
    player: (a, b) => a.name.localeCompare(b.name),
  }[ui.sort] || byWr;
  const data = [...rows.values()].sort((a, b) => cmp(a, b) * (ui.dir === -1 ? 1 : -1));
  const arrow = (['player', 'avg'].includes(ui.sort)) === (ui.dir === -1) ? '↑' : '↓';
  const th = (key, label, html) => `<button data-ssort="${key}" class="${ui.sort === key ? 'on' : ''}" aria-label="${esc(t('sort_by', { x: label }))}" title="${esc(label)}">${html || esc(label)}<span class="sort-ind">${ui.sort === key ? arrow : '↕'}</span></button>`;
  const fmt1 = (x) => (x == null ? '–' : x.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
  return `<div class="filters">${periodFilter('sealed.tPeriod', ui.tPeriod)}</div>
    <div class="toolbar"><span class="count">${t('players_n', data.length)}</span><span class="count">${t('tap_sort')}</span></div>
    ${data.length ? `<div class="card league-card"><table class="league stable">
      <thead><tr><th>#</th><th class="pl">${th('player', t('col_player'))}</th><th>${th('t', t('col_t'))}</th><th>${th('titles', t('titles_title'), TAB_ICONS.trophy)}</th><th>${th('avg', t('col_avg'))}</th><th>${th('matches', t('col_m'))}</th><th>${th('wr', t('col_win'))}</th></tr></thead>
      <tbody>${data.map((r, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td class="pl"><b>${esc(r.name)}</b></td>
        <td class="num">${r.t}</td>
        <td class="num">${r.titles || '–'}</td>
        <td class="num">${fmt1(avg(r))}</td>
        <td class="num"><span style="font-weight:600">${r.rec.m}</span><span class="rec">${recStr(r.rec)}</span></td>
        <td class="num"><span class="wr">${pct(wrOf(r))}</span><span class="wr-bar"><i style="width:${(wrOf(r) || 0) * 100}%"></i></span></td>
      </tr>`).join('')}</tbody></table></div>
      <p class="legend-note">${t('sealed_table_note')}</p>` : `<div class="empty"><h2>${t('no_tournaments')}</h2><p>${t('no_tournaments_sub')}</p></div>`}`;
}

/* ------------------------------------------------------------------ view: tournaments list */
function viewSealedTournaments() {
  const S = state.data.sealed;
  if (!S.tournaments.length) return `<div class="empty"><h2>${t('no_tournaments')}</h2><p>${t('no_tournaments_sub')}</p></div>`;
  return `<div class="list">${S.tournaments.map((tn) => {
    const winner = tn.players.find((p) => p.rank === 1);
    const status = tn.status === 'running'
      ? `<span class="badge running">${t('t_running')}${tn.rounds ? ' · ' + t('round_n', { n: tn.rounds }) : ''}</span>`
      : winner ? `<span class="winner">${TAB_ICONS.trophy}${esc(winner.name)}</span>` : `<span class="badge inactive">${t('t_finished')}</span>`;
    return `<a class="list-item tap" href="#/sealed/t/${encodeURIComponent(tn.id)}">
      ${setIcon(tn)}
      <div class="li-main"><div class="li-title">${esc(tn.name)}</div>
        <div class="li-sub"><span>${esc(tn.setName || '')}</span><span>${tDate(tn)}</span><span>${t('players_n', tn.players.length)}</span></div></div>
      <div class="li-end">${status}</div>${ICON.chev}
    </a>`;
  }).join('')}</div>`;
}

/* ------------------------------------------------------------------ view: one tournament */
function viewTournament(id) {
  const tn = state.data.sealed.byId.get(id);
  if (!tn) return `<div class="empty"><h2>${t('tournament_not_found')}</h2><p><a href="#/sealed/tournaments">${t('tab_tournaments')}</a></p></div>`;
  const st = standings(tn);
  const running = tn.status === 'running';
  const cur = roundMatches(tn, tn.rounds);
  const allDone = cur.length > 0 && cur.every(isReported);
  const anyResult = cur.some((m) => !isBye(m) && isReported(m));
  const info = timerInfo(tn);
  const rec = recommendedRounds(tn.players.length);

  const pairingRow = (m, editable) => {
    if (isBye(m)) return `<div class="pairing bye"><span class="tbl">${t('table_n', { n: m.table })}</span><span class="pn">${esc(m.a)}</span><span class="res">${t('bye')}</span></div>`;
    const done = isReported(m);
    const aw = done && m.ga > m.gb, bw = done && m.gb > m.ga;
    return `<div class="pairing${editable ? ' tap' : ''}" ${editable ? `data-act="t-result" data-id="${esc(tn.id)}" data-match="${esc(m.id)}" role="button"` : ''}>
      <span class="tbl">${t('table_n', { n: m.table })}</span>
      <span class="pn ${aw ? 'won' : ''}">${esc(m.a)}</span>
      <span class="res">${done ? `${m.ga}:${m.gb}${m.gd ? `<small>+${m.gd}</small>` : ''}` : `<span class="enter" title="${t('enter_result')}">–:–</span>`}</span>
      <span class="pn right ${bw ? 'won' : ''}">${esc(m.b)}</span>
    </div>`;
  };

  let roundCard = '';
  if (running && !tn.rounds) {
    roundCard = `<section class="card round-card">
      <h2>${t('round_n', { n: 1 })}</h2><p class="card-sub">${t('rec_rounds', { p: tn.players.length, r: rec })}</p>
      <button class="btn primary block" data-act="t-pair" data-id="${esc(tn.id)}">${t('pair_round', { n: 1 })}</button>
    </section>`;
  } else if (running) {
    const timer = allDone ? '' : info
      ? `<div class="timer"><span class="clock" data-timer>${fmtClock(info.left)}</span><span class="small faint">${t('time_left')}</span></div>
         <button class="link-btn small" data-act="t-start" data-id="${esc(tn.id)}">${t('restart_timer')}</button>`
      : (!allDone ? `<button class="btn primary block" data-act="t-start" data-id="${esc(tn.id)}">${ICON.clock}${t('start_round', { m: tn.roundMinutes })}</button>` : '');
    roundCard = `<section class="card round-card">
      <div class="row" style="justify-content:space-between"><h2>${t('round_n', { n: tn.rounds })}</h2><span class="small faint">${t('rec_rounds_short', { r: rec })}</span></div>
      ${timer}
      ${!allDone ? `<p class="card-sub" style="margin:10px 0 0">${t('tap_pairing')}</p>` : ''}
      <div class="pairings">${cur.map((m) => pairingRow(m, true)).join('')}</div>
      ${!anyResult ? `<button class="link-btn small" data-act="t-repair" data-id="${esc(tn.id)}">${t('repair_round')}</button>` : ''}
      ${allDone ? `<div class="round-done"><p><b>${t('round_complete', { n: tn.rounds })}</b></p>
        <div class="row"><button class="btn grow" data-act="t-finish" data-id="${esc(tn.id)}">${t('finish_tournament')}</button>
        <button class="btn primary grow" data-act="t-pair" data-id="${esc(tn.id)}">${t('next_round')}</button></div></div>` : ''}
    </section>`;
  }

  const pc = (x) => (x ? Math.round(x * 100) + (LANG === 'de' ? ' %' : '%') : '–');
  const medal = (r) => (!running && r <= 3 ? `<span class="medal m${r}">${r}</span>` : r);
  const standingsCard = `<section class="card">
    <h2>${running ? t('standings') : t('final_standings')}</h2><p class="card-sub">${t('tap_player_colors')}</p>
    <table class="league standings"><thead><tr><th>#</th><th>${t('col_player')}</th><th>${t('col_pts')}</th><th>${t('col_rec')}</th><th>OMW</th><th>GW</th><th>OGW</th></tr></thead>
    <tbody>${st.map((p) => `<tr class="tap" data-act="t-colors" data-id="${esc(tn.id)}" data-player="${esc(p.name)}">
      <td class="num">${medal(p.rank)}</td>
      <td class="deck-cell"><span class="name">${esc(p.name)}</span><span class="meta">${p.colors.length ? pips(p.colors) : `<span class="faint small">${t('no_colors')}</span>`}</span></td>
      <td class="num"><b>${p.pts}</b></td>
      <td class="num muted">${p.w}–${p.l}${p.d ? '–' + p.d : ''}</td>
      <td class="num small">${pc(p.omw)}</td><td class="num small">${pc(p.gwp)}</td><td class="num small">${pc(p.ogw)}</td>
    </tr>`).join('')}</tbody></table>
    <p class="legend-note">${t('tiebreak_note')}</p>
  </section>`;

  const pastRounds = [];
  for (let r = running ? tn.rounds - 1 : tn.rounds; r >= 1; r--) {
    pastRounds.push(`<div class="date-head">${t('round_n', { n: r })}</div><div class="list pairings">${roundMatches(tn, r).map((m) => pairingRow(m, running)).join('')}</div>`);
  }

  return `<button class="link-btn back-link" data-act="t-back">${t('back')}</button>
    <div class="t-hero">${setIcon(tn, 'lg')}
      <div><h2>${esc(tn.name)}</h2>
        <div class="meta"><span class="badge ${running ? 'running' : 'inactive'}">${running ? t('t_running') : t('t_finished')}</span>
          <span>${esc(tn.setName || '')}${tn.setCode ? ` (${esc(tn.setCode)})` : ''}</span><span>${tDate(tn)}</span></div></div></div>
    ${roundCard}
    ${standingsCard}
    ${pastRounds.length ? `<div class="section-title">${t('rounds_history')}</div>${pastRounds.join('')}` : ''}
    <div style="height:18px"></div>
    <button class="btn block danger" data-act="t-delete" data-id="${esc(tn.id)}">${t('delete_tournament')}</button>
    ${tn.setIcon ? `<p class="legend-note">${t('set_source')}</p>` : ''}`;
}

/* ------------------------------------------------------------------ actions */
let deleteArmed = null;
async function sealedAct(a, el) {
  const id = el.dataset.id;
  const tn = id && state.data && state.data.sealed ? state.data.sealed.byId.get(id) : null;
  if (a !== 't-delete' && deleteArmed) { deleteArmed.textContent = t('delete_tournament'); deleteArmed.classList.remove('confirm'); deleteArmed = null; }
  const run = async (btn, fn, msg) => {
    busy(btn, true, t('saving'));
    try { await fn(); if (msg) toast(msg); await load(); } catch (err) { busy(btn, false); toast(scriptError(err), true); }
  };
  if (a === 't-back') { if (history.length > 1) history.back(); else location.hash = '#/sealed/tournaments'; return; }
  if (!tn) return;
  if (a === 't-pair') {
    const p = pairNextRound(tn);
    await run(el, () => callScript('addTournamentMatches', { tournamentId: tn.id, round: p.round, matches: p.matches }), p.rematch ? t('rematch_warning') : null);
  } else if (a === 't-repair') {
    await run(el, async () => {
      await callScript('deleteRound', { tournamentId: tn.id, round: tn.rounds });
      const fresh = { ...tn, matches: tn.matches.filter((m) => m.round !== tn.rounds), rounds: tn.rounds - 1 };
      const p = pairNextRound(fresh);
      await callScript('addTournamentMatches', { tournamentId: tn.id, round: p.round, matches: p.matches });
    });
  } else if (a === 't-start') {
    unlockAudio();
    await run(el, () => callScript('updateTournament', { id: tn.id, data: { timerRound: tn.rounds, roundStart: new Date().toISOString() } }));
  } else if (a === 't-finish') {
    const st = standings(tn);
    await run(el, () => callScript('finishTournament', { id: tn.id, results: st.map((p) => ({ player: p.name, rank: p.rank, points: p.pts })) }),
      st[0] ? t('winner_toast', { name: st[0].name }) : null);
  } else if (a === 't-result') {
    const m = tn.matches.find((x) => String(x.id) === el.dataset.match);
    if (m) openResultSheet(tn, m);
  } else if (a === 't-colors') {
    openColorsSheet(tn, el.dataset.player);
  } else if (a === 't-delete') {
    if (deleteArmed !== el) { deleteArmed = el; el.textContent = t('confirm_delete'); el.classList.add('confirm'); return; }
    deleteArmed = null;
    busy(el, true, t('deleting'));
    try { await callScript('deleteTournament', { id: tn.id }); toast(t('tournament_deleted')); location.hash = '#/sealed/tournaments'; await load(); }
    catch (err) { busy(el, false); toast(scriptError(err), true); }
  }
}
// sortable headers of the sealed table
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ssort]');
  if (!b) return;
  const ui = sealedUi(), k = b.dataset.ssort;
  ui.dir = ui.sort === k ? -ui.dir : -1; ui.sort = k;
  store.set('ui', state.ui); render();
});

/* ------------------------------------------------------------------ sheets: result, colors */
function openResultSheet(tn, m) {
  const f = { ga: m.ga, gb: m.gb, gd: m.gd || 0, err: '' };
  const opts = [[2, 0], [2, 1], [1, 2], [0, 2]], more = [[1, 0], [0, 1], [1, 1], [0, 0]];
  const on = (a, b) => f.ga === a && f.gb === b;
  const s = openSheet({
    title: () => t('table_n', { n: m.table }),
    foot: `${isReported(m) ? `<button class="btn" data-clear>${t('clear_result')}</button>` : `<button class="btn" data-close>${t('cancel')}</button>`}<button class="btn primary" data-save>${t('save_changes')}</button>`,
    render: () => `
      <div class="res-head"><b>${esc(m.a)}</b><span class="faint">${t('vs')}</span><b>${esc(m.b)}</b></div>
      <div class="result-grid">${opts.map(([a, b]) => `<button type="button" data-r="${a}-${b}" class="${on(a, b) ? 'on' : ''}"><b>${a}–${b}</b><span>${t('wins', { name: esc(a > b ? m.a : m.b) })}</span></button>`).join('')}</div>
      <div class="quick-picks">${more.map(([a, b]) => `<button type="button" class="chip${on(a, b) ? ' on' : ''}" data-r="${a}-${b}">${a}–${b}</button>`).join('')}
        <span class="grow"></span><span class="small muted">${t('draws_label')}</span>
        <div class="mini-step"><button type="button" data-gd="-1">−</button><input type="number" inputmode="numeric" data-f="gd" value="${f.gd}" aria-label="${t('draws_label')}"><button type="button" data-gd="1">+</button></div>
      </div>
      ${f.ga != null && f.gb != null ? `<p class="hint result-hint" style="margin-top:12px">${f.ga === f.gb ? t('match_draw') : t('wins_match', { name: esc(f.ga > f.gb ? m.a : m.b) })}</p>` : ''}
      ${f.err ? `<p class="err-text">${esc(f.err)}</p>` : ''}`,
  });
  s.el.addEventListener('change', (e) => { if (e.target.dataset.f === 'gd') { f.gd = Math.max(0, Math.min(9, parseInt(e.target.value, 10) || 0)); s.refresh(); } });
  s.el.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-r]');
    if (r) { [f.ga, f.gb] = r.dataset.r.split('-').map(Number); s.refresh(); return; }
    const g = e.target.closest('[data-gd]');
    if (g) { f.gd = Math.max(0, Math.min(9, f.gd + Number(g.dataset.gd))); s.refresh(); return; }
    const clear = e.target.closest('[data-clear]'), save = e.target.closest('[data-save]');
    if (!clear && !save) return;
    if (save && (f.ga == null || f.gb == null)) { f.err = t('e_pick_result'); s.refresh(); return; }
    const btn = clear || save;
    busy(btn, true, t('saving'));
    try {
      await callScript('updateTournamentMatch', { id: m.id, data: clear ? { gamesA: '', gamesB: '', draws: '' } : { gamesA: f.ga, gamesB: f.gb, draws: f.gd || '' } });
      s.close(); toast(t('result_saved')); await load();
    } catch (err) { busy(btn, false); f.err = scriptError(err); s.refresh(); }
  });
}

function openColorsSheet(tn, name) {
  const p = tn.players.find((x) => x.name === name);
  if (!p) return;
  let colors = [...p.colors]; let err = '';
  const s = openSheet({
    title: () => t('edit_colors', { name }),
    foot: `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" data-save>${t('save_changes')}</button>`,
    render: () => `<p class="hint" style="margin:0 0 12px">${t('sealed_colors_hint')}</p>
      <div class="chips wrap">${COLORS.map((c) => `<button type="button" class="chip mana${colors.includes(c) ? ' on' : ''}" data-color="${c}" style="padding:0 12px 0 6px">${pip(c)}${cn(c)}</button>`).join('')}</div>
      ${err ? `<p class="err-text">${esc(err)}</p>` : ''}`,
  });
  s.el.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-color]');
    if (c) { const v = c.dataset.color; colors = colors.includes(v) ? colors.filter((x) => x !== v) : COLORS.filter((x) => x === v || colors.includes(x)); s.refresh(); return; }
    const save = e.target.closest('[data-save]');
    if (!save) return;
    busy(save, true, t('saving'));
    try { await callScript('updateTournamentPlayer', { tournamentId: tn.id, player: name, data: { colors: colors.join('') } }); s.close(); toast(t('colors_saved')); await load(); }
    catch (x) { busy(save, false); err = scriptError(x); s.refresh(); }
  });
}

/* ------------------------------------------------------------------ new tournament */
const SET_TYPES = new Set(['core', 'expansion', 'masters', 'draft_innovation', 'funny', 'starter', 'remastered']);
async function loadSets() {
  const c = store.get('sets', null);
  if (c && c.list && Date.now() - c.at < 7 * 864e5) return c.list;
  const res = await fetch('https://api.scryfall.com/sets', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('scryfall ' + res.status);
  const j = await res.json();
  const list = (j.data || []).filter((x) => !x.digital && SET_TYPES.has(x.set_type))
    .map((x) => ({ code: String(x.code).toUpperCase(), name: x.name, icon: x.icon_svg_uri, date: x.released_at || '' }))
    .sort((a, b) => b.date.localeCompare(a.date));
  store.set('sets', { at: Date.now(), list });
  return list;
}

function openTournamentForm() {
  if (!state.data) { toast(t('load_first'), true); return; }
  const today = isoDate(new Date());
  const f = { name: '', date: today, set: null, setText: '', q: '', players: [], newName: '', minutes: SEALED_DEFAULT_MINUTES, err: '' };
  let sets = null, setsErr = false;
  loadSets().then((l) => { sets = l; s.refresh(); }).catch(() => { setsErr = true; s.refresh(); });
  const known = () => [...new Set([...realPlayers().map((p) => p.name), ...f.players])];
  const deDate = (iso) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };
  const autoName = () => `${(f.set && f.set.name) || f.setText || 'Sealed'} · ${deDate(f.date)}`;
  const s = openSheet({
    title: () => t('new_tournament'),
    foot: `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" data-save>${t('create_tournament')}</button>`,
    render: () => {
      const q = norm(f.q);
      const hits = sets && q ? sets.filter((x) => norm(x.name).includes(q) || norm(x.code) === q).slice(0, 8) : sets ? sets.slice(0, 6) : [];
      return `
      <div class="field"><span class="label">${t('t_set')}</span>
        ${f.set ? `<div class="set-chosen"><span class="set-icon"><img src="${esc(f.set.icon)}" alt=""></span><div class="grow"><b>${esc(f.set.name)}</b><div class="small faint">${esc(f.set.code)} · ${esc(f.set.date.slice(0, 4))}</div></div><button type="button" class="link-btn" data-unset>${t('change')}</button></div>`
          : setsErr ? `<input class="input" data-f="setText" value="${esc(f.setText)}" placeholder="${t('t_set')}"><p class="hint" style="margin:6px 0 0">${t('set_offline')}</p>`
          : `<input class="input" type="search" data-f="q" value="${esc(f.q)}" placeholder="${t('set_search_ph')}" autocomplete="off">
             <div class="set-list">${!sets ? `<p class="small faint">${t('sets_loading')}</p>` : hits.map((x) => `<button type="button" class="set-hit" data-set="${esc(x.code)}"><span class="set-icon"><img src="${esc(x.icon)}" alt="" loading="lazy"></span><span class="grow">${esc(x.name)}</span><span class="small faint">${esc(x.code)} · ${esc(x.date.slice(0, 4))}</span></button>`).join('') || `<p class="small faint">${t('nothing_matches')}</p>`}</div>`}
      </div>
      <div class="date-draws">
        <label class="field"><span class="label">${t('t_name')}</span><input class="input" data-f="name" value="${esc(f.name)}" placeholder="${esc(autoName())}"></label>
        <label class="field"><span class="label">${t('round_minutes')}</span><input class="input" style="width:86px" type="number" inputmode="numeric" min="5" max="180" data-f="minutes" value="${f.minutes}"></label>
      </div>
      <div class="field"><span class="label">${t('date')}</span>
        <div class="date-field"><span class="input date-display">${deDate(f.date)}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
          <input type="date" data-f="date" value="${f.date}" aria-label="${t('date')}"></div></div>
      <div class="field"><span class="label"><span>${t('t_players')}</span><span class="faint" style="font-weight:500">${t('selected_n', { n: f.players.length })}</span></span>
        <div class="chips wrap">${known().map((n) => `<button type="button" class="chip${f.players.includes(n) ? ' on' : ''}" data-pl="${esc(n)}">${esc(n)}</button>`).join('')}</div>
        <div class="row" style="margin-top:8px"><input class="input grow" data-f="newName" value="${esc(f.newName)}" placeholder="${t('add_player_ph')}" autocomplete="off"><button type="button" class="btn" data-addpl>${t('add')}</button></div>
        ${f.players.length >= 2 ? `<p class="hint" style="margin:8px 0 0">${t('rec_rounds', { p: f.players.length, r: recommendedRounds(f.players.length) })}</p>` : ''}
      </div>
      ${f.err ? `<p class="err-text">${esc(f.err)}</p>` : ''}
      ${sets ? `<p class="legend-note">${t('set_source')}</p>` : ''}`;
    },
  });
  s.el.addEventListener('input', (e) => {
    const k = e.target.dataset.f;
    if (k === 'q') { f.q = e.target.value; const pos = e.target.selectionStart; s.refresh(); const el = s.el.querySelector('[data-f="q"]'); if (el) { el.focus(); el.setSelectionRange(pos, pos); } }
    else if (k === 'name' || k === 'newName' || k === 'setText') f[k] = e.target.value;
  });
  s.el.addEventListener('change', (e) => {
    const k = e.target.dataset.f;
    if (k === 'date' && e.target.value) { f.date = e.target.value; s.refresh(); }
    if (k === 'minutes') f.minutes = Math.max(5, Math.min(180, parseInt(e.target.value, 10) || SEALED_DEFAULT_MINUTES));
    if (k === 'setText') { const nm = s.el.querySelector('[data-f="name"]'); if (nm) nm.placeholder = autoName(); } // no redraw: it would swallow the next tap
  });
  const addNew = () => {
    const n = f.newName.trim();
    if (!n) return;
    const existing = known().find((x) => norm(x) === norm(n));
    const name = existing || n;
    if (!f.players.includes(name)) f.players.push(name);
    f.newName = ''; s.refresh();
  };
  s.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset.f === 'newName') { e.preventDefault(); addNew(); } });
  s.el.addEventListener('click', async (e) => {
    const di = e.target.closest('.date-field input');
    if (di && di.showPicker && window.matchMedia('(pointer: fine)').matches) { try { di.showPicker(); } catch (x) { /* ignore */ } return; }
    const sb = e.target.closest('[data-set]');
    if (sb) { f.set = sets.find((x) => x.code === sb.dataset.set) || null; s.refresh(); return; }
    if (e.target.closest('[data-unset]')) { f.set = null; s.refresh(); return; }
    const pl = e.target.closest('[data-pl]');
    if (pl) { const n = pl.dataset.pl; f.players = f.players.includes(n) ? f.players.filter((x) => x !== n) : [...f.players, n]; s.refresh(); return; }
    if (e.target.closest('[data-addpl]')) { addNew(); return; }
    const save = e.target.closest('[data-save]');
    if (!save) return;
    f.err = '';
    if (f.players.length < 2) f.err = t('e_two_players');
    if (f.err) { s.refresh(); s.body.scrollTop = s.body.scrollHeight; return; }
    busy(save, true, t('saving'));
    try {
      const existing = new Set(realPlayers().map((p) => norm(p.name)));
      for (const n of f.players) if (!existing.has(norm(n))) await callScript('addPlayer', { name: n });
      const out = await callScript('addTournament', {
        data: {
          name: f.name.trim() || autoName(), date: f.date, roundMinutes: f.minutes, status: 'running',
          setCode: f.set ? f.set.code : '', setName: f.set ? f.set.name : f.setText.trim(), setIcon: f.set ? f.set.icon : '',
        },
        players: f.players.map((n) => ({ player: n, colors: '' })),
      });
      s.close(); toast(t('tournament_created'));
      location.hash = '#/sealed/t/' + encodeURIComponent(out.id);
      await load();
    } catch (err) { busy(save, false); f.err = scriptError(err); s.refresh(); s.body.scrollTop = s.body.scrollHeight; }
  });
}
