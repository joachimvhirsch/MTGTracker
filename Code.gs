/**
 * MTG League — write bridge for the Google Sheet.
 *
 * Setup (once, by the sheet owner):
 *   1. In the sheet: Extensions → Apps Script. Replace everything in Code.gs with this file. Save.
 *   2. Deploy → New deployment → type "Web app".
 *        Execute as:      Me
 *        Who has access:  Anyone
 *      Deploy, approve the permissions, copy the Web app URL (ends in /exec).
 *   3. In the MTG League app: Settings → Write access → paste the URL → Connect.
 *      (The app stores the URL in a "Config" tab so everyone else gets it automatically.)
 *
 * After changing this code later, use Deploy → Manage deployments → Edit → Version: New version,
 * so the URL stays the same.
 */

var TABS = { players: 'Players', decks: 'Decks', matches: 'Matches', config: 'Config' };
var VERSION = 1;

function doGet() {
  return json_({ ok: true, app: 'mtg-league', version: VERSION, message: 'MTG League write bridge is running. Paste this page\'s URL into the app under Settings → Write access.' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var req = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var out;
    switch (req.action) {
      case 'ping': out = { title: ss.getName(), version: VERSION }; break;
      case 'addMatch': out = addRow_(ss, TABS.matches, req.data || {}, 'm', 4); break;
      case 'addDeck': out = addRow_(ss, TABS.decks, req.data || {}, 'd', 2); break;
      case 'updateDeck': out = updateDeck_(ss, req.id, req.data || {}); break;
      case 'setConfig': out = setConfig_(ss, req.key, req.value); break;
      default: throw new Error('Unknown action: ' + req.action);
    }
    out.ok = true;
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) { /* ignore */ }
  }
}

/* ------------------------------------------------------------------ helpers */
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function tab_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Tab "' + name + '" not found in the sheet.');
  return sh;
}
function headers_(sh) {
  if (sh.getLastColumn() < 1) throw new Error('Tab "' + sh.getName() + '" has no header row.');
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
}
function norm_(s) { return String(s == null ? '' : s).trim().toLowerCase(); }

/** Last row (1-based) that has something in any of the given columns; 1 = only header. */
function lastDataRow_(sh, cols) {
  var n = sh.getLastRow();
  if (n < 2) return 1;
  var vals = sh.getRange(2, 1, n - 1, sh.getLastColumn()).getDisplayValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    for (var j = 0; j < cols.length; j++) if (cols[j] >= 0 && String(vals[i][cols[j]]).trim() !== '') return i + 2;
  }
  return 1;
}

function nextId_(sh, h, prefix, width) {
  var col = h.indexOf('id');
  var n = sh.getLastRow() - 1;
  var max = 0;
  if (col >= 0 && n > 0) {
    sh.getRange(2, col + 1, n, 1).getDisplayValues().forEach(function (r) {
      var m = String(r[0]).match(/^([A-Za-z_-]*)(\d+)$/);
      if (m) { prefix = m[1]; width = Math.max(width, m[2].length); max = Math.max(max, Number(m[2])); }
    });
  }
  var num = String(max + 1);
  while (num.length < width) num = '0' + num;
  return prefix + num;
}

/** Writes an ISO date (yyyy-mm-dd) in the same style as the cell above: real date or text. */
function writeDate_(sh, row, col, iso) {
  var p = String(iso).split('-');
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  var cell = sh.getRange(row, col);
  if (row > 2) {
    var prev = sh.getRange(row - 1, col);
    var pv = prev.getValue();
    if (pv instanceof Date) { cell.setValue(d).setNumberFormat(prev.getNumberFormat()); return; }
    var disp = prev.getDisplayValue();
    var text = null;
    if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(disp)) text = p[2] + '.' + p[1] + '.' + p[0];
    else if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(disp)) text = iso;
    else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(disp)) text = Number(p[1]) + '/' + Number(p[2]) + '/' + p[0];
    if (text) { cell.setNumberFormat('@').setValue(text); return; }
  }
  cell.setValue(d).setNumberFormat('dd.MM.yyyy');
}

function writeCells_(sh, h, row, data) {
  Object.keys(data).forEach(function (key) {
    var col = h.indexOf(String(key).toLowerCase());
    if (col < 0) return; // unknown column — ignore
    var v = data[key];
    if (String(key).toLowerCase() === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) { writeDate_(sh, row, col + 1, v); return; }
    sh.getRange(row, col + 1).setValue(v == null ? '' : v);
  });
}

/* ------------------------------------------------------------------ actions */
function addRow_(ss, tabName, data, prefix, width) {
  var sh = tab_(ss, tabName);
  var h = headers_(sh);
  var lower = {};
  Object.keys(data).forEach(function (k) { lower[k.toLowerCase()] = data[k]; });
  if (!lower.id) lower.id = nextId_(sh, h, prefix, width);
  var keyCols = ['id', 'name', 'playera', 'date'].map(function (k) { return h.indexOf(k); });
  var row = lastDataRow_(sh, keyCols) + 1;
  writeCells_(sh, h, row, lower);
  return { id: lower.id, row: row };
}

function updateDeck_(ss, id, data) {
  if (!id) throw new Error('Missing deck id.');
  var sh = tab_(ss, TABS.decks);
  var h = headers_(sh);
  var idCol = h.indexOf('id'), nameCol = h.indexOf('name');
  var n = sh.getLastRow() - 1;
  var ids = n > 0 ? sh.getRange(2, idCol + 1, n, 1).getDisplayValues() : [];
  var row = -1;
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === String(id)) { row = i + 2; break; }
  if (row < 0) throw new Error('Deck "' + id + '" not found.');
  var oldName = nameCol >= 0 ? sh.getRange(row, nameCol + 1).getDisplayValue() : '';
  var lower = {};
  Object.keys(data).forEach(function (k) { if (k.toLowerCase() !== 'id') lower[k.toLowerCase()] = data[k]; });
  writeCells_(sh, h, row, lower);

  var renamed = 0;
  if (lower.name != null && oldName && norm_(lower.name) !== norm_(oldName)) {
    var ms = ss.getSheetByName(TABS.matches);
    if (ms && ms.getLastRow() > 1) {
      var mh = headers_(ms);
      ['decka', 'deckb'].forEach(function (k) {
        var c = mh.indexOf(k);
        if (c < 0) return;
        var rng = ms.getRange(2, c + 1, ms.getLastRow() - 1, 1);
        var vals = rng.getValues();
        var changed = false;
        for (var r = 0; r < vals.length; r++) {
          if (norm_(vals[r][0]) === norm_(oldName)) { vals[r][0] = lower.name; changed = true; renamed++; }
        }
        if (changed) rng.setValues(vals);
      });
    }
  }
  return { id: id, row: row, renamed: renamed };
}

function setConfig_(ss, key, value) {
  if (!key) throw new Error('Missing key.');
  var sh = ss.getSheetByName(TABS.config);
  if (!sh) {
    sh = ss.insertSheet(TABS.config);
    sh.getRange(1, 1, 1, 2).setValues([['key', 'value']]);
  }
  var n = sh.getLastRow();
  var keys = n > 1 ? sh.getRange(2, 1, n - 1, 1).getDisplayValues() : [];
  for (var i = 0; i < keys.length; i++) {
    if (norm_(keys[i][0]) === norm_(key)) { sh.getRange(i + 2, 2).setValue(value); return { key: key }; }
  }
  sh.getRange(n + 1, 1, 1, 2).setValues([[key, value]]);
  return { key: key };
}
