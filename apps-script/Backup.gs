/**
 * Backup & impor — salinan harian spreadsheet ke Google Drive, impor saldo awal.
 */

const BACKUP_FOLDER_NAME = 'Neraca Backup';
const KEEP_AUTO = 30;
const KEEP_MANUAL = 20;

function backupFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('BACKUP_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* folder dihapus: buat lagi */ }
  }
  const f = DriveApp.createFolder(BACKUP_FOLDER_NAME);
  props.setProperty('BACKUP_FOLDER_ID', f.getId());
  return f;
}

function backupNow_(kind) {
  const ss = getSpreadsheet_();
  const stamp = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH.mm');
  const name = 'Neraca Backup ' + stamp + ' (' + kind + ')';
  const file = DriveApp.getFileById(ss.getId()).makeCopy(name, backupFolder_());
  pruneBackups_();
  return { id: file.getId(), nama: name, url: file.getUrl() };
}

/** Simpan 30 backup otomatis + 20 manual terbaru; sisanya dipindah ke Sampah Drive (masih bisa dipulihkan 30 hari). */
function pruneBackups_() {
  const it = backupFolder_().getFiles();
  const auto = [];
  const manual = [];
  while (it.hasNext()) {
    const f = it.next();
    (f.getName().indexOf('(otomatis)') >= 0 ? auto : manual).push(f);
  }
  const sortDesc = function (a, b) { return b.getDateCreated() - a.getDateCreated(); };
  auto.sort(sortDesc).slice(KEEP_AUTO).forEach(function (f) { f.setTrashed(true); });
  manual.sort(sortDesc).slice(KEEP_MANUAL).forEach(function (f) { f.setTrashed(true); });
}

/** Dipanggil trigger harian (nama tanpa garis bawah supaya bisa dipilih trigger). */
function dailyBackup() {
  try {
    const r = backupNow_('otomatis');
    appendObjects_('SYS_Audit', [{ waktu: new Date(), user_id: 'sistem', aksi: 'BACKUP', tabel: 'Drive', rec_id: r.nama, before_json: '', after_json: '', alasan: 'otomatis harian' }]);
  } catch (e) {
    console.error('Backup harian gagal: ' + e);
  }
}

function ensureBackupTrigger_() {
  const exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'dailyBackup'; });
  if (exists) return false;
  ScriptApp.newTrigger('dailyBackup').timeBased().atHour(2).everyDays(1).inTimezone('Asia/Jakarta').create();
  return true;
}

function actionBackupList_() {
  const it = backupFolder_().getFiles();
  const out = [];
  while (it.hasNext()) {
    const f = it.next();
    out.push({ id: f.getId(), nama: f.getName(), url: f.getUrl(), dibuat: f.getDateCreated().toISOString(), ukuran: f.getSize() });
  }
  out.sort(function (a, b) { return a.dibuat < b.dibuat ? 1 : -1; });
  const trig = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'dailyBackup'; });
  return { folderUrl: backupFolder_().getUrl(), otomatisAktif: trig, files: out };
}

function actionBackupRun_(p, ctx) {
  const r = backupNow_('manual');
  audit_(ctx, 'BACKUP', 'Drive', r.nama, null, null, 'manual');
  return r;
}

// ---------------------------------------------------------------- impor saldo awal

/**
 * Impor saldo awal dari Excel menjadi satu jurnal SA.
 * lines: [{akun_id, debit, kredit}] — baris nol diabaikan. dryRun hanya memeriksa.
 */
function actionImportOpening_(p, ctx) {
  const tgl = ymd_(p.tgl);
  if (!tgl) throw new ApiError_('VALIDATION', 'Tanggal saldo awal wajib diisi.');
  const accs = accountsMap_();
  const errors = [];
  const lines = [];
  (p.lines || []).forEach(function (l, i) {
    const kode = String(l.akun_id || '').trim();
    const d = Number(l.debit) || 0;
    const k = Number(l.kredit) || 0;
    if (!kode && !d && !k) return;
    if (!d && !k) return;
    if (!accs[kode]) return errors.push({ baris: i + 2, pesan: 'Kode akun ' + kode + ' tidak ada di COA' });
    if (bool_(accs[kode].is_header)) return errors.push({ baris: i + 2, pesan: 'Akun ' + kode + ' adalah header' });
    if (d < 0 || k < 0) return errors.push({ baris: i + 2, pesan: 'Nilai negatif tidak boleh' });
    if (d && k) return errors.push({ baris: i + 2, pesan: 'Isi debit ATAU kredit' });
    const t = accs[kode].tipe;
    if (['pendapatan', 'hpp', 'beban', 'lain', 'pajak'].indexOf(t) >= 0) errors.push({ baris: i + 2, pesan: 'Akun ' + kode + ' adalah akun laba rugi; saldo awal biasanya hanya akun neraca (aset, liabilitas, ekuitas)', peringatan: true });
    lines.push({ akun_id: kode, memo: 'Saldo awal', debit: d, kredit: k });
  });
  const hard = errors.filter(function (e) { return !e.peringatan; });
  const td = lines.reduce(function (s, l) { return s + cents_(l.debit); }, 0);
  const tk = lines.reduce(function (s, l) { return s + cents_(l.kredit); }, 0);
  const existing = journalHeads_().filter(function (h) { return h.jenis === 'SA' && h.status === 'posted'; });
  const summary = { baris: lines.length, total_debit: money_(td), total_kredit: money_(tk), seimbang: td === tk && td > 0, errors: errors, saldoAwalLain: existing.map(function (h) { return h.no; }) };
  if (p.dryRun || hard.length || td !== tk || td === 0) return summary;
  if (existing.length && !p.allowExisting) throw new ApiError_('VALIDATION', 'Sudah ada jurnal saldo awal (' + existing.map(function (h) { return h.no; }).join(', ') + '). Centang konfirmasi bila tetap ingin menambah.');
  return withLock_(function () {
    const head = postJournal_(ctx, { tgl: tgl, jenis: 'SA', keterangan: String(p.keterangan || 'Saldo awal (impor Excel)'), referensi: 'impor', lines: lines });
    summary.no = head.no;
    summary.jurnal_id = head.id;
    return summary;
  });
}
