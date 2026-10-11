/**
 * Setup — membuat & memperbarui spreadsheet database Neraca.
 *
 * Instal baru  : jalankan setupTemplate() sekali.
 * Update kode  : jalankan upgradeSchema() setiap kali file Apps Script diperbarui.
 *                Aman dijalankan berulang — hanya menambah tab/kolom/data yang belum ada.
 */

const SCHEMA_VERSION = '0.3.0';

const SCHEMA = {
  // ---- master
  M_Perusahaan: ['id', 'nama', 'npwp', 'alamat', 'telepon', 'email', 'logo_url', 'rekening_json', 'mata_uang', 'metode_hpp', 'kerangka_sak', 'awal_tahun_buku'],
  M_Cabang: ['id', 'kode', 'nama', 'alamat', 'divisi_json', 'aktif'],
  M_Pelanggan: ['id', 'kode', 'nama', 'npwp', 'telepon', 'email', 'alamat', 'batas_kredit', 'top_hari', 'akun_piutang', 'aktif'],
  M_Supplier: ['id', 'kode', 'nama', 'npwp', 'telepon', 'email', 'alamat', 'top_hari', 'akun_utang', 'aktif'],
  M_Produk: ['id', 'sku', 'barcode', 'nama', 'tipe', 'satuan', 'harga_beli', 'harga_jual', 'stok_min', 'stok_max', 'akun_penjualan', 'akun_persediaan', 'akun_hpp', 'aktif'],
  M_Gudang: ['id', 'kode', 'nama', 'cabang_id', 'aktif'],
  M_Karyawan: ['id', 'nik', 'nama', 'jabatan', 'divisi', 'gaji_pokok', 'ptkp', 'rekening', 'aktif'],
  M_Akun: ['kode', 'nama', 'tipe', 'saldo_normal', 'parent', 'is_header', 'aktif'],
  M_Pajak: ['id', 'kode', 'nama', 'tarif', 'berlaku_dari', 'berlaku_sampai', 'akun_id'],
  M_KasBank: ['id', 'nama', 'jenis', 'no_rek', 'akun_id', 'aktif'],
  // ---- transaksi
  T_Dokumen: ['id', 'jenis', 'no', 'tgl', 'cabang_id', 'pihak_id', 'status', 'subtotal', 'diskon', 'pajak', 'total', 'sisa', 'jatuh_tempo', 'ref_id', 'catatan', 'dibuat_oleh', 'dibuat_pada'],
  T_DokumenDetail: ['dok_id', 'baris', 'produk_id', 'deskripsi', 'qty', 'harga', 'diskon', 'pajak_id', 'gudang_id', 'hpp'],
  T_Pembayaran: ['id', 'dok_id', 'tgl', 'metode', 'kasbank_id', 'jumlah', 'jurnal_id'],
  T_KasBank: ['id', 'tgl', 'kasbank_id', 'jenis', 'akun_lawan', 'jumlah', 'keterangan', 'rekon', 'jurnal_id'],
  T_StokMutasi: ['id', 'tgl', 'produk_id', 'gudang_id', 'qty', 'harga', 'batch', 'serial', 'exp', 'sumber_dok'],
  T_FifoLayer: ['produk_id', 'gudang_id', 'tgl', 'qty_sisa', 'harga'],
  T_Aset: ['id', 'nama', 'kategori', 'cabang_id', 'tgl_beli', 'harga', 'umur_bln', 'residu', 'akun_aset', 'akun_akum', 'akun_beban', 'status'],
  T_Anggaran: ['periode', 'cabang_id', 'divisi', 'akun_id', 'jumlah'],
  T_Payroll: ['periode', 'karyawan_id', 'komponen_json', 'bruto', 'pph21', 'neto', 'status', 'jurnal_id'],
  T_Penagihan: ['dok_id', 'tgl', 'via', 'catatan', 'oleh'],
  // ---- akuntansi
  T_Jurnal: ['id', 'no', 'tgl', 'jenis', 'ref_dok', 'cabang_id', 'keterangan', 'status', 'balik_otomatis', 'dibuat_oleh', 'dibuat_pada', 'diposting_oleh', 'diposting_pada',
    'referensi', 'total', 'jurnal_asal', 'alasan_batal', 'dibatalkan_oleh', 'dibatalkan_pada'],
  T_JurnalDetail: ['jurnal_id', 'baris', 'akun_id', 'memo', 'divisi', 'proyek', 'debit', 'kredit'],
  SYS_Periode: ['periode', 'status', 'diubah_oleh', 'diubah_pada', 'alasan'],
  R_SaldoAkun: ['periode', 'akun_id', 'debit', 'kredit'],
  // ---- sistem
  SYS_User: ['id', 'username', 'nama', 'email', 'hash_password', 'salt', 'role_id', 'cabang_akses', 'gagal_login', 'terkunci_sampai', 'aktif'],
  SYS_Role: ['id', 'nama', 'izin_json', 'batas_approval'],
  SYS_Sesi: ['token', 'user_id', 'dibuat', 'kedaluwarsa'],
  SYS_Login: ['waktu', 'username', 'status', 'keterangan'],
  SYS_Approval: ['id', 'dok_id', 'level', 'approver_id', 'status', 'catatan', 'waktu'],
  SYS_Audit: ['waktu', 'user_id', 'aksi', 'tabel', 'rec_id', 'before_json', 'after_json', 'alasan'],
  SYS_Counter: ['jenis', 'cabang', 'tahun', 'nomor_terakhir'],
  SYS_Setting: ['kunci', 'nilai'],
  SYS_Modul: ['kode', 'nama', 'aktif', 'wajib', 'bergantung_pada', 'diubah_oleh', 'diubah_pada'],
  // ---- uji Langkah 0
  T_Ping: ['id', 'waktu', 'catatan', 'client'],
};

// kode, nama, tipe, saldo_normal, parent, is_header
const COA = [
  ['1', 'ASET', 'aset', 'D', '', true],
  ['1-1', 'Aset lancar', 'aset', 'D', '1', true],
  ['1-1101', 'Kas', 'aset', 'D', '1-1', false],
  ['1-1102', 'Bank — rekening utama', 'aset', 'D', '1-1', false],
  ['1-1103', 'Bank — rekening kedua', 'aset', 'D', '1-1', false],
  ['1-1104', 'Kas kecil', 'aset', 'D', '1-1', false],
  ['1-1301', 'Piutang usaha', 'aset', 'D', '1-1', false],
  ['1-1302', 'Piutang karyawan', 'aset', 'D', '1-1', false],
  ['1-1309', 'Cadangan kerugian piutang', 'aset', 'K', '1-1', false],
  ['1-1401', 'Persediaan barang dagang', 'aset', 'D', '1-1', false],
  ['1-1501', 'Biaya dibayar di muka', 'aset', 'D', '1-1', false],
  ['1-1502', 'Uang muka pembelian', 'aset', 'D', '1-1', false],
  ['1-1601', 'PPN masukan', 'aset', 'D', '1-1', false],
  ['1-1602', 'Pajak dibayar di muka', 'aset', 'D', '1-1', false],
  ['1-2', 'Aset tetap', 'aset', 'D', '1', true],
  ['1-2101', 'Tanah', 'aset', 'D', '1-2', false],
  ['1-2201', 'Bangunan', 'aset', 'D', '1-2', false],
  ['1-2209', 'Akumulasi penyusutan bangunan', 'aset', 'K', '1-2', false],
  ['1-2301', 'Mesin & peralatan', 'aset', 'D', '1-2', false],
  ['1-2309', 'Akumulasi penyusutan mesin & peralatan', 'aset', 'K', '1-2', false],
  ['1-2401', 'Kendaraan', 'aset', 'D', '1-2', false],
  ['1-2409', 'Akumulasi penyusutan kendaraan', 'aset', 'K', '1-2', false],
  ['1-2501', 'Inventaris kantor', 'aset', 'D', '1-2', false],
  ['1-2509', 'Akumulasi penyusutan inventaris', 'aset', 'K', '1-2', false],
  ['2', 'LIABILITAS', 'liabilitas', 'K', '', true],
  ['2-1', 'Liabilitas jangka pendek', 'liabilitas', 'K', '2', true],
  ['2-1101', 'Utang usaha', 'liabilitas', 'K', '2-1', false],
  ['2-1201', 'PPN keluaran', 'liabilitas', 'K', '2-1', false],
  ['2-1202', 'Utang PPh 21', 'liabilitas', 'K', '2-1', false],
  ['2-1203', 'Utang PPh 23', 'liabilitas', 'K', '2-1', false],
  ['2-1204', 'Utang PPh 4(2)', 'liabilitas', 'K', '2-1', false],
  ['2-1205', 'Utang PPh badan / final', 'liabilitas', 'K', '2-1', false],
  ['2-1301', 'Beban akrual', 'liabilitas', 'K', '2-1', false],
  ['2-1302', 'Utang gaji', 'liabilitas', 'K', '2-1', false],
  ['2-1303', 'Utang BPJS', 'liabilitas', 'K', '2-1', false],
  ['2-1401', 'Uang muka pelanggan', 'liabilitas', 'K', '2-1', false],
  ['2-1501', 'Utang bank — jatuh tempo ≤ 1 tahun', 'liabilitas', 'K', '2-1', false],
  ['2-2', 'Liabilitas jangka panjang', 'liabilitas', 'K', '2', true],
  ['2-2101', 'Utang bank jangka panjang', 'liabilitas', 'K', '2-2', false],
  ['3', 'EKUITAS', 'ekuitas', 'K', '', true],
  ['3-1101', 'Modal', 'ekuitas', 'K', '3', false],
  ['3-2101', 'Saldo laba', 'ekuitas', 'K', '3', false],
  ['3-3101', 'Prive / distribusi ke pemilik', 'ekuitas', 'D', '3', false],
  ['3-9999', 'Ikhtisar laba rugi', 'ekuitas', 'K', '3', false],
  ['4', 'PENDAPATAN', 'pendapatan', 'K', '', true],
  ['4-1101', 'Penjualan barang', 'pendapatan', 'K', '4', false],
  ['4-1201', 'Pendapatan jasa', 'pendapatan', 'K', '4', false],
  ['4-1901', 'Retur penjualan', 'pendapatan', 'D', '4', false],
  ['4-1902', 'Potongan penjualan', 'pendapatan', 'D', '4', false],
  ['5', 'BEBAN POKOK PENJUALAN', 'hpp', 'D', '', true],
  ['5-1101', 'Harga pokok penjualan', 'hpp', 'D', '5', false],
  ['5-1201', 'Beban angkut pembelian', 'hpp', 'D', '5', false],
  ['5-1301', 'Selisih persediaan', 'hpp', 'D', '5', false],
  ['6', 'BEBAN USAHA', 'beban', 'D', '', true],
  ['6-1101', 'Beban gaji & tunjangan', 'beban', 'D', '6', false],
  ['6-1102', 'Beban lembur & insentif', 'beban', 'D', '6', false],
  ['6-1103', 'Beban THR & bonus', 'beban', 'D', '6', false],
  ['6-1104', 'Beban BPJS perusahaan', 'beban', 'D', '6', false],
  ['6-1201', 'Beban sewa', 'beban', 'D', '6', false],
  ['6-1301', 'Beban pemasaran', 'beban', 'D', '6', false],
  ['6-1401', 'Beban penyusutan', 'beban', 'D', '6', false],
  ['6-1501', 'Beban listrik, air & telepon', 'beban', 'D', '6', false],
  ['6-1601', 'Beban kerugian piutang', 'beban', 'D', '6', false],
  ['6-1701', 'Beban transportasi', 'beban', 'D', '6', false],
  ['6-1801', 'Beban perlengkapan kantor', 'beban', 'D', '6', false],
  ['6-1802', 'Beban pemeliharaan', 'beban', 'D', '6', false],
  ['6-1901', 'Beban umum lainnya', 'beban', 'D', '6', false],
  ['7', 'PENDAPATAN & BEBAN LAIN', 'lain', 'K', '', true],
  ['7-1101', 'Pendapatan lain-lain', 'lain', 'K', '7', false],
  ['7-1102', 'Pendapatan bunga / jasa giro', 'lain', 'K', '7', false],
  ['7-1103', 'Laba penjualan aset', 'lain', 'K', '7', false],
  ['7-2101', 'Beban bunga', 'lain', 'D', '7', false],
  ['7-2102', 'Beban administrasi bank', 'lain', 'D', '7', false],
  ['7-2103', 'Rugi penjualan aset', 'lain', 'D', '7', false],
  ['8', 'PAJAK PENGHASILAN', 'pajak', 'D', '', true],
  ['8-1101', 'Beban pajak penghasilan', 'pajak', 'D', '8', false],
];

// kode, nama, aktif, wajib, bergantung_pada
const MODULES = [
  ['akuntansi', 'Akuntansi & COA', true, true, ''],
  ['kasbank', 'Kas & bank', true, true, ''],
  ['laporan', 'Laporan keuangan & tutup buku', true, true, 'akuntansi'],
  ['akses', 'Pengguna, akses & audit log', true, true, ''],
  ['backup', 'Backup & impor/ekspor', true, true, ''],
  ['penjualan', 'Penjualan & invoice', true, false, ''],
  ['penawaran', 'Penawaran & sales order', false, false, 'penjualan'],
  ['piutang', 'Piutang & penagihan', true, false, 'penjualan'],
  ['pembelian', 'Pembelian & tagihan supplier', false, false, ''],
  ['po', 'Permintaan pembelian & PO', false, false, 'pembelian'],
  ['utang', 'Utang & jadwal bayar', false, false, 'pembelian'],
  ['persediaan', 'Persediaan perpetual', false, false, 'penjualan|pembelian'],
  ['multigudang', 'Multi gudang & transfer', false, false, 'persediaan'],
  ['batch', 'Batch, serial, kedaluwarsa', false, false, 'persediaan'],
  ['aset', 'Aset tetap & penyusutan', false, false, ''],
  ['payroll', 'Payroll & slip gaji', false, false, ''],
  ['pajak', 'Pajak (PPN/PPh, kalender)', false, false, ''],
  ['anggaran', 'Anggaran & proyeksi', false, false, ''],
  ['approval', 'Approval bertingkat', false, false, ''],
  ['cabang', 'Multi cabang / divisi', false, false, ''],
  ['proyek', 'Dimensi proyek', false, false, ''],
  ['rekonbank', 'Rekonsiliasi bank', false, false, 'kasbank'],
  ['bankable', 'Paket laporan bankable', false, false, 'laporan'],
  ['multiperusahaan', 'Multi perusahaan', false, false, ''],
];

function setupTemplate() {
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty('SPREADSHEET_ID');
  if (existing) {
    Logger.log('Spreadsheet sudah ada: https://docs.google.com/spreadsheets/d/' + existing +
      '\nKalau mau membuat ulang, jalankan resetSetup() dulu.');
    return existing;
  }
  const ss = SpreadsheetApp.create('Neraca — Database');
  const names = Object.keys(SCHEMA);
  const first = ss.getSheets()[0];
  first.setName(names[0]);
  names.forEach(function (name, i) {
    const sh = i === 0 ? first : ss.insertSheet(name);
    const head = SCHEMA[name];
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#e3f1ec');
    sh.setFrozenRows(1);
    // hapus kolom berlebih supaya kuota sel (10 juta) tidak terbuang
    const extra = sh.getMaxColumns() - head.length;
    if (extra > 0) sh.deleteColumns(head.length + 1, extra);
  });
  seed_(ss);
  props.setProperty('SPREADSHEET_ID', ss.getId());
  Logger.log('Selesai. Spreadsheet: ' + ss.getUrl());
  upgradeSchema();
  return ss.getId();
}

function seed_(ss) {
  const put = function (name, rows) {
    if (!rows.length) return;
    ss.getSheetByName(name).getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  };
  put('M_Akun', COA.map(function (a) { return [asText_(a[0]), a[1], a[2], a[3], asText_(a[4]), a[5], true]; }));
  const now = new Date();
  put('SYS_Modul', MODULES.map(function (m) { return m.concat(['setup', now]); }));
  put('SYS_Setting', [
    ['schema_version', SCHEMA_VERSION],
    ['kerangka_sak', 'SAK EP'],
    ['zona_waktu', 'Asia/Jakarta'],
    ['format_nomor_invoice', 'INV/{CAB}/{YYYY}/{####}'],
  ]);
  put('M_Perusahaan', [['MB01', 'Perusahaan Saya', '', '', '', '', '', '[]', 'IDR', 'rata-rata', 'SAK EP', 1]]);
  put('M_KasBank', [
    ['KB-KAS', 'Kas', 'kas', '', asText_('1-1101'), true],
    ['KB-BANK1', 'Bank — rekening utama', 'bank', '', asText_('1-1102'), true],
  ]);
  const y = now.getFullYear();
  const periods = [];
  for (var m = 1; m <= 12; m++) periods.push([asText_(y + '-' + ('0' + m).slice(-2)), 'buka', 'setup', now, '']);
  put('SYS_Periode', periods);
}

/** Lepas tautan ke spreadsheet lama (file-nya tidak dihapus dari Drive). */
function resetSetup() {
  PropertiesService.getScriptProperties().deleteProperty('SPREADSHEET_ID');
  Logger.log('SPREADSHEET_ID dihapus dari Script Properties. Jalankan setupTemplate() lagi.');
}

// ================================================================ peran & izin

/** Katalog izin. Kunci dipakai di route server dan menu React. */
const PERMISSIONS = [
  ['dashboard.view', 'Lihat dashboard'],
  ['master.view', 'Lihat master data'], ['master.edit', 'Ubah master data'],
  ['penjualan.view', 'Lihat penjualan & piutang'], ['penjualan.edit', 'Buat/ubah penjualan'],
  ['pembelian.view', 'Lihat pembelian & utang'], ['pembelian.edit', 'Buat/ubah pembelian'],
  ['kas.view', 'Lihat kas & bank'], ['kas.edit', 'Catat kas & bank'], ['bank.saldo', 'Lihat saldo rekening bank'],
  ['persediaan.view', 'Lihat persediaan'], ['persediaan.edit', 'Ubah persediaan & opname'],
  ['aset.view', 'Lihat aset tetap'], ['aset.edit', 'Ubah aset tetap'],
  ['jurnal.view', 'Lihat jurnal & buku besar'], ['jurnal.edit', 'Buat jurnal manual'], ['jurnal.approve', 'Setujui jurnal'],
  ['periode.lock', 'Kunci periode & tutup buku'], ['periode.reopen', 'Buka kembali periode'],
  ['laporan.view', 'Lihat laporan keuangan'],
  ['anggaran.view', 'Lihat anggaran'], ['anggaran.edit', 'Ubah anggaran'],
  ['payroll.view', 'Lihat data & laporan gaji'], ['payroll.edit', 'Proses payroll'],
  ['pajak.view', 'Lihat pajak'], ['pajak.edit', 'Ubah pengaturan pajak'],
  ['user.manage', 'Kelola pengguna & peran'], ['audit.view', 'Lihat audit log & riwayat login'],
  ['modul.manage', 'Aktivasi modul'], ['setting.edit', 'Ubah pengaturan perusahaan'], ['backup.run', 'Backup, impor & ekspor'],
].map(function (p) { return { kode: p[0], nama: p[1] }; });

const ROLES = [
  ['owner', 'Owner', ['*'], 0],
  ['direktur', 'Direktur', ['dashboard.view', 'master.view', 'penjualan.view', 'pembelian.view', 'kas.view', 'bank.saldo', 'persediaan.view',
    'aset.view', 'jurnal.view', 'jurnal.approve', 'laporan.view', 'anggaran.view', 'pajak.view', 'audit.view'], 0],
  ['finance', 'Finance', ['dashboard.view', 'master.view', 'master.edit', 'penjualan.view', 'penjualan.edit', 'pembelian.view', 'pembelian.edit',
    'kas.view', 'kas.edit', 'bank.saldo', 'jurnal.view', 'laporan.view', 'pajak.view', 'pajak.edit', 'anggaran.view'], 10000000],
  ['accounting', 'Accounting', ['dashboard.view', 'master.view', 'penjualan.view', 'pembelian.view', 'kas.view', 'bank.saldo', 'persediaan.view',
    'aset.view', 'aset.edit', 'jurnal.view', 'jurnal.edit', 'periode.lock', 'laporan.view', 'pajak.view', 'anggaran.view', 'anggaran.edit'], 0],
  ['admin', 'Admin', ['master.view', 'master.edit', 'penjualan.view', 'penjualan.edit', 'pembelian.view', 'pembelian.edit', 'persediaan.view'], 0],
  ['kasir', 'Kasir', ['master.view', 'penjualan.view', 'penjualan.edit', 'kas.view', 'kas.edit'], 2000000],
  ['gudang', 'Gudang', ['master.view', 'pembelian.view', 'persediaan.view', 'persediaan.edit'], 0],
  ['hr', 'HR & Payroll', ['master.view', 'payroll.view', 'payroll.edit'], 0],
  ['auditor', 'Auditor', ['dashboard.view', 'master.view', 'penjualan.view', 'pembelian.view', 'kas.view', 'bank.saldo', 'persediaan.view',
    'aset.view', 'jurnal.view', 'laporan.view', 'anggaran.view', 'pajak.view', 'audit.view'], 0],
];

/** Isi SYS_Role bila masih kosong. Peran yang sudah ada tidak ditimpa (bisa diubah owner). */
function ensureRoles_() {
  const existing = readTable_('SYS_Role').map(function (r) { return r.id; });
  const add = ROLES.filter(function (r) { return existing.indexOf(r[0]) < 0; })
    .map(function (r) { return { id: r[0], nama: r[1], izin_json: JSON.stringify(r[2]), batas_approval: r[3] }; });
  if (add.length) withLock_(function () { appendObjects_('SYS_Role', add); });
  return add.length;
}

// ================================================================ upgrade

/**
 * Jalankan dari editor setiap kali kode Apps Script diperbarui.
 * Menambah tab & kolom yang belum ada, mengisi peran bawaan, dan membuat kode setup owner.
 */
function upgradeSchema() {
  const ss = getSpreadsheet_();
  const log = [];
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    const head = SCHEMA[name];
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#e3f1ec');
      sh.setFrozenRows(1);
      log.push('+ tab ' + name);
      return;
    }
    const current = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String).filter(String);
    const missing = head.filter(function (h) { return current.indexOf(h) < 0; });
    if (missing.length) {
      if (sh.getMaxColumns() < current.length + missing.length) sh.insertColumnsAfter(sh.getMaxColumns(), current.length + missing.length - sh.getMaxColumns());
      sh.getRange(1, current.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold').setBackground('#e3f1ec');
      log.push('+ kolom ' + name + ': ' + missing.join(', '));
    }
  });
  fixLegacyText_(ss, log);
  Object.keys(CACHED_TABLES).forEach(invalidate_);
  const roles = ensureRoles_();
  if (roles) log.push('+ ' + roles + ' peran bawaan');

  const settings = ss.getSheetByName('SYS_Setting');
  const sv = settings.getDataRange().getValues();
  var found = false;
  for (var i = 1; i < sv.length; i++) {
    if (sv[i][0] === 'schema_version') { settings.getRange(i + 1, 2).setValue(SCHEMA_VERSION); found = true; }
  }
  if (!found) settings.appendRow(['schema_version', SCHEMA_VERSION]);
  const keys = sv.map(function (r) { return r[0]; });
  if (keys.indexOf('format_nomor_jurnal') < 0) settings.appendRow(['format_nomor_jurnal', '{JENIS}/{YYYY}/{MM}/{####}']);
  invalidate_('SYS_Setting');

  const props = PropertiesService.getScriptProperties();
  if (readTable_('SYS_User').length === 0) {
    var code = props.getProperty('SETUP_CODE');
    if (!code) {
      code = Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
      props.setProperty('SETUP_CODE', code);
    }
    log.push('KODE SETUP OWNER: ' + code + '  ← masukkan di halaman "Buat akun owner"');
  }
  Logger.log('upgradeSchema ' + SCHEMA_VERSION + ' selesai.\n' + (log.length ? log.join('\n') : 'Tidak ada perubahan.'));
}

/**
 * Perbaikan data versi awal: Sheets sempat mengubah kode akun ("1-1101") dan periode ("2026-01")
 * menjadi tanggal. Kembalikan ke teks. Aman diulang.
 */
function fixLegacyText_(ss, log) {
  // M_Akun: kode & parent
  const akun = ss.getSheetByName('M_Akun');
  const av = akun.getDataRange().getValues();
  const ah = av[0].map(String);
  const ik = ah.indexOf('kode');
  const ip = ah.indexOf('parent');
  var fixed = 0;
  for (var i = 1; i < av.length; i++) {
    const broken = av[i][ik] instanceof Date || av[i][ip] instanceof Date;
    if (!broken) continue;
    const seed = COA[i - 1];
    if (!seed) continue;
    akun.getRange(i + 1, ik + 1).setValue(asText_(seed[0]));
    akun.getRange(i + 1, ip + 1).setValue(asText_(seed[4]));
    fixed++;
  }
  if (fixed) log.push('~ ' + fixed + ' kode akun dikembalikan ke teks');
  // M_KasBank: akun_id bawaan
  const kb = ss.getSheetByName('M_KasBank');
  const kv = kb.getDataRange().getValues();
  const kh = kv[0].map(String);
  const seedKb = { 'KB-KAS': '1-1101', 'KB-BANK1': '1-1102' };
  for (var j = 1; j < kv.length; j++) {
    const col = kh.indexOf('akun_id');
    if (kv[j][col] instanceof Date && seedKb[kv[j][0]]) kb.getRange(j + 1, col + 1).setValue(asText_(seedKb[kv[j][0]]));
  }
  // SYS_Periode: kolom periode
  const per = ss.getSheetByName('SYS_Periode');
  const pv = per.getDataRange().getValues();
  var pf = 0;
  for (var k = 1; k < pv.length; k++) {
    if (pv[k][0] instanceof Date) {
      per.getRange(k + 1, 1).setValue(asText_(Utilities.formatDate(pv[k][0], ss.getSpreadsheetTimeZone(), 'yyyy-MM')));
      pf++;
    }
  }
  if (pf) log.push('~ ' + pf + ' periode dikembalikan ke teks');
}
