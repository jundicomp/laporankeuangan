/**
 * Admin — bootstrap aplikasi, peran & izin, pengguna, modul, perusahaan, audit.
 */

// ---------------------------------------------------------------- izin

function roleOf_(roleId) {
  return readTable_('SYS_Role').filter(function (r) { return r.id === roleId; })[0] || null;
}

function permsOf_(roleId) {
  const r = roleOf_(roleId);
  if (!r) return [];
  try { return JSON.parse(r.izin_json || '[]'); } catch (e) { return []; }
}

function hasPerm_(session, perm) {
  const p = permsOf_(session.role_id);
  return p.indexOf('*') >= 0 || p.indexOf(perm) >= 0;
}

function moduleActive_(kode) {
  const m = readTable_('SYS_Modul').filter(function (x) { return x.kode === kode; })[0];
  return !!m && bool_(m.aktif);
}

// ---------------------------------------------------------------- bootstrap

/** Satu panggilan saat login: semua data dasar yang dibutuhkan layar. */
function actionBootstrap_(p, ctx) {
  const s = ctx.session;
  const role = roleOf_(s.role_id) || {};
  const comp = readTable_('M_Perusahaan')[0] || {};
  const settings = {};
  readTable_('SYS_Setting').forEach(function (r) { settings[r.kunci] = r.nilai; });
  return {
    user: { id: s.user_id, username: s.username, nama: s.nama, role_id: s.role_id, role_nama: role.nama || s.role_id, cabang_akses: s.cabang_akses },
    perms: permsOf_(s.role_id),
    company: comp,
    settings: settings,
    modules: readTable_('SYS_Modul').map(function (m) {
      return { kode: m.kode, nama: m.nama, aktif: bool_(m.aktif), wajib: bool_(m.wajib), bergantung_pada: m.bergantung_pada || '' };
    }),
    coa: readTable_('M_Akun').map(function (a) { a.kode = String(a.kode); a.parent = String(a.parent || ''); a.is_header = bool_(a.is_header); a.aktif = bool_(a.aktif); return a; }),
    kasbank: readTable_('M_KasBank'),
    periods: periodRows_(),
    journalTypes: JOURNAL_TYPES,
    serverTime: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- modul

/**
 * Hitung perubahan berantai saat modul dinyalakan/dimatikan.
 * bergantung_pada: "a" = wajib a; "a|b" = cukup salah satu; beberapa grup dipisah koma.
 */
function planModuleChange_(mods, kode, aktif) {
  const state = {};
  mods.forEach(function (m) { state[m.kode] = bool_(m.aktif); });
  const byKode = {};
  mods.forEach(function (m) { byKode[m.kode] = m; });
  const target = byKode[kode];
  if (!target) throw new ApiError_('NOT_FOUND', 'Modul tidak dikenal: ' + kode);
  if (!aktif && bool_(target.wajib)) throw new ApiError_('VALIDATION', '"' + target.nama + '" adalah modul inti dan tidak bisa dimatikan.');
  const groups = function (m) {
    return String(m.bergantung_pada || '').split(',').map(function (g) { return g.trim(); }).filter(String)
      .map(function (g) { return g.split('|'); });
  };
  if (aktif) {
    const turnOn = function (k) {
      if (state[k]) return;
      state[k] = true;
      groups(byKode[k]).forEach(function (opts) {
        if (!opts.some(function (o) { return state[o]; })) turnOn(opts[0]);
      });
    };
    turnOn(kode);
  } else {
    state[kode] = false;
    var changed = true;
    while (changed) {
      changed = false;
      mods.forEach(function (m) {
        if (!state[m.kode]) return;
        const broken = groups(m).some(function (opts) { return !opts.some(function (o) { return state[o]; }); });
        if (broken) { state[m.kode] = false; changed = true; }
      });
    }
  }
  return mods.filter(function (m) { return state[m.kode] !== bool_(m.aktif); })
    .map(function (m) { return { kode: m.kode, nama: m.nama, aktif: state[m.kode] }; });
}

function actionModuleSet_(p, ctx) {
  return withLock_(function () {
    const mods = readTable_('SYS_Modul');
    const plan = planModuleChange_(mods, p.kode, !!p.aktif);
    if (p.preview) return { changes: plan };
    const now = new Date();
    plan.forEach(function (c) {
      const r = updateWhere_('SYS_Modul', 'kode', c.kode, { aktif: c.aktif, diubah_oleh: ctx.session.username, diubah_pada: now });
      audit_(ctx, c.aktif ? 'AKTIFKAN_MODUL' : 'NONAKTIFKAN_MODUL', 'SYS_Modul', c.kode, r.before, r.after, '');
    });
    return { changes: plan };
  });
}

// ---------------------------------------------------------------- perusahaan

const COMPANY_FIELDS = ['nama', 'npwp', 'alamat', 'telepon', 'email', 'kerangka_sak', 'metode_hpp', 'logo_url', 'rekening_json'];
// pengaturan yang ikut disimpan dari form profil perusahaan (tampil di invoice)
const COMPANY_SETTINGS = ['invoice_catatan', 'invoice_ttd_nama', 'invoice_ttd_jabatan', 'ppn_tarif', 'top_default'];

function setSetting_(key, val) {
  const sh = getSheet_('SYS_Setting');
  const v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (v[i][0] === key) { sh.getRange(i + 1, 2).setValue(val); invalidate_('SYS_Setting'); return; }
  }
  sh.appendRow([key, val]);
  invalidate_('SYS_Setting');
}

function actionCompanyUpdate_(p, ctx) {
  return withLock_(function () {
    const comp = readTable_('M_Perusahaan')[0];
    const patch = {};
    COMPANY_FIELDS.forEach(function (f) { if (p[f] !== undefined) patch[f] = String(p[f]).trim(); });
    if (patch.nama === '') throw new ApiError_('VALIDATION', 'Nama perusahaan wajib diisi.');
    if (patch.logo_url && patch.logo_url.length > 45000) throw new ApiError_('VALIDATION', 'Logo terlalu besar. Pakai gambar yang lebih kecil.');
    if (patch.logo_url && !/^(data:image\/|https:\/\/)/.test(patch.logo_url)) throw new ApiError_('VALIDATION', 'Format logo tidak dikenal.');
    if (patch.rekening_json !== undefined) {
      var rek;
      try { rek = JSON.parse(patch.rekening_json || '[]'); } catch (e) { throw new ApiError_('VALIDATION', 'Data rekening tidak valid.'); }
      if (!Array.isArray(rek)) throw new ApiError_('VALIDATION', 'Data rekening tidak valid.');
      patch.rekening_json = JSON.stringify(rek.slice(0, 5).map(function (r) {
        return { bank: String(r.bank || '').trim(), no: String(r.no || '').trim(), atas_nama: String(r.atas_nama || '').trim() };
      }).filter(function (r) { return r.bank && r.no; }));
    }
    if (patch.npwp) patch.npwp = asText_(patch.npwp);
    if (patch.telepon) patch.telepon = asText_(patch.telepon);
    if (p.settings) {
      COMPANY_SETTINGS.forEach(function (k) {
        if (p.settings[k] === undefined) return;
        var v = String(p.settings[k]).trim();
        if ((k === 'ppn_tarif' || k === 'top_default') && (!isFinite(Number(v)) || Number(v) < 0)) throw new ApiError_('VALIDATION', k + ' harus angka ≥ 0.');
        setSetting_(k, asText_(v));
      });
    }
    const r = updateWhere_('M_Perusahaan', 'id', comp.id, patch);
    const slim = function (o) { const c = Object.assign({}, o); if (c.logo_url) c.logo_url = '(gambar ' + String(c.logo_url).length + ' karakter)'; return c; };
    audit_(ctx, 'UBAH', 'M_Perusahaan', comp.id, slim(r.before), slim(r.after), '');
    return readTable_('M_Perusahaan')[0];
  });
}

// ---------------------------------------------------------------- pengguna

function actionUserList_() {
  return readTable_('SYS_User').map(publicUser_);
}

function actionRoleList_() {
  return {
    roles: readTable_('SYS_Role').map(function (r) {
      var izin = [];
      try { izin = JSON.parse(r.izin_json || '[]'); } catch (e) { /* abaikan */ }
      return { id: r.id, nama: r.nama, izin: izin };
    }),
    catalog: PERMISSIONS,
  };
}

function actionUserCreate_(p, ctx) {
  const username = normUsername_(p.username);
  const nama = String(p.nama || '').trim();
  if (!nama) throw new ApiError_('VALIDATION', 'Nama wajib diisi.');
  validatePassword_(p.password);
  if (!roleOf_(p.role_id)) throw new ApiError_('VALIDATION', 'Peran tidak dikenal.');
  return withLock_(function () {
    if (readTable_('SYS_User').some(function (x) { return x.username === username; })) {
      throw new ApiError_('VALIDATION', 'Username sudah dipakai.');
    }
    const salt = Utilities.getUuid();
    const u = {
      id: newId_('USR'), username: username, nama: nama, email: String(p.email || '').trim(),
      hash_password: hashPassword_(p.password, salt), salt: salt, role_id: p.role_id,
      cabang_akses: p.cabang_akses || '*', gagal_login: 0, terkunci_sampai: '', aktif: true,
    };
    appendObjects_('SYS_User', [u]);
    audit_(ctx, 'BUAT', 'SYS_User', u.id, null, u, '');
    return publicUser_(u);
  });
}

function actionUserUpdate_(p, ctx) {
  return withLock_(function () {
    const users = readTable_('SYS_User');
    const u = users.filter(function (x) { return x.id === p.id; })[0];
    if (!u) throw new ApiError_('NOT_FOUND', 'Pengguna tidak ditemukan.');
    const patch = {};
    if (p.nama !== undefined) patch.nama = String(p.nama).trim();
    if (p.email !== undefined) patch.email = String(p.email).trim();
    if (p.role_id !== undefined) {
      if (!roleOf_(p.role_id)) throw new ApiError_('VALIDATION', 'Peran tidak dikenal.');
      patch.role_id = p.role_id;
    }
    if (p.aktif !== undefined) patch.aktif = !!p.aktif;
    if (p.unlock) { patch.terkunci_sampai = ''; patch.gagal_login = 0; }
    if (p.resetPassword) {
      validatePassword_(p.resetPassword);
      patch.salt = Utilities.getUuid();
      patch.hash_password = hashPassword_(p.resetPassword, patch.salt);
    }
    const self = u.id === ctx.session.user_id;
    if (self && (patch.role_id && patch.role_id !== u.role_id || patch.aktif === false)) {
      throw new ApiError_('VALIDATION', 'Tidak bisa mengubah peran atau menonaktifkan akun sendiri.');
    }
    const losingOwner = u.role_id === 'owner' && ((patch.role_id && patch.role_id !== 'owner') || patch.aktif === false);
    if (losingOwner) {
      const owners = users.filter(function (x) { return x.role_id === 'owner' && bool_(x.aktif); });
      if (owners.length <= 1) throw new ApiError_('VALIDATION', 'Harus ada minimal satu owner aktif.');
    }
    const r = updateWhere_('SYS_User', 'id', u.id, patch);
    if (patch.role_id || patch.aktif === false || patch.hash_password) revokeUserSessions_(u.id, null);
    audit_(ctx, p.resetPassword ? 'RESET_PASSWORD' : 'UBAH', 'SYS_User', u.id, r.before, r.after, p.alasan || '');
    return publicUser_(r.after);
  });
}

// ---------------------------------------------------------------- audit & login

function paginateDesc_(rows, p) {
  const limit = Math.min(Number(p.limit) || 50, 200);
  const offset = Number(p.offset) || 0;
  const desc = rows.slice().reverse();
  return { total: desc.length, rows: desc.slice(offset, offset + limit) };
}

function actionAuditList_(p) {
  var rows = readTable_('SYS_Audit');
  if (p.user) rows = rows.filter(function (r) { return r.user_id === p.user; });
  if (p.aksi) rows = rows.filter(function (r) { return r.aksi === p.aksi; });
  return paginateDesc_(rows, p);
}

function actionLoginList_(p) {
  return paginateDesc_(readTable_('SYS_Login'), p);
}
