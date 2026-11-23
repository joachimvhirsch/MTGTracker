/* MTG Tracker — Multiplayer mode: single games with 2+ players (no matches).
 * Loaded before app.js; everything here runs only when app.js calls it.
 * Sheet tabs (created by Code.gs): Games(id,date,winner,draw,notes), GamePlayers(gameId,seat,player,deck,mulligans).
 */
'use strict';

const MULTI_VIEWS = {
  stats: () => viewMultiStats(),
  table: () => viewMultiTable(),
  games: () => viewMultiGames(),
  deck: (id) => viewMultiDeck(id),
};

/* ------------------------------------------------------------------ model */
function buildMulti(raw, model) {
  const G = table(raw.games || [[]]), GP = table(raw.gplayers || [[]]);
  const deckByName = new Map(model.decks.map((d) => [norm(d.name), d]));
  const ghosts = new Map();
  const deckOf = (name) => {
    if (!name) return null;
    const d = deckByName.get(norm(name)) || model.deckById.get(name);
    if (d) return d;
    if (!ghosts.has(norm(name))) ghosts.set(norm(name), { id: '?' + name, name, colors: [], tags: [], active: false, playerIds: [], ghost: true });
    return ghosts.get(norm(name));
  };
  const games = G.items.filter((g) => g.id).map((g) => ({
    id: g.id, date: parseDate(g.date), dateRaw: g.date || '', winner: g.winner || '', draw: truthy(g.draw), notes: g.notes || '', seats: [],
  }));
  const byId = new Map(games.map((g) => [g.id, g]));
  GP.items.forEach((p) => {
    const g = byId.get(p.gameid);
    if (!g || !p.player) return;
    const n = parseInt(p.mulligans, 10);
    g.seats.push({ seat: parseInt(p.seat, 10) || 0, player: p.player, deck: deckOf(p.deck), mull: isNaN(n) ? null : n });
  });
  games.forEach((g) => g.seats.sort((a, b) => a.seat - b.seat));
  games.sort((a, b) => ((b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0)) || String(b.id).localeCompare(String(a.id)));
  return { games, byId };
}
/** One entry per player per game, with the result from that player's view. */
function gameSides(games) {
  const out = [];
  for (const g of games) for (const s of g.seats) {
    out.push({ g, player: s.player, deck: s.deck, mull: s.mull, n: g.seats.length,
      r: g.draw ? 'D' : norm(g.winner) === norm(s.player) ? 'W' : 'L' });
  }
  return out;
}
const mRec = () => ({ m: 0, w: 0, l: 0, d: 0, mullN: 0, mullSum: 0 });
function mAdd(rec, s) {
  rec.m++; rec[s.r === 'W' ? 'w' : s.r === 'L' ? 'l' : 'd']++;
  if (s.mull != null) { rec.mullN++; rec.mullSum += s.mull; }
  return rec;
}
const mWr = (r) => (r.m ? r.w / r.m : null);
const mAvgMull = (r) => (r.mullN ? r.mullSum / r.mullN : null);
const fmtOne = (x) => (x == null ? '–' : x.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
function multiUi() {
  if (!state.ui.multi) state.ui.multi = {};
  const u = state.ui.multi;
  const d = { period: 'all', colorMetric: 'played', tagMetric: 'played', tPeriod: 'all', showInactive: false, q: '', colors: [], sort: 'wr', dir: -1, gDeck: '', gPlayer: '' };
  Object.keys(d).forEach((k) => { if (u[k] === undefined) u[k] = d[k]; });
  return u;
}

/* ------------------------------------------------------------------ view: statistics */
function viewMultiStats() {
  const M = state.data.multi, ui = multiUi();
  const games = filterPeriod(M.games, ui.period);
  const sides = gameSides(games);
  const decksPlayed = new Set(sides.filter((s) => s.deck).map((s) => s.deck.id)).size;
  const players = new Set(sides.map((s) => s.player));
  const last = M.games[0];
  const kpis = `<div class="kpis">
    <div class="kpi"><div class="k-label">${t('kpi_games_mp')}</div><div class="k-value num">${games.length}</div><div class="k-sub">${t('draws_n_mp', games.filter((g) => g.draw).length)}</div></div>
    <div class="kpi"><div class="k-label">${t('kpi_decks_played')}</div><div class="k-value num">${decksPlayed}</div><div class="k-sub">${t('active_of', { a: state.data.decks.filter((x) => x.active).length, b: state.data.decks.length })}</div></div>
    <div class="kpi"><div class="k-label">${t('kpi_players')}</div><div class="k-value num">${players.size}</div><div class="k-sub">${games.length ? t('avg_table', { n: fmtOne(sides.length / games.length) }) : '&nbsp;'}</div></div>
    <div class="kpi"><div class="k-label">${t('kpi_last_game')}</div><div class="k-value" style="font-size:18px;padding-top:5px">${last && last.date ? fmtDate(last.date, { day: 'numeric', month: 'short' }) : '—'}</div><div class="k-sub">${last && last.date ? last.date.getFullYear() : ''}</div></div>
  </div>`;

  const pRec = new Map();
  sides.forEach((s) => { if (!pRec.has(s.player)) pRec.set(s.player, mRec()); mAdd(pRec.get(s.player), s); });
  const pRows = [...pRec.entries()].sort((a, b) => (mWr(b[1]) - mWr(a[1])) || b[1].m - a[1].m).map(([n, r]) => ({
    label: n, value: mWr(r), valueHtml: `${pct(mWr(r))}<small>${t('wins_of', { w: r.w, g: r.m })}</small>`, title: `${n}: ${recStr(r)}`,
  }));

  const cStat = {}; [...COLORS, 'C'].forEach((c) => { cStat[c] = { n: 0, rec: mRec() }; });
  const withDeck = sides.filter((s) => s.deck && !s.deck.ghost);
  withDeck.forEach((s) => (s.deck.colors.length ? s.deck.colors : ['C']).forEach((c) => { cStat[c].n++; mAdd(cStat[c].rec, s); }));
  const cPlayed = ui.colorMetric === 'played';
  const cRows = [...COLORS, 'C'].filter((c) => c !== 'C' || cStat.C.n).map((c) => ({
    label: cn(c), icon: pip(c), color: `var(--mana-${c})`, ringed: true,
    value: cPlayed ? cStat[c].n : mWr(cStat[c].rec),
    valueHtml: cPlayed ? `${cStat[c].n}<small>${pct(withDeck.length ? cStat[c].n / withDeck.length : null)}</small>` : `${pct(mWr(cStat[c].rec))}<small>${t('wins_of', { w: cStat[c].rec.w, g: cStat[c].rec.m })}</small>`,
  }));

  const tStat = new Map();
  withDeck.forEach((s) => (s.deck.tags.length ? s.deck.tags.map((x) => x.toLowerCase()) : [t('untagged')]).forEach((tg) => {
    if (!tStat.has(tg)) tStat.set(tg, { n: 0, rec: mRec() }); const st = tStat.get(tg); st.n++; mAdd(st.rec, s);
  }));
  const tPlayed = ui.tagMetric === 'played';
  const tRows = [...tStat.entries()].sort((a, b) => (tPlayed ? b[1].n - a[1].n : (mWr(b[1].rec) - mWr(a[1].rec)) || b[1].n - a[1].n)).map(([tg, st]) => ({
    label: tg, value: tPlayed ? st.n : mWr(st.rec),
    valueHtml: tPlayed ? `${st.n}<small>${pct(withDeck.length ? st.n / withDeck.length : null)}</small>` : `${pct(mWr(st.rec))}<small>${t('wins_of', { w: st.rec.w, g: st.rec.m })}</small>`,
  }));

  return `<div class="filters">${segmented('multi.period', ui.period, [['all', t('period_all')], ['year', t('period_year')], ['90', t('period_90')], ['30', t('period_30')]])}</div>
    ${kpis}
    <section class="card"><h2>${t('player_wr_title')}</h2><p class="card-sub">${t('mp_player_wr_sub')}</p>${hbars(pRows, { max: 1, big: true })}</section>
    <section class="card">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div><h2>${t('colors_title')}</h2><p class="card-sub">${cPlayed ? t('mp_colors_sub_played') : t('mp_wr_sub')}</p></div>
        ${segmented('multi.colorMetric', ui.colorMetric, [['played', t('played')], ['wr', t('win_pct')]])}
      </div>
      ${hbars(cRows, cPlayed ? {} : { max: 1 })}
      <div class="legend-note">${t('colors_note')}</div>
    </section>
    <section class="card">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div><h2>${t('types_title')}</h2><p class="card-sub">${tPlayed ? t('mp_types_sub_played') : t('mp_wr_sub')}</p></div>
        ${segmented('multi.tagMetric', ui.tagMetric, [['played', t('played')], ['wr', t('win_pct')]])}
      </div>
      ${hbars(tRows, tPlayed ? {} : { max: 1 })}
    </section>
    ${M.games.length ? '' : `<div class="empty"><h2>${t('no_games_mp')}</h2><p>${t('no_games_mp_sub')}</p></div>`}`;
}

/* ------------------------------------------------------------------ view: deck table */
function viewMultiTable() {
  const d = state.data, ui = multiUi();
  const recs = new Map();
  gameSides(filterPeriod(d.multi.games, ui.tPeriod)).forEach((s) => {
    if (!s.deck) return;
    if (!recs.has(s.deck.id)) recs.set(s.deck.id, mRec());
    mAdd(recs.get(s.deck.id), s);
  });
  const q = norm(ui.q);
  const rows = d.decks
    .filter((x) => (ui.showInactive || x.active) && deckMatchesFilters(x, { colors: ui.colors }) && (!q || norm(x.name).includes(q) || x.tags.some((tg) => norm(tg).includes(q))))
    .map((deck) => ({ deck, rec: recs.get(deck.id) || mRec(), pn: playerNames(deck) }));
  const byWr = (a, b) => ((mWr(b.rec) ?? -1) - (mWr(a.rec) ?? -1)) || (b.rec.m - a.rec.m) || a.deck.name.localeCompare(b.deck.name);
  const cmp = {
    wr: byWr, games: (a, b) => (b.rec.m - a.rec.m) || byWr(a, b), player: (a, b) => a.pn.localeCompare(b.pn) || byWr(a, b),
    mull: (a, b) => ((mAvgMull(b.rec) ?? -1) - (mAvgMull(a.rec) ?? -1)) || byWr(a, b),
  }[ui.sort] || byWr;
  rows.sort((a, b) => cmp(a, b) * (ui.dir === -1 ? 1 : -1));
  const nFilters = ui.colors.length + (q ? 1 : 0);
  const arrow = (ui.sort === 'player') === (ui.dir === -1) ? '↑' : '↓';
  const th = (key, label) => `<button data-msort="${key}" class="${ui.sort === key ? 'on' : ''}" aria-label="${esc(t('sort_by', { x: label }))}">${label}<span class="sort-ind">${ui.sort === key ? arrow : '↕'}</span></button>`;
  return `<div class="filters">
      ${segmented('multi.tPeriod', ui.tPeriod, [['all', t('period_all')], ['year', t('period_year')], ['90', t('period_90')], ['30', t('period_30')]])}
      <label class="switch"><span>${t('show_inactive')}</span><input type="checkbox" data-model="multi.showInactive" ${ui.showInactive ? 'checked' : ''}></label>
      <input class="input" type="search" placeholder="${t('search_ph')}" data-model="multi.q" value="${esc(ui.q)}">
      <div class="chips">${colorChips('multi.colors', ui.colors, true)}</div>
    </div>
    <div class="toolbar"><span class="count">${ui.showInactive ? t('decks_n', rows.length) : t('active_decks_n', rows.length)}${nFilters ? ` · <button class="link-btn" data-act="g-clear-table">${t('clear_filters')}</button>` : ''}</span><span class="count">${t('tap_sort')}</span></div>
    ${rows.length ? `<div class="card league-card"><table class="league">
      <thead><tr><th>#</th><th>${t('col_deck')}</th><th class="pl">${th('player', t('col_player'))}</th><th class="mu">${th('mull', t('col_mull'))}</th><th>${th('games', t('col_g'))}</th><th>${th('wr', t('col_win'))}</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="tap${r.deck.active ? '' : ' inactive-row'}" data-href="#/multi/deck/${encodeURIComponent(r.deck.id)}">
        <td class="num">${i + 1}</td>
        <td class="deck-cell"><span class="name">${esc(r.deck.name)}</span><span class="meta">${pips(r.deck.colors)}${r.deck.active ? '' : `<span class="badge inactive">${t('inactive')}</span>`}</span></td>
        <td class="pl">${esc(r.pn)}</td>
        <td class="num mu${mAvgMull(r.rec) == null ? ' na' : ''}">${fmtOne(mAvgMull(r.rec))}</td>
        <td class="num"><span style="font-weight:600">${r.rec.m}</span><span class="rec">${r.rec.m ? t('wins_short', { w: r.rec.w }) : ''}</span></td>
        <td class="num"><span class="wr">${pct(mWr(r.rec))}</span><span class="wr-bar"><i style="width:${(mWr(r.rec) || 0) * 100}%"></i></span></td>
      </tr>`).join('')}</tbody></table></div>` : `<div class="empty"><h2>${t('no_decks')}</h2><p>${t(ui.showInactive ? 'nothing_matches' : 'no_active_match')}</p></div>`}
    <button class="fab fab-left" data-act="new-deck" aria-label="${t('new_deck')}" title="${t('new_deck')}">${ICON.deck}</button>`;
}

/* ------------------------------------------------------------------ games list */
function gameCard(g, editable) {
  const winnerKnown = !g.draw && g.winner;
  return `<div class="game${editable ? ' tap' : ''}" ${editable ? `data-act="g-edit" data-id="${esc(g.id)}" role="button" tabindex="0"` : ''}>
    ${g.seats.map((s) => {
      const won = winnerKnown && norm(g.winner) === norm(s.player);
      return `<div class="gseat${won ? ' won' : ''}">
        <span class="gp">${won ? TAB_ICONS.trophy : ''}${esc(s.player)}</span>
        <span class="gd">${s.deck ? `${s.deck.ghost ? `<span>${esc(s.deck.name)}</span>` : `<a href="#/multi/deck/${encodeURIComponent(s.deck.id)}">${esc(s.deck.name)}</a>`} ${pips(s.deck.colors)}` : '<span class="faint">—</span>'}</span>
        <span class="gm" title="${t('mulligans')}">${s.mull != null ? `${s.mull}<small>M</small>` : ''}</span>
      </div>`;
    }).join('')}
    ${g.draw ? `<div class="gnote"><span class="badge inactive">${t('draw_game')}</span></div>` : ''}
    ${g.notes ? `<div class="gnote">${esc(g.notes)}</div>` : ''}
  </div>`;
}
function gameList(games, editable) {
  if (!games.length) return `<div class="empty"><h2>${t('no_games_mp')}</h2><p>${t('nothing_matches')}</p></div>`;
  let html = ''; let lastKey = null; let open = false;
  for (const g of games) {
    const key = g.date ? isoDate(g.date) : g.dateRaw || '—';
    if (key !== lastKey) {
      if (open) html += '</div>';
      html += `<div class="date-head">${g.date ? fmtDate(g.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : esc(g.dateRaw || t('no_date'))}</div><div class="list">`;
      open = true; lastKey = key;
    }
    html += gameCard(g, editable);
  }
  return html + (open ? '</div>' : '');
}
function viewMultiGames() {
  const d = state.data, ui = multiUi();
  let games = d.multi.games;
  if (ui.gDeck) games = games.filter((g) => g.seats.some((s) => s.deck && s.deck.id === ui.gDeck));
  if (ui.gPlayer) games = games.filter((g) => g.seats.some((s) => norm(s.player) === norm(ui.gPlayer)));
  const byName = (a, b) => a.name.localeCompare(b.name);
  const act = d.decks.filter((x) => x.active).sort(byName), inact = d.decks.filter((x) => !x.active).sort(byName);
  const opt = (x) => `<option value="${esc(x.id)}"${x.id === ui.gDeck ? ' selected' : ''}>${esc(x.name)}</option>`;
  const names = [...new Set([...realPlayers().map((p) => p.name), ...d.multi.games.flatMap((g) => g.seats.map((s) => s.player))])].sort();
  let summary = '';
  if (ui.gDeck || ui.gPlayer) {
    const r = gameSides(games).filter((s) => (ui.gDeck ? s.deck && s.deck.id === ui.gDeck : true) && (ui.gPlayer ? norm(s.player) === norm(ui.gPlayer) : true)).reduce(mAdd, mRec());
    summary = ` · ${t('wins_of', { w: r.w, g: r.m })} (${pct(mWr(r))})`;
  }
  return `<div class="filters">
      <select class="select" data-model="multi.gDeck"><option value="">${t('all_decks')}</option>
        <optgroup label="${t('active')}">${act.map(opt).join('')}</optgroup>
        ${inact.length ? `<optgroup label="${t('inactive')}">${inact.map(opt).join('')}</optgroup>` : ''}
      </select>
      <div class="row"><div class="grow"><select class="select sm" data-model="multi.gPlayer"><option value="">${t('all_players')}</option>${names.map((n) => `<option value="${esc(n)}"${n === ui.gPlayer ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
        ${ui.gDeck || ui.gPlayer ? `<button class="link-btn" data-act="g-clear-games">${t('clear')}</button>` : ''}</div>
    </div>
    <div class="toolbar"><span class="count">${t('games_n_mp', games.length)}${summary}</span><span class="count">${t('tap_game_edit')}</span></div>
    ${d.multi.games.length ? gameList(games, true) : `<div class="empty"><h2>${t('no_games_mp')}</h2><p>${t('no_games_mp_sub')}</p></div>`}`;
}

/* ------------------------------------------------------------------ view: deck (multiplayer stats) */
function viewMultiDeck(id) {
  const d = state.data;
  const deck = d.deckById.get(id);
  if (!deck || deck.ghost) return `<div class="empty"><h2>${t('deck_not_found')}</h2><p><a href="#/multi/table">${t('back_to_decks')}</a></p></div>`;
  const ss = gameSides(d.multi.games).filter((s) => s.deck && s.deck.id === deck.id);
  const rec = ss.reduce(mAdd, mRec());
  const bySize = new Map();
  ss.forEach((s) => { if (!bySize.has(s.n)) bySize.set(s.n, mRec()); mAdd(bySize.get(s.n), s); });
  const sizeRows = [...bySize.entries()].sort((a, b) => a[0] - b[0]).map(([n, r]) => ({
    label: t('n_players', { n }), value: mWr(r), valueHtml: `${pct(mWr(r))}<small>${t('wins_of', { w: r.w, g: r.m })}</small>`,
  }));
  const byPilot = new Map();
  ss.forEach((s) => { if (!byPilot.has(s.player)) byPilot.set(s.player, mRec()); mAdd(byPilot.get(s.player), s); });
  const pilotRows = [...byPilot.entries()].map(([n, r]) => ({ label: n, value: mWr(r), valueHtml: `${pct(mWr(r))}<small>${t('wins_of', { w: r.w, g: r.m })}</small>` }));
  const lastG = ss[0] && ss[0].g;
  return `<button class="link-btn back-link" data-act="back">${t('back')}</button>
    <div class="deck-hero">
      <div class="row" style="justify-content:space-between">${pips(deck.colors, true)}
        <button class="btn sm" data-act="edit-deck" data-id="${esc(deck.id)}">${ICON.edit}${t('edit')}</button></div>
      <h2>${esc(deck.name)}</h2>
      <div class="meta"><span class="badge ${deck.active ? 'active' : 'inactive'}">${deck.active ? t('active') : t('inactive')}</span><span>${esc(playerNames(deck))}</span>${deck.tags.map((tg) => `<span class="tag">${esc(tg)}</span>`).join('')}</div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="k-label">${t('kpi_winrate')}</div><div class="k-value num">${pct(mWr(rec))}</div><div class="k-sub">${t('wins_of', { w: rec.w, g: rec.m })}</div></div>
      <div class="kpi"><div class="k-label">${t('kpi_games_mp')}</div><div class="k-value num">${rec.m}</div><div class="k-sub">${t('draws_n_mp', rec.d)}</div></div>
      <div class="kpi"><div class="k-label">${t('mulligans')}</div><div class="k-value num">${fmtOne(mAvgMull(rec))}</div><div class="k-sub">${t('per_game')}</div></div>
      <div class="kpi"><div class="k-label">${t('kpi_last_played')}</div><div class="k-value" style="font-size:18px;padding-top:5px">${lastG && lastG.date ? fmtDate(lastG.date, { day: 'numeric', month: 'short' }) : '—'}</div><div class="k-sub">${lastG && lastG.date ? lastG.date.getFullYear() : ''}</div></div>
    </div>
    ${ss.length ? `
    <section class="card"><h2>${t('by_table_size')}</h2><p class="card-sub">${t('mp_wr_sub')}</p>${hbars(sizeRows, { max: 1 })}</section>
    ${pilotRows.length > 1 ? `<section class="card"><h2>${t('by_pilot')}</h2><p class="card-sub">${t('mp_wr_sub')}</p>${hbars(pilotRows, { max: 1 })}</section>` : ''}
    <div class="section-title">${t('game_history')}</div>
    ${gameList(ss.map((s) => s.g), false)}` : `<div class="empty"><h2>${t('no_games_mp')}</h2><p>${t('no_games_deck_sub')}</p></div>`}`;
}

/* ------------------------------------------------------------------ actions */
async function multiAct(a, el) {
  const ui = multiUi();
  if (a === 'g-clear-table') { ui.colors = []; ui.q = ''; store.set('ui', state.ui); render(); }
  else if (a === 'g-clear-games') { ui.gDeck = ''; ui.gPlayer = ''; store.set('ui', state.ui); render(); }
  else if (a === 'g-edit') { const g = state.data.multi.byId.get(el.dataset.id); if (g) openGameForm(g); }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-msort]');
  if (!b) return;
  const ui = multiUi(), k = b.dataset.msort;
  ui.dir = ui.sort === k ? -ui.dir : -1; ui.sort = k;
  store.set('ui', state.ui); render();
});

/* ------------------------------------------------------------------ new / edit game */
function openGameForm(edit) {
  const d = state.data;
  if (!d) { toast(t('load_first'), true); return; }
  const ps = realPlayers();
  const nameToId = (n) => { const p = d.playerByRef.get(norm(n)); return p ? p.id : n; };
  const last = d.multi.games[0];
  const f = edit ? {
    date: edit.date ? isoDate(edit.date) : isoDate(new Date()),
    rows: edit.seats.map((s) => ({ player: nameToId(s.player), deck: s.deck && !s.deck.ghost ? s.deck.id : (s.deck ? s.deck.id : ''), mull: s.mull })),
    winner: edit.draw ? 'draw' : edit.winner ? nameToId(edit.winner) : '', notes: edit.notes || '', err: '', confirmDelete: false,
  } : {
    date: isoDate(new Date()),
    rows: (last ? last.seats.map((s) => nameToId(s.player)) : ps.slice(0, Math.max(2, Math.min(3, ps.length))).map((p) => p.id))
      .map((pid) => ({ player: pid, deck: '', mull: null })),
    winner: '', notes: '', err: '',
  };
  while (f.rows.length < 2) f.rows.push({ player: '', deck: '', mull: null });
  const players = edit ? [...ps, ...edit.seats.filter((s) => !d.playerByRef.get(norm(s.player))).map((s) => ({ id: s.player, name: s.player }))] : ps;
  const pName = (id) => { const p = d.playerByRef.get(norm(id)); return p ? p.name : id || '—'; };
  const byName = (a, b) => a.name.localeCompare(b.name);
  const deckOpts = (row) => {
    const pool = d.decks.filter((x) => edit || x.active);
    const cur = d.deckById.get(row.deck);
    if (cur && !pool.includes(cur)) pool.push(cur);
    const own = pool.filter((x) => x.playerIds.includes(row.player)).sort(byName);
    const others = pool.filter((x) => !x.playerIds.includes(row.player)).sort(byName);
    const o = (x) => `<option value="${esc(x.id)}"${x.id === row.deck ? ' selected' : ''}>${esc(x.name)} · ${x.colors.join('') || 'C'}${x.active ? '' : t('inactive_suffix')}</option>`;
    return `<option value="">${t('choose_deck')}</option>
      ${own.length ? `<optgroup label="${esc(pName(row.player))}">${own.map(o).join('')}</optgroup>` : ''}
      ${others.length ? `<optgroup label="${t('other_decks')}">${others.map(o).join('')}</optgroup>` : ''}`;
  };
  const clamp = (v) => Math.max(0, Math.min(9, Math.round(Number(v)) || 0));
  const stepMull = (v, dir) => (v == null ? (dir > 0 ? 1 : 0) : v === 0 && dir < 0 ? null : clamp(v + dir));
  const deDate = (iso) => { const [y, m, dd] = String(iso).split('-'); return dd && m && y ? `${dd}.${m}.${y}` : '—'; };
  const s = openSheet({
    title: edit ? t('edit_game') : t('new_game'),
    foot: edit
      ? `<button class="btn danger" data-delete>${t('delete')}</button><button class="btn primary" data-save>${t('save_changes')}</button>`
      : `<button class="btn" data-close>${t('cancel')}</button><button class="btn primary" data-save>${t('save_game')}</button>`,
    render: () => {
      const chosen = f.rows.map((r) => r.player).filter(Boolean);
      if (f.winner && f.winner !== 'draw' && !chosen.includes(f.winner)) f.winner = '';
      return `
      <div class="field"><span class="label">${t('date')}</span>
        <div class="date-field"><span class="input date-display">${deDate(f.date)}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
          <input type="date" data-f="date" value="${f.date}" max="${isoDate(new Date())}" aria-label="${t('date')}"></div></div>
      <div class="field"><span class="label">${t('t_players')}</span>
        ${f.rows.map((r, i) => `<div class="side-box gp-row">
          <div class="pd-row">
            <label class="field"><span class="label">${t('player_n', { n: i + 1 })}</span>
              <select class="select" data-row="${i}" data-k="player"><option value="">—</option>${players.map((p) => `<option value="${esc(p.id)}"${p.id === r.player ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
            <label class="field"><span class="label">${t('deck')}</span>
              <select class="select" data-row="${i}" data-k="deck">${deckOpts(r)}</select></label>
          </div>
          <div class="gp-bottom">
            <span class="small muted">${t('mulligans')}</span>
            <div class="mini-step"><button type="button" data-mstep="${i}" data-d="-1" aria-label="${t('mulligans')} −1">−</button><input type="number" inputmode="numeric" data-row="${i}" data-k="mull" value="${r.mull ?? ''}" placeholder="–" aria-label="${t('mulligans')}"><button type="button" data-mstep="${i}" data-d="1" aria-label="${t('mulligans')} +1">+</button></div>
            <span class="grow"></span>
            ${f.rows.length > 2 ? `<button type="button" class="link-btn danger-link" data-remove="${i}">${t('remove')}</button>` : ''}
          </div>
        </div>`).join('')}
        <button type="button" class="btn block add-row" data-addrow>${ICON.plus}${t('add_player_row')}</button>
      </div>
      <div class="field"><span class="label">${t('winner')}</span>
        <div class="chips wrap">${chosen.map((pid) => `<button type="button" class="chip${f.winner === pid ? ' on' : ''}" data-win="${esc(pid)}">${f.winner === pid ? TAB_ICONS.trophy : ''}${esc(pName(pid))}</button>`).join('')}
          <button type="button" class="chip${f.winner === 'draw' ? ' on' : ''}" data-win="draw">${t('draw_game')}</button></div>
      </div>
      <label class="field"><span class="label">${t('notes')} <span class="faint" style="font-weight:500">${t('optional')}</span></span><input class="input" data-f="notes" value="${esc(f.notes)}"></label>
      ${f.err ? `<p class="err-text">${esc(f.err)}</p>` : ''}`;
    },
  });
  s.el.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.f === 'date') { if (el.value) f.date = el.value; s.refresh(); return; }
    if (el.dataset.row == null) return;
    const r = f.rows[Number(el.dataset.row)], k = el.dataset.k;
    if (k === 'mull') r.mull = el.value === '' ? null : clamp(el.value);
    else r[k] = el.value;
    s.refresh();
  });
  s.el.addEventListener('input', (e) => { if (e.target.dataset.f === 'notes') f.notes = e.target.value; });
  s.el.addEventListener('click', async (e) => {
    if (f.confirmDelete && !e.target.closest('[data-delete]')) {
      f.confirmDelete = false;
      const db = s.el.querySelector('[data-delete]'); if (db) { db.textContent = t('delete'); db.classList.remove('confirm'); }
    }
    const di = e.target.closest('.date-field input');
    if (di && di.showPicker && window.matchMedia('(pointer: fine)').matches) { try { di.showPicker(); } catch (x) { /* ignore */ } return; }
    const ms = e.target.closest('[data-mstep]');
    if (ms) { const r = f.rows[Number(ms.dataset.mstep)]; r.mull = stepMull(r.mull, Number(ms.dataset.d)); s.refresh(); return; }
    const rm = e.target.closest('[data-remove]');
    if (rm) { f.rows.splice(Number(rm.dataset.remove), 1); s.refresh(); return; }
    if (e.target.closest('[data-addrow]')) {
      const used = new Set(f.rows.map((r) => r.player));
      const next = ps.find((p) => !used.has(p.id));
      f.rows.push({ player: next ? next.id : '', deck: '', mull: null }); s.refresh();
      s.body.scrollTop = s.body.scrollHeight; return;
    }
    const w = e.target.closest('[data-win]');
    if (w) { f.winner = w.dataset.win; f.err = ''; s.refresh(); return; }
    const del = e.target.closest('[data-delete]');
    if (del && edit) {
      if (!f.confirmDelete) { f.confirmDelete = true; del.textContent = t('confirm_delete'); del.classList.add('confirm'); return; }
      busy(del, true, t('deleting'));
      try { await callScript('deleteGame', { id: edit.id }); s.close(); toast(t('game_deleted')); await load(); }
      catch (err) { busy(del, false); f.confirmDelete = false; del.textContent = t('delete'); del.classList.remove('confirm'); f.err = scriptError(err); s.refresh(); }
      return;
    }
    const save = e.target.closest('[data-save]');
    if (!save) return;
    const ids = f.rows.map((r) => r.player);
    f.err = '';
    if (!f.date) f.err = t('e_date');
    else if (f.rows.length < 2) f.err = t('e_two_players');
    else if (ids.some((x) => !x)) f.err = t('e_all_players');
    else if (new Set(ids).size !== ids.length) f.err = t('e_players_unique');
    else if (f.rows.some((r) => !r.deck)) f.err = t('e_all_decks');
    else if (!f.winner) f.err = t('e_winner');
    if (f.err) { s.refresh(); s.body.scrollTop = s.body.scrollHeight; return; }
    busy(save, true, t('saving'));
    try {
      const deckName = (id) => { const x = d.deckById.get(id); return x ? x.name : String(id).replace(/^\?/, ''); };
      const payload = {
        data: { date: f.date, winner: f.winner === 'draw' ? '' : pName(f.winner), draw: f.winner === 'draw', notes: f.notes.trim() },
        players: f.rows.map((r) => ({ player: pName(r.player), deck: deckName(r.deck), mulligans: r.mull == null ? '' : r.mull })),
      };
      if (edit) await callScript('updateGame', { id: edit.id, ...payload });
      else await callScript('addGame', payload);
      s.close(); toast(edit ? t('game_updated') : t('game_saved')); await load();
    } catch (err) { busy(save, false); f.err = scriptError(err); s.refresh(); s.body.scrollTop = s.body.scrollHeight; }
  });
}
