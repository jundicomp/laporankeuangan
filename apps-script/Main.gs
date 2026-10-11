/**
 * Neraca — API utama (Google Apps Script Web App)
 *
 * Request dari React: POST body JSON (Content-Type text/plain, tanpa preflight CORS)
 *   { "action": "app.bootstrap", "token": "...", "payload": { ... } }
 * Banyak aksi sekaligus (hemat round-trip ±1 detik per panggilan):
 *   { "action": "batch", "token": "...", "payload": { "calls": [ {action, payload}, ... ] } }
 *
 * Setiap route menyebut izin yang dibutuhkan (perm) dan modul yang harus aktif (module).
 */

const ROUTES = {
  // publik
  'system.ping': { fn: actionPing_, public: true },
  'auth.status': { fn: actionAuthStatus_, public: true },
  'auth.setupOwner': { fn: actionSetupOwner_, public: true },
  'auth.login': { fn: actionLogin_, public: true },
  // butuh login
  'auth.logout': { fn: actionLogout_ },
  'auth.changePassword': { fn: actionChangePassword_ },
  'auth.changeUsername': { fn: actionChangeUsername_ },
  'app.bootstrap': { fn: actionBootstrap_ },
  'module.set': { fn: actionModuleSet_, perm: 'modul.manage' },
  'company.update': { fn: actionCompanyUpdate_, perm: 'setting.edit' },
  'user.list': { fn: actionUserList_, perm: 'user.manage' },
  'user.create': { fn: actionUserCreate_, perm: 'user.manage' },
  'user.update': { fn: actionUserUpdate_, perm: 'user.manage' },
  'role.list': { fn: actionRoleList_, perm: 'user.manage' },
  'audit.list': { fn: actionAuditList_, perm: 'audit.view' },
  'login.list': { fn: actionLoginList_, perm: 'audit.view' },
  'system.info': { fn: actionInfo_, perm: 'setting.edit' },
  'test.write': { fn: actionTestWrite_, perm: 'setting.edit' },
  'test.list': { fn: actionTestList_, perm: 'setting.edit' },
};

function doPost(e) {
  const started = Date.now();
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const ctx = { token: req.token || '', session: null };
    var data;
    if (req.action === 'batch') {
      const calls = (req.payload && req.payload.calls) || [];
      if (calls.length > 20) throw new ApiError_('VALIDATION', 'Maksimal 20 aksi per batch.');
      data = calls.map(function (c) {
        try {
          return { ok: true, data: dispatch_(c.action, c.payload || {}, ctx) };
        } catch (err) {
          return { ok: false, error: errInfo_(err) };
        }
      });
    } else {
      data = dispatch_(req.action, req.payload || {}, ctx);
    }
    return json_({ ok: true, data: data, ms: Date.now() - started });
  } catch (err) {
    return json_({ ok: false, error: errInfo_(err), ms: Date.now() - started });
  }
}

function dispatch_(action, payload, ctx) {
  const route = ROUTES[action];
  if (!route) throw new ApiError_('UNKNOWN_ACTION', 'Aksi tidak dikenal: ' + action);
  if (!route.public) {
    if (!ctx.session) ctx.session = requireSession_(ctx.token);
    if (route.perm && !hasPerm_(ctx.session, route.perm)) {
      throw new ApiError_('FORBIDDEN', 'Peran Anda tidak punya izin untuk tindakan ini.');
    }
    if (route.module && !moduleActive_(route.module)) {
      throw new ApiError_('MODULE_OFF', 'Modul ini sedang nonaktif. Aktifkan di Pengaturan → Aktivasi modul.');
    }
  }
  return route.fn(payload, ctx);
}

function errInfo_(err) {
  const known = err instanceof ApiError_;
  if (!known) console.error(err && err.stack ? err.stack : err);
  return { code: known ? err.code : 'SERVER_ERROR', message: String((err && err.message) || err) };
}

/** GET dipakai hanya untuk cek cepat dari browser: buka URL /exec */
function doGet() {
  return json_({ ok: true, data: { app: 'Neraca API', status: 'up', time: new Date().toISOString() } });
}

// ---------------------------------------------------------------- sistem & diagnostik

function actionPing_() {
  return { pong: true, serverTime: new Date().toISOString() };
}

function actionInfo_() {
  const ss = getSpreadsheet_();
  return {
    spreadsheetName: ss.getName(),
    spreadsheetUrl: ss.getUrl(),
    sheets: ss.getSheets().map(function (s) { return s.getName(); }),
    schemaVersion: getSetting_('schema_version') || null,
  };
}

function actionTestWrite_(payload) {
  const note = String(payload.note || '').slice(0, 200);
  if (!note) throw new ApiError_('VALIDATION', 'Isi catatan dulu.');
  const row = { id: newId_('PING'), waktu: new Date(), catatan: note, client: payload.client || '' };
  appendObjects_('T_Ping', [row]);
  return { id: row.id };
}

function actionTestList_(payload) {
  const limit = Math.min(Number(payload.limit) || 10, 50);
  return readTable_('T_Ping').slice(-limit).reverse();
}
