/** Utilitas bersama: error, JSON, akses sheet, lock, ID. */

function ApiError_(code, message) {
  this.code = code;
  this.message = message;
}
ApiError_.prototype = Object.create(Error.prototype);

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** ID spreadsheet disimpan di Script Properties oleh setupTemplate(). */
function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new ApiError_('NOT_SETUP', 'Spreadsheet belum dibuat. Jalankan fungsi setupTemplate() sekali dari editor Apps Script.');
  return SpreadsheetApp.openById(id);
}

function getSheet_(name) {
  const sh = getSpreadsheet_().getSheetByName(name);
  if (!sh) throw new ApiError_('NO_SHEET', 'Tab tidak ditemukan: ' + name);
  return sh;
}

/** Baca satu tab menjadi array objek berdasarkan baris header. Sekali panggil getValues — jangan per sel. */
function readTable_(name) {
  const values = getSheet_(name).getDataRange().getValues();
  if (values.length < 2) return [];
  const head = values[0];
  return values.slice(1).map(function (r) {
    const o = {};
    head.forEach(function (h, i) { o[h] = r[i] instanceof Date ? r[i].toISOString() : r[i]; });
    return o;
  });
}

/** Semua penulisan dibungkus lock supaya dua user tidak menulis bersamaan. */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new ApiError_('BUSY', 'Server sedang sibuk, coba lagi sebentar.');
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

/** ID unik yang aman dibuat bersamaan: PREFIX-<waktu base36><acak>. */
function newId_(prefix) {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.floor(Math.random() * 46656).toString(36).toUpperCase();
  return prefix + '-' + t + ('000' + r).slice(-3);
}

function getSetting_(key) {
  const rows = readTable_('SYS_Setting');
  for (var i = 0; i < rows.length; i++) if (rows[i].kunci === key) return rows[i].nilai;
  return null;
}
