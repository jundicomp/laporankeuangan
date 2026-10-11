/**
 * Neraca — API utama (Google Apps Script Web App)
 *
 * Semua request dari React masuk lewat doPost dengan body JSON:
 *   { "action": "system.ping", "payload": { ... } }
 * dan dikirim sebagai Content-Type: text/plain supaya browser
 * tidak mengirim preflight CORS (Apps Script tidak menangani OPTIONS).
 *
 * Langkah 0 hanya membuka aksi system.* dan test.*.
 * Login, token, dan hak akses ditambahkan di Langkah 1.
 */

const ACTIONS = {
  'system.ping': actionPing_,
  'system.info': actionInfo_,
  'test.write': actionTestWrite_,
  'test.list': actionTestList_,
};

function doPost(e) {
  const started = Date.now();
  let req = {};
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const handler = ACTIONS[req.action];
    if (!handler) throw new ApiError_('UNKNOWN_ACTION', 'Aksi tidak dikenal: ' + req.action);
    const data = handler(req.payload || {}, req);
    return json_({ ok: true, data: data, ms: Date.now() - started });
  } catch (err) {
    const code = err instanceof ApiError_ ? err.code : 'SERVER_ERROR';
    if (code === 'SERVER_ERROR') console.error(err && err.stack ? err.stack : err);
    return json_({ ok: false, error: { code: code, message: String(err.message || err) }, ms: Date.now() - started });
  }
}

/** GET dipakai hanya untuk cek cepat dari browser: buka URL /exec */
function doGet() {
  return json_({ ok: true, data: { app: 'Neraca API', status: 'up', time: new Date().toISOString() } });
}

// ---------------------------------------------------------------- actions

function actionPing_() {
  return { pong: true, serverTime: new Date().toISOString() };
}

function actionInfo_() {
  const ss = getSpreadsheet_();
  return {
    spreadsheetName: ss.getName(),
    sheets: ss.getSheets().map(function (s) { return s.getName(); }),
    schemaVersion: getSetting_('schema_version') || null,
  };
}

function actionTestWrite_(payload) {
  const note = String(payload.note || '').slice(0, 200);
  if (!note) throw new ApiError_('VALIDATION', 'Isi catatan dulu.');
  return withLock_(function () {
    const sh = getSheet_('T_Ping');
    const row = [newId_('PING'), new Date(), note, payload.client || ''];
    sh.appendRow(row);
    return { id: row[0], rowNumber: sh.getLastRow() };
  });
}

function actionTestList_(payload) {
  const limit = Math.min(Number(payload.limit) || 10, 50);
  const rows = readTable_('T_Ping');
  return rows.slice(-limit).reverse();
}
