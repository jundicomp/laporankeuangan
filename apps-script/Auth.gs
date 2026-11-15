/**
 * Auth — owner pertama, login, sesi, ganti password.
 *
 * Password disimpan sebagai hash SHA-256 berulang dengan salt per user.
 * Token sesi acak 64 karakter, berlaku 8 jam, disimpan di SYS_Sesi
 * dan di-cache supaya pengecekan tiap request tidak membaca sheet.
 */

const SESSION_HOURS = 8;
const MAX_FAIL = 3;
const LOCK_MINUTES = 15;
const HASH_ROUNDS = 200;

function hashPassword_(password, salt) {
  var h = salt + ':' + password;
  for (var i = 0; i < HASH_ROUNDS; i++) {
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8));
  }
  return h;
}

function validatePassword_(pw) {
  if (String(pw || '').length < 8) throw new ApiError_('VALIDATION', 'Password minimal 8 karakter.');
}

function normUsername_(u) {
  const s = String(u || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(s)) throw new ApiError_('VALIDATION', 'Username 3–30 karakter: huruf kecil, angka, titik, minus, garis bawah.');
  return s;
}

function publicUser_(u) {
  return {
    id: u.id, username: u.username, nama: u.nama, email: u.email, role_id: u.role_id,
    cabang_akses: u.cabang_akses, aktif: bool_(u.aktif),
    terkunci: !!(u.terkunci_sampai && new Date(u.terkunci_sampai) > new Date()),
  };
}

function logLogin_(username, status, ket) {
  appendObjects_('SYS_Login', [{ waktu: new Date(), username: username, status: status, keterangan: ket || '' }]);
}

// ---------------------------------------------------------------- sesi

function sessionCacheKey_(token) {
  return 'ses:' + token;
}

function createSession_(u) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const exp = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);
  appendObjects_('SYS_Sesi', [{ token: token, user_id: u.id, dibuat: new Date(), kedaluwarsa: exp }]);
  const s = { user_id: u.id, username: u.username, nama: u.nama, role_id: u.role_id, cabang_akses: u.cabang_akses, exp: exp.toISOString() };
  CacheService.getScriptCache().put(sessionCacheKey_(token), JSON.stringify(s), 21600);
  return { token: token, expiresAt: exp.toISOString() };
}

/** Kembalikan data sesi untuk token, atau lempar error 401. */
function requireSession_(token) {
  if (!token) throw new ApiError_('UNAUTHENTICATED', 'Silakan login dulu.');
  const cache = CacheService.getScriptCache();
  const hit = cache.get(sessionCacheKey_(token));
  var s = hit ? JSON.parse(hit) : null;
  if (!s) {
    const row = readTable_('SYS_Sesi').filter(function (r) { return r.token === token; })[0];
    if (!row || new Date(row.kedaluwarsa) <= new Date()) throw new ApiError_('SESSION_EXPIRED', 'Sesi berakhir, silakan login lagi.');
    const u = readTable_('SYS_User').filter(function (x) { return x.id === row.user_id; })[0];
    if (!u || !bool_(u.aktif)) throw new ApiError_('SESSION_EXPIRED', 'Akun tidak aktif.');
    s = { user_id: u.id, username: u.username, nama: u.nama, role_id: u.role_id, cabang_akses: u.cabang_akses, exp: row.kedaluwarsa };
    cache.put(sessionCacheKey_(token), JSON.stringify(s), 21600);
  }
  if (new Date(s.exp) < new Date()) {
    cache.remove(sessionCacheKey_(token));
    throw new ApiError_('SESSION_EXPIRED', 'Sesi berakhir, silakan login lagi.');
  }
  s.token = token;
  return s;
}

/** Hapus semua sesi milik user (dipakai saat user dinonaktifkan, ganti peran, atau ganti password). */
function revokeUserSessions_(userId, exceptToken) {
  const sh = getSheet_('SYS_Sesi');
  const values = sh.getDataRange().getValues();
  const cache = CacheService.getScriptCache();
  const now = new Date();
  for (var i = 1; i < values.length; i++) {
    if (values[i][1] === userId && values[i][0] !== exceptToken && new Date(values[i][3]) > now) {
      cache.remove(sessionCacheKey_(values[i][0]));
      sh.getRange(i + 1, 4).setValue(new Date(now.getTime() - 1000));
    }
  }
}

// ---------------------------------------------------------------- actions

function actionAuthStatus_() {
  const comp = readTable_('M_Perusahaan')[0] || {};
  return { needsOwner: readTable_('SYS_User').length === 0, company: comp.nama || '' };
}

function actionSetupOwner_(p, ctx) {
  return withLock_(function () {
    if (readTable_('SYS_User').length) throw new ApiError_('ALREADY_SETUP', 'Owner sudah dibuat. Silakan login.');
    const props = PropertiesService.getScriptProperties();
    const code = props.getProperty('SETUP_CODE');
    if (!code || String(p.setupCode || '').trim().toUpperCase() !== code) {
      throw new ApiError_('BAD_SETUP_CODE', 'Kode setup salah. Lihat Log eksekusi setelah menjalankan upgradeSchema().');
    }
    const username = normUsername_(p.username);
    const nama = String(p.nama || '').trim();
    if (!nama) throw new ApiError_('VALIDATION', 'Nama wajib diisi.');
    validatePassword_(p.password);
    ensureRoles_();
    const salt = Utilities.getUuid();
    const u = {
      id: newId_('USR'), username: username, nama: nama, email: plain_(p.email),
      hash_password: hashPassword_(p.password, salt), salt: salt, role_id: 'owner', cabang_akses: '*',
      gagal_login: 0, terkunci_sampai: '', aktif: true,
    };
    appendObjects_('SYS_User', [u]);
    const comp = readTable_('M_Perusahaan')[0];
    if (comp && p.namaPerusahaan) updateWhere_('M_Perusahaan', 'id', comp.id, { nama: String(p.namaPerusahaan).trim() });
    props.deleteProperty('SETUP_CODE');
    ctx.session = { username: username };
    audit_(ctx, 'BUAT_OWNER', 'SYS_User', u.id, null, u, '');
    logLogin_(username, 'sukses', 'owner pertama');
    return createSession_(u);
  });
}

function actionLogin_(p) {
  const username = plain_(p.username).toLowerCase();
  const u = readTable_('SYS_User').filter(function (x) { return x.username === username; })[0];
  if (!u || !bool_(u.aktif)) {
    logLogin_(username, 'gagal', u ? 'akun nonaktif' : 'username tidak dikenal');
    throw new ApiError_('INVALID_LOGIN', 'Username atau password salah.');
  }
  if (u.terkunci_sampai && new Date(u.terkunci_sampai) > new Date()) {
    logLogin_(username, 'ditolak', 'akun terkunci');
    const jam = Utilities.formatDate(new Date(u.terkunci_sampai), 'Asia/Jakarta', 'HH:mm');
    throw new ApiError_('LOCKED', 'Akun dikunci sampai pukul ' + jam + ' karena ' + MAX_FAIL + '× salah password.');
  }
  if (hashPassword_(p.password || '', u.salt) !== u.hash_password) {
    const fails = (Number(u.gagal_login) || 0) + 1;
    const patch = { gagal_login: fails };
    if (fails >= MAX_FAIL) {
      patch.gagal_login = 0;
      patch.terkunci_sampai = new Date(Date.now() + LOCK_MINUTES * 60000);
    }
    withLock_(function () { updateWhere_('SYS_User', 'id', u.id, patch); });
    logLogin_(username, 'gagal', 'password salah (' + fails + ')');
    throw new ApiError_('INVALID_LOGIN', fails >= MAX_FAIL
      ? 'Password salah ' + MAX_FAIL + '×. Akun dikunci ' + LOCK_MINUTES + ' menit.'
      : 'Username atau password salah.');
  }
  return withLock_(function () {
    if (Number(u.gagal_login) || u.terkunci_sampai) updateWhere_('SYS_User', 'id', u.id, { gagal_login: 0, terkunci_sampai: '' });
    logLogin_(username, 'sukses', '');
    return createSession_(u);
  });
}

function actionLogout_(p, ctx) {
  const token = ctx.session.token;
  CacheService.getScriptCache().remove(sessionCacheKey_(token));
  withLock_(function () { updateWhere_('SYS_Sesi', 'token', token, { kedaluwarsa: new Date(Date.now() - 1000) }); });
  return { loggedOut: true };
}

function actionChangePassword_(p, ctx) {
  validatePassword_(p.newPassword);
  return withLock_(function () {
    const u = readTable_('SYS_User').filter(function (x) { return x.id === ctx.session.user_id; })[0];
    if (hashPassword_(p.oldPassword || '', u.salt) !== u.hash_password) throw new ApiError_('VALIDATION', 'Password lama salah.');
    const salt = Utilities.getUuid();
    updateWhere_('SYS_User', 'id', u.id, { salt: salt, hash_password: hashPassword_(p.newPassword, salt) });
    revokeUserSessions_(u.id, ctx.session.token);
    audit_(ctx, 'GANTI_PASSWORD', 'SYS_User', u.id, null, null, '');
    return { changed: true };
  });
}

function actionChangeUsername_(p, ctx) {
  const username = normUsername_(p.username);
  return withLock_(function () {
    const users = readTable_('SYS_User');
    if (users.some(function (x) { return x.username === username && x.id !== ctx.session.user_id; })) {
      throw new ApiError_('VALIDATION', 'Username sudah dipakai.');
    }
    const r = updateWhere_('SYS_User', 'id', ctx.session.user_id, { username: username });
    CacheService.getScriptCache().remove(sessionCacheKey_(ctx.session.token));
    audit_(ctx, 'GANTI_USERNAME', 'SYS_User', ctx.session.user_id, r.before, r.after, '');
    return { username: username };
  });
}

// ---------------------------------------------------------------- lupa password (reset lewat email)

const APP_URL_DEFAULT = 'https://jundicomp.github.io/laporankeuangan/';
const RESET_MINUTES = 30;
const RESET_MAX_PER_HOUR = 3;

/** Teks bersih: buang apostrof di depan (penanda teks Google Sheets yang kadang ikut tersalin) dan spasi. */
function plain_(v) {
  return String(v === undefined || v === null ? '' : v).replace(/^'+/, '').trim();
}

function sha256Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function maskEmail_(e) {
  const m = String(e).split('@');
  if (m.length !== 2) return '***';
  return m[0].slice(0, 2) + '***@' + m[1];
}

/** Alamat tujuan link reset: email pengguna; untuk owner tanpa email → email perusahaan → akun Google pemilik Apps Script. */
function resetDestination_(u) {
  const ok = function (e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(plain_(e)); };
  if (ok(u.email)) return plain_(u.email);
  if (u.role_id !== 'owner') return '';
  const comp = readTable_('M_Perusahaan')[0] || {};
  if (ok(comp.email)) return plain_(comp.email);
  try {
    const g = Session.getEffectiveUser().getEmail();
    if (ok(g)) return g;
  } catch (e) { /* scope belum diizinkan */ }
  return '';
}

/**
 * p: { login: username atau email }. Jawaban selalu sama, ada atau tidak akunnya,
 * supaya orang lain tidak bisa menebak username/email yang terdaftar.
 */
function actionResetRequest_(p) {
  const login = plain_(p.login).toLowerCase();
  const generic = { sent: true, pesan: 'Bila akun itu terdaftar dan punya email, link untuk membuat password baru sudah dikirim. Periksa kotak masuk (dan folder spam). Link berlaku ' + RESET_MINUTES + ' menit.' };
  if (!login) throw new ApiError_('VALIDATION', 'Isi username atau email.');
  const u = readTable_('SYS_User').filter(function (x) {
    return bool_(x.aktif) && (plain_(x.username).toLowerCase() === login || plain_(x.email).toLowerCase() === login);
  })[0];
  if (!u) { logLogin_(login, 'reset', 'tidak dikenal'); return generic; }
  const to = resetDestination_(u);
  if (!to) { logLogin_(u.username, 'reset', 'tidak punya email'); return generic; }
  return withLock_(function () {
    const now = Date.now();
    const recent = readTable_('SYS_Reset').filter(function (r) { return r.user_id === u.id && new Date(r.dibuat).getTime() > now - 3600000; });
    if (recent.length >= RESET_MAX_PER_HOUR) { logLogin_(u.username, 'reset', 'dibatasi (' + recent.length + '×/jam)'); return generic; }
    const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    appendObjects_('SYS_Reset', [{ token_hash: asText_(sha256Hex_(token)), user_id: u.id, dibuat: new Date(now), kedaluwarsa: new Date(now + RESET_MINUTES * 60000), dipakai: '', tujuan: maskEmail_(to) }]);
    const base = String(getSetting_('app_url') || APP_URL_DEFAULT).replace(/#.*$/, '').replace(/\/?$/, '/');
    const link = base + '#/reset?token=' + token;
    const comp = readTable_('M_Perusahaan')[0] || {};
    const co = comp.nama || 'Neraca';
    const html =
      '<div style="font-family:Arial,sans-serif;max-width:520px;color:#1c2430">' +
      '<h2 style="color:#0f5c4d;margin:0 0 4px">' + co + '</h2><div style="color:#9a4500;font-size:13px;margin-bottom:18px">Aplikasi Keuangan</div>' +
      '<p>Halo ' + u.nama + ',</p>' +
      '<p>Ada permintaan membuat password baru untuk akun <b>' + u.username + '</b>. Klik tombol di bawah dalam ' + RESET_MINUTES + ' menit:</p>' +
      '<p style="margin:24px 0"><a href="' + link + '" style="background:#0f5c4d;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Buat password baru</a></p>' +
      '<p style="font-size:13px">Atau salin link ini ke browser:<br><span style="word-break:break-all;color:#1f4a8a">' + link + '</span></p>' +
      '<p style="font-size:13px;color:#9a4500">Bila Anda tidak meminta ini, abaikan email ini — password Anda tidak berubah.</p></div>';
    MailApp.sendEmail({ to: to, subject: co + ' — buat password baru', htmlBody: html, name: co + ' · Neraca' });
    logLogin_(u.username, 'reset', 'link dikirim ke ' + maskEmail_(to));
    return generic;
  });
}

function findReset_(token) {
  const h = sha256Hex_(String(token || ''));
  const r = readTable_('SYS_Reset').filter(function (x) { return x.token_hash === h; })[0];
  if (!r || r.dipakai || new Date(r.kedaluwarsa) < new Date()) return null;
  const u = readTable_('SYS_User').filter(function (x) { return x.id === r.user_id && bool_(x.aktif); })[0];
  return u ? { reset: r, user: u, hash: h } : null;
}

function actionResetCheck_(p) {
  const f = findReset_(p.token);
  if (!f) return { valid: false };
  return { valid: true, username: f.user.username, nama: f.user.nama, kedaluwarsa: f.reset.kedaluwarsa };
}

/** p: { token, password } → password diganti, kunci dibuka, semua sesi lama dikeluarkan, langsung masuk. */
function actionResetConfirm_(p) {
  validatePassword_(p.password);
  return withLock_(function () {
    const f = findReset_(p.token);
    if (!f) throw new ApiError_('RESET_INVALID', 'Link sudah kedaluwarsa atau sudah dipakai. Minta link baru dari halaman masuk.');
    const salt = Utilities.getUuid();
    updateWhere_('SYS_User', 'id', f.user.id, { salt: salt, hash_password: hashPassword_(p.password, salt), gagal_login: 0, terkunci_sampai: '' });
    // semua link reset milik user ini tidak berlaku lagi
    readTable_('SYS_Reset').forEach(function (r) {
      if (r.user_id === f.user.id && !r.dipakai) updateWhere_('SYS_Reset', 'token_hash', r.token_hash, { dipakai: new Date() });
    });
    revokeUserSessions_(f.user.id, '');
    audit_({ session: { username: f.user.username } }, 'RESET_PASSWORD', 'SYS_User', f.user.id, null, null, 'Lewat link email');
    logLogin_(f.user.username, 'sukses', 'password baru lewat link email');
    return createSession_(f.user);
  });
}

/** Ganti email pemulihan sendiri (wajib password saat ini). */
function actionChangeEmail_(p, ctx) {
  const email = plain_(p.email);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError_('VALIDATION', 'Format email tidak valid.');
  return withLock_(function () {
    const u = readTable_('SYS_User').filter(function (x) { return x.id === ctx.session.user_id; })[0];
    if (hashPassword_(p.password || '', u.salt) !== u.hash_password) throw new ApiError_('VALIDATION', 'Password salah.');
    updateWhere_('SYS_User', 'id', u.id, { email: email });
    audit_(ctx, 'GANTI_EMAIL', 'SYS_User', u.id, { email: u.email }, { email: email }, '');
    return { email: email };
  });
}

/** Jalankan dari editor untuk menguji pengiriman email (kirim ke akun Google Anda sendiri). */
function tesKirimEmail() {
  const to = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail(to, 'Tes email Neraca', 'Pengiriman email dari Apps Script berfungsi. Fitur lupa password siap dipakai.');
  Logger.log('Email tes dikirim ke ' + to + '. Sisa kuota email hari ini: ' + MailApp.getRemainingDailyQuota());
}
