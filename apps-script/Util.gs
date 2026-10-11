/** Utilitas bersama: error, JSON, akses sheet + cache, lock, ID, audit, penomoran. */

function ApiError_(code, message) {
  this.code = code;
  this.message = message;
}
ApiError_.prototype = Object.create(Error.prototype);

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------- spreadsheet

var SS_ = null;
var HEAD_ = {};
var MEMO_ = {}; // salinan tab yang sudah dibaca dalam request ini

/** ID spreadsheet disimpan di Script Properties oleh setupTemplate(). Dibuka sekali per request. */
function getSpreadsheet_() {
  if (SS_) return SS_;
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new ApiError_('NOT_SETUP', 'Spreadsheet belum dibuat. Jalankan fungsi setupTemplate() sekali dari editor Apps Script.');
  SS_ = SpreadsheetApp.openById(id);
  return SS_;
}

function getSheet_(name) {
  const sh = getSpreadsheet_().getSheetByName(name);
  if (!sh) throw new ApiError_('NO_SHEET', 'Tab tidak ditemukan: ' + name + '. Jalankan upgradeSchema() dari editor Apps Script.');
  return sh;
}

function headers_(name) {
  if (HEAD_[name]) return HEAD_[name];
  const sh = getSheet_(name);
  HEAD_[name] = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  return HEAD_[name];
}

/**
 * Tab kecil yang sering dibaca disimpan di CacheService (maks 6 jam).
 * Setiap penulisan lewat helper di bawah otomatis menghapus cache tab itu.
 */
const CACHED_TABLES = {
  M_Perusahaan: true, M_Akun: true, M_KasBank: true, M_Cabang: true, M_Pajak: true,
  SYS_Modul: true, SYS_Role: true, SYS_Setting: true, SYS_Periode: true,
};

function cacheKey_(name) {
  return 'tbl:' + PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') + ':' + name;
}

function rowToObj_(head, r) {
  const o = {};
  head.forEach(function (h, i) { o[h] = r[i] instanceof Date ? r[i].toISOString() : r[i]; });
  return o;
}

/** Baca satu tab menjadi array objek. Sekali getValues per tab — jangan per sel. */
function readTable_(name) {
  if (MEMO_[name]) return MEMO_[name].map(function (o) { return Object.assign({}, o); });
  const rows = readTableRaw_(name);
  MEMO_[name] = rows;
  return rows.map(function (o) { return Object.assign({}, o); });
}

function readTableRaw_(name) {
  const cached = CACHED_TABLES[name];
  if (cached) {
    const hit = CacheService.getScriptCache().get(cacheKey_(name));
    if (hit) return JSON.parse(hit);
  }
  const values = getSheet_(name).getDataRange().getValues();
  const head = values[0].map(String);
  HEAD_[name] = head;
  const rows = values.slice(1).filter(function (r) { return r.some(function (c) { return c !== '' && c !== null; }); })
    .map(function (r) { return rowToObj_(head, r); });
  if (cached) {
    const s = JSON.stringify(rows);
    if (s.length < 90000) {
      try { CacheService.getScriptCache().put(cacheKey_(name), s, 21600); } catch (e) { /* cache penuh: abaikan */ }
    }
  }
  return rows;
}

function invalidate_(name) {
  delete MEMO_[name];
  if (CACHED_TABLES[name]) CacheService.getScriptCache().remove(cacheKey_(name));
}

/**
 * Google Sheets mengubah teks seperti "1-1101", "2026-10", atau "12/2025" menjadi tanggal.
 * Awalan apostrof menyimpannya sebagai teks apa adanya (apostrofnya tidak ikut tersimpan).
 */
function asText_(s) {
  if (s === '' || s === null || s === undefined) return '';
  return "'" + s;
}

function objToRow_(head, o) {
  return head.map(function (h) { return o[h] === undefined || o[h] === null ? '' : o[h]; });
}

/** Tambah baris. Satu baris = appendRow (atomik). Banyak baris wajib dipanggil di dalam withLock_. */
function appendObjects_(name, objs) {
  if (!objs.length) return;
  const sh = getSheet_(name);
  const head = headers_(name);
  const rows = objs.map(function (o) { return objToRow_(head, o); });
  if (rows.length === 1) sh.appendRow(rows[0]);
  else sh.getRange(sh.getLastRow() + 1, 1, rows.length, head.length).setValues(rows);
  invalidate_(name);
}

/** Ubah baris pertama yang kolom `key`-nya = `val`. Panggil di dalam withLock_. Mengembalikan {before, after}. */
function updateWhere_(name, key, val, patch) {
  const sh = getSheet_(name);
  const values = sh.getDataRange().getValues();
  const head = values[0].map(String);
  const k = head.indexOf(key);
  if (k < 0) throw new ApiError_('SERVER_ERROR', 'Kolom ' + key + ' tidak ada di ' + name);
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][k]) === String(val)) {
      const before = rowToObj_(head, values[i]);
      const row = values[i].slice();
      Object.keys(patch).forEach(function (p) {
        const j = head.indexOf(p);
        if (j >= 0) row[j] = patch[p] === null || patch[p] === undefined ? '' : patch[p];
      });
      sh.getRange(i + 1, 1, 1, head.length).setValues([row]);
      invalidate_(name);
      return { before: before, after: rowToObj_(head, row) };
    }
  }
  throw new ApiError_('NOT_FOUND', 'Data tidak ditemukan: ' + name + ' ' + key + '=' + val);
}

// ---------------------------------------------------------------- lock, id, waktu

var LOCK_DEPTH_ = 0;

/** Semua penulisan yang bergantung pada data lain dibungkus lock. Aman dipanggil bertingkat. */
function withLock_(fn) {
  if (LOCK_DEPTH_ > 0) return fn();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new ApiError_('BUSY', 'Server sedang sibuk, coba lagi sebentar.');
  LOCK_DEPTH_++;
  try {
    return fn();
  } finally {
    LOCK_DEPTH_--;
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

/** ID unik yang aman dibuat bersamaan: PREFIX-<waktu base36><acak>. */
function newId_(prefix) {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.floor(Math.random() * 1679616).toString(36).toUpperCase();
  return prefix + '-' + t + ('0000' + r).slice(-4);
}

function getSetting_(key) {
  const rows = readTable_('SYS_Setting');
  for (var i = 0; i < rows.length; i++) if (rows[i].kunci === key) return rows[i].nilai;
  return null;
}

function bool_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

// ---------------------------------------------------------------- audit & penomoran

/** Catat aktivitas. before/after berupa objek (disimpan sebagai JSON). Data rahasia dibuang. */
function audit_(ctx, aksi, tabel, recId, before, after, alasan) {
  const strip = function (o) {
    if (!o) return '';
    const c = {};
    Object.keys(o).forEach(function (k) { if (k !== 'hash_password' && k !== 'salt') c[k] = o[k]; });
    return JSON.stringify(c);
  };
  appendObjects_('SYS_Audit', [{
    waktu: new Date(),
    user_id: ctx && ctx.session ? ctx.session.username : 'sistem',
    aksi: aksi, tabel: tabel, rec_id: recId || '',
    before_json: strip(before), after_json: strip(after), alasan: alasan || '',
  }]);
}

/**
 * Nomor dokumen berikutnya per jenis/cabang/tahun. Wajib di dalam withLock_.
 * formatNumber_('INV/{CAB}/{YYYY}/{####}', 'MB', 2026, 7) → INV/MB/2026/0007
 */
function nextNumber_(jenis, cabang, tahun) {
  const sh = getSheet_('SYS_Counter');
  const values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === jenis && String(values[i][1]) === String(cabang) && Number(values[i][2]) === Number(tahun)) {
      const n = Number(values[i][3]) + 1;
      sh.getRange(i + 1, 4).setValue(n);
      invalidate_('SYS_Counter');
      return n;
    }
  }
  sh.appendRow([jenis, cabang, tahun, 1]);
  return 1;
}

function formatNumber_(pattern, cabang, tahun, n) {
  return String(pattern)
    .replace('{CAB}', cabang)
    .replace('{YYYY}', tahun)
    .replace(/\{(#+)\}/, function (_, h) { return ('000000000' + n).slice(-h.length); });
}
