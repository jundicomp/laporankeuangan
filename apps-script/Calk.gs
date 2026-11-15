/**
 * Calk — Catatan atas Laporan Keuangan (SAK EP).
 * Angka diambil otomatis dari buku besar (tahun berjalan vs tahun lalu); narasi tiap catatan bisa diedit
 * dan disimpan per tahun buku di T_CALK.
 */

const BULAN_ID_ = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
function tglIndo_(ymd) { return Number(ymd.slice(8, 10)) + ' ' + BULAN_ID_[Number(ymd.slice(5, 7)) - 1] + ' ' + ymd.slice(0, 4); }

function calkTexts_(fs) {
  const m = {};
  readTable_('T_CALK').forEach(function (r) { if (ymd_(r.tahun) === fs || String(r.tahun) === fs) m[r.kode] = r; });
  return m;
}

function defaultPolicy_(comp) {
  const hpp = (comp.metode_hpp || 'rata-rata').toLowerCase();
  return [
    'a. Dasar penyusunan — Laporan keuangan disusun berdasarkan Standar Akuntansi Keuangan Entitas Privat (SAK EP) dengan basis akrual dan konsep biaya historis. Mata uang penyajian adalah Rupiah.',
    'b. Kas dan setara kas — Terdiri dari kas, kas kecil, dan saldo rekening bank yang dapat digunakan sewaktu-waktu.',
    'c. Piutang usaha — Disajikan sebesar jumlah tagihan dikurangi cadangan kerugian piutang. Piutang yang tidak tertagih dihapuskan pada periode diketahuinya.',
    'd. Persediaan — Dicatat dengan metode perpetual; biaya ditentukan dengan metode ' + (hpp.indexOf('fifo') >= 0 ? 'masuk pertama keluar pertama (FIFO)' : 'rata-rata tertimbang') + '. Selisih hasil stok opname dibebankan pada beban pokok penjualan.',
    'e. Aset tetap — Dicatat sebesar biaya perolehan dikurangi akumulasi penyusutan. Penyusutan dihitung dengan metode garis lurus berdasarkan taksiran masa manfaat; tanah tidak disusutkan.',
    'f. Pengakuan pendapatan dan beban — Pendapatan diakui saat barang diserahkan atau jasa selesai diberikan; beban diakui saat terjadi (basis akrual).',
    'g. Pajak — Pajak Pertambahan Nilai dicatat sebagai PPN masukan/keluaran. Beban pajak penghasilan diakui sesuai ketentuan perpajakan yang berlaku.',
  ].join('\n');
}

/** p: { tanggal? | tahun_mulai? } */
function actionCalkGet_(p) {
  const fs = closingYear_(p);
  const fe = fiscalEnd_(fs);
  const pfs = (Number(fs.slice(0, 4)) - 1) + fs.slice(4);
  const pfe = dayBefore_(fs);
  const map = accountsTree_();
  const leaves = leavesSorted_(map);
  const comp = readTable_('M_Perusahaan')[0] || {};
  const texts = calkTexts_(fs);
  const balNow = netBy_('0000-00-00', fe, null);
  const balPrev = netBy_('0000-00-00', pfe, null);
  const plNow = netBy_(fs, fe, NOT_CLOSING_);
  const plPrev = netBy_(pfs, pfe, NOT_CLOSING_);
  const cashAccs = {};
  kasbankRows_().forEach(function (k) { cashAccs[k.akun_id] = true; });
  leaves.forEach(function (a) { if (a.kode.indexOf('1-11') === 0) cashAccs[a.kode] = true; });

  const under = function (a, k) { return a.kode.indexOf(k) === 0 || (a.ancestors || []).indexOf(k) >= 0; };
  const sign = function (a) { return a.saldo_normal === 'K' ? -1 : 1; };
  const tableOf = function (filter, pl, natural) {
    const rows = leaves.filter(filter).map(function (a) {
      const s = natural ? sign(a) : (a.tipe === 'aset' || a.tipe === 'hpp' || a.tipe === 'beban' || a.tipe === 'pajak' ? 1 : -1);
      const now = (pl ? plNow : balNow)[a.kode] || 0;
      const prev = (pl ? plPrev : balPrev)[a.kode] || 0;
      return { kode: a.kode, nama: a.nama, kini: money_(now * s), lalu: money_(prev * s) };
    }).filter(function (r) { return r.kini || r.lalu; });
    return { rows: rows, kini: money_(rows.reduce(function (t, r) { return t + cents_(r.kini); }, 0)), lalu: money_(rows.reduce(function (t, r) { return t + cents_(r.lalu); }, 0)) };
  };
  const isCash = function (a) { return !!cashAccs[a.kode]; };
  const sections = [
    { kode: 'umum', judul: 'Informasi umum', teks: (comp.nama || 'Perusahaan') + ' berkedudukan di ' + (comp.alamat || '(alamat)') +
      (comp.npwp ? ', NPWP ' + comp.npwp : '') + '. Laporan keuangan ini disusun untuk tahun buku ' + tglIndo_(fs) + ' sampai dengan ' + tglIndo_(fe) + ' dan disetujui untuk diterbitkan oleh pemilik/direksi.' },
    { kode: 'kebijakan', judul: 'Ikhtisar kebijakan akuntansi penting', teks: defaultPolicy_(comp) },
    { kode: 'kas', judul: 'Kas dan setara kas', tabel: tableOf(function (a) { return a.tipe === 'aset' && isCash(a); }, false, false) },
    { kode: 'piutang', judul: 'Piutang usaha', tabel: tableOf(function (a) { return a.tipe === 'aset' && !isCash(a) && (a.kode.indexOf('1-13') === 0 || /piutang/i.test(a.nama)); }, false, false),
      teks: 'Piutang usaha merupakan tagihan kepada pelanggan atas penjualan barang dan jasa. Manajemen berpendapat cadangan kerugian piutang telah memadai.' },
    { kode: 'persediaan', judul: 'Persediaan', tabel: tableOf(function (a) { return a.tipe === 'aset' && a.kode.indexOf('1-14') === 0; }, false, false) },
    { kode: 'aset_lancar_lain', judul: 'Aset lancar lainnya', tabel: tableOf(function (a) {
      return a.tipe === 'aset' && under(a, '1-1') && !isCash(a) && a.kode.indexOf('1-13') !== 0 && a.kode.indexOf('1-14') !== 0 && !/piutang/i.test(a.nama); }, false, false) },
    { kode: 'aset_tetap', judul: 'Aset tetap', tabel: tableOf(function (a) { return a.tipe === 'aset' && under(a, '1-2'); }, false, false),
      teks: 'Akumulasi penyusutan disajikan sebagai pengurang (angka negatif) dari biaya perolehan aset tetap.' },
    { kode: 'utang_usaha', judul: 'Utang usaha', tabel: tableOf(function (a) { return a.tipe === 'liabilitas' && a.kode.indexOf('2-11') === 0; }, false, false) },
    { kode: 'utang_pajak', judul: 'Utang pajak', tabel: tableOf(function (a) { return a.tipe === 'liabilitas' && a.kode.indexOf('2-12') === 0; }, false, false) },
    { kode: 'liabilitas_lain', judul: 'Liabilitas lainnya', tabel: tableOf(function (a) {
      return a.tipe === 'liabilitas' && a.kode.indexOf('2-11') !== 0 && a.kode.indexOf('2-12') !== 0; }, false, false) },
    { kode: 'ekuitas', judul: 'Ekuitas', tabel: tableOf(function (a) { return a.tipe === 'ekuitas'; }, false, false),
      teks: 'Laba yang belum ditutup ke saldo laba disajikan pada Laporan Posisi Keuangan sebagai laba tahun berjalan.' },
    { kode: 'pendapatan', judul: 'Pendapatan', tabel: tableOf(function (a) { return a.tipe === 'pendapatan'; }, true, false) },
    { kode: 'hpp', judul: 'Beban pokok penjualan', tabel: tableOf(function (a) { return a.tipe === 'hpp'; }, true, false) },
    { kode: 'beban', judul: 'Beban usaha', tabel: tableOf(function (a) { return a.tipe === 'beban'; }, true, false) },
    { kode: 'lain', judul: 'Pendapatan (beban) lain-lain', tabel: tableOf(function (a) { return a.tipe === 'lain'; }, true, false) },
    { kode: 'peristiwa', judul: 'Peristiwa setelah periode pelaporan', teks: 'Tidak terdapat peristiwa penting setelah tanggal ' + tglIndo_(fe) + ' yang memerlukan penyesuaian atau pengungkapan dalam laporan keuangan.' },
  ];
  var no = 0;
  const out = sections.filter(function (s) { return !s.tabel || s.tabel.rows.length || texts[s.kode]; }).map(function (s) {
    no++;
    const saved = texts[s.kode];
    return { no: no, kode: s.kode, judul: s.judul, tabel: s.tabel || null, teks: saved ? String(saved.isi) : (s.teks || ''), diubah: saved ? { oleh: saved.diubah_oleh, pada: saved.diubah_pada } : null };
  });
  return { from: fs, to: fe, lalu: { from: pfs, to: pfe }, perusahaan: { nama: comp.nama, alamat: comp.alamat, npwp: comp.npwp }, kerangka: getSetting_('kerangka_sak') || 'SAK EP', catatan: out };
}

/** p: { tanggal|tahun_mulai, kode, isi } — isi kosong = kembali ke teks bawaan. */
function actionCalkSave_(p, ctx) {
  const fs = closingYear_(p);
  const kode = String(p.kode || '').trim();
  if (!/^[a-z_]{2,30}$/.test(kode)) throw new ApiError_('VALIDATION', 'Kode catatan tidak valid.');
  const isi = String(p.isi || '').trim();
  if (isi.length > 20000) throw new ApiError_('VALIDATION', 'Teks catatan terlalu panjang.');
  return withLock_(function () {
    const sh = getSheet_('T_CALK');
    const values = sh.getDataRange().getValues();
    const head = values[0].map(String);
    const ct = head.indexOf('tahun'), ck = head.indexOf('kode');
    var row = -1;
    for (var i = 1; i < values.length; i++) if (ymd_(values[i][ct]) === fs && values[i][ck] === kode) row = i;
    if (row >= 0) sh.deleteRow(row + 1);
    if (isi) appendObjects_('T_CALK', [{ tahun: asText_(fs), kode: kode, isi: asText_(isi), diubah_oleh: ctx.session.username, diubah_pada: new Date() }]);
    invalidate_('T_CALK');
    audit_(ctx, 'UBAH_CALK', 'T_CALK', fs + ' ' + kode, null, null, isi ? '' : 'kembali ke teks bawaan');
    return { kode: kode, isi: isi };
  });
}
