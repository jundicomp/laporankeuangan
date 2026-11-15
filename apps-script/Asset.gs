/**
 * Asset — aset tetap & penyusutan (SAK EP: biaya perolehan dikurangi akumulasi penyusutan).
 *
 * Penyusutan dimulai pada bulan perolehan (bulan penuh) sampai umur manfaat habis.
 * Metode garis lurus: (harga − residu) / umur bulan, pembulatan dibagi rata secara kumulatif.
 * Metode saldo menurun: tarif tahunan 2 / umur tahun dari nilai buku awal tiap tahun aset;
 * sisa nilai buku disusutkan sekaligus di bulan terakhir umur manfaat (seperti ketentuan pajak).
 *
 * Proses penyusutan bulanan = satu jurnal penyesuaian (JP) per bulan, ref_dok SUSUT-YYYY-MM.
 * Bulan yang terlewat ikut digabung ke proses berikutnya (tercatat sebagai "susulan").
 */

const ASET_KATEGORI = [
  { kode: 'tanah', nama: 'Tanah', akun_aset: '1-2101', akun_akum: '', umur: 0 },
  { kode: 'bangunan', nama: 'Bangunan', akun_aset: '1-2201', akun_akum: '1-2209', umur: 240 },
  { kode: 'mesin', nama: 'Mesin & peralatan', akun_aset: '1-2301', akun_akum: '1-2309', umur: 96 },
  { kode: 'kendaraan', nama: 'Kendaraan', akun_aset: '1-2401', akun_akum: '1-2409', umur: 96 },
  { kode: 'inventaris', nama: 'Inventaris kantor & komputer', akun_aset: '1-2501', akun_akum: '1-2509', umur: 48 },
];
const AKUN_BEBAN_SUSUT = '6-1401';
const AKUN_LABA_ASET = '7-1103';
const AKUN_RUGI_ASET = '7-2103';
const METODE_SUSUT = { garis_lurus: 'Garis lurus', saldo_menurun: 'Saldo menurun ganda' };

// ---------------------------------------------------------------- utilitas bersama Langkah 7

function ymAdd_(ym, n) {
  var y = Number(ym.slice(0, 4));
  var m = Number(ym.slice(5, 7)) - 1 + n;
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return y + '-' + ('0' + (m + 1)).slice(-2);
}
/** Selisih bulan b − a. */
function ymDiff_(a, b) {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
}
function monthEnd_(ym) {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  return ym + '-' + ('0' + d).slice(-2);
}
function isYm_(s) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || '')); }

/** Rekening kas/bank aktif yang boleh dipakai peran ini; uang tunai tidak boleh minus. */
function pickCash_(ctx, id, keluar) {
  const kb = kasbankRows_().filter(function (k) { return k.id === id; })[0];
  if (!kb || !kb.aktif) throw new ApiError_('VALIDATION', 'Pilih rekening kas/bank yang aktif.');
  if (!canSeeAccount_(ctx.session, kb)) throw new ApiError_('FORBIDDEN', 'Peran Anda tidak punya akses ke rekening bank ini.');
  if (keluar > 0 && kb.jenis !== 'bank') {
    const saldo = balanceAt_(kb.akun_id, '9999-12-31');
    if (saldo - keluar < 0) throw new ApiError_('INSUFFICIENT', 'Saldo ' + kb.nama + ' tidak cukup (saldo ' + formatRp_(saldo) + ', keluar ' + formatRp_(keluar) + ').');
  }
  return kb;
}

/** Baris Kas & Bank untuk transaksi yang dibuat modul lain (tidak bisa dibatalkan dari menu Kas & Bank). */
function writeCashTrx_(ctx, o) {
  const id = newId_(o.jenis === 'masuk' ? 'KBKM' : 'KBKK');
  appendObjects_('T_KasBank', [{
    id: id, no: o.no, tgl: asText_(o.tgl), kasbank_id: o.kb.id, kasbank_tujuan: '', jenis: o.jenis, metode: o.metode || 'transfer',
    kontak_tipe: o.kontak_tipe || '', kontak_id: o.kontak_id || '', kontak_nama: asText_(o.kontak_nama || ''), akun_lawan: asText_(o.akun_lawan),
    jumlah: money_(o.jumlah), keterangan: asText_(o.keterangan), referensi: asText_(o.referensi || ''),
    lines_json: JSON.stringify([{ akun_id: o.akun_lawan, memo: o.keterangan, jumlah: money_(o.jumlah) }]),
    rekon: false, jurnal_id: o.jurnal_id, status: 'posted', sumber_dok: o.sumber_dok, dibuat_oleh: ctx.session.username, dibuat_pada: new Date(),
  }]);
  return id;
}

/** Cek transaksi kas yang terkait belum direkonsiliasi. */
function assertCashNotReconciled_(trxId) {
  if (!trxId) return;
  const trx = cashRows_().filter(function (r) { return r.id === trxId; })[0];
  if (trx && bool_(trx.rekon)) throw new ApiError_('VALIDATION', 'Transaksi kas/bank ' + trx.no + ' sudah direkonsiliasi dengan rekening koran, jadi tidak bisa dibatalkan.');
}

/** Batalkan jurnal sumber dokumen: jurnal pembalik bertanggal sama + tandai batal (+ baris kas). */
function voidDocJournal_(ctx, jurnalId, alasan, trxId) {
  if (!jurnalId) return null;
  assertCashNotReconciled_(trxId);
  const j = actionJournalGet_({ id: jurnalId });
  if (j.status !== 'posted') return null;
  assertOpen_(j.tgl);
  const linesC = j.lines.map(function (l) { return { akun_id: l.akun_id, memo: l.memo, debit: cents_(l.debit), kredit: cents_(l.kredit) }; });
  const rev = reverseJournal_(ctx, j, linesC, j.tgl, 'Pembatalan ' + j.no + ': ' + alasan, true);
  updateWhere_('T_Jurnal', 'id', j.id, { status: 'batal', alasan_batal: asText_(alasan), dibatalkan_oleh: ctx.session.username, dibatalkan_pada: new Date() });
  if (trxId) updateWhere_('T_KasBank', 'id', trxId, { status: 'batal', alasan_batal: asText_(alasan) });
  return rev;
}

function leafAccount_(accs, kode, label) {
  const a = accs[kode];
  if (!kode || !a || bool_(a.is_header)) throw new ApiError_('VALIDATION', label + ' ' + (kode || '') + ' tidak ada atau berupa header.');
  return a;
}

/** Hapus semua baris tab yang kolom `key`-nya = val (dipakai untuk rincian draft). Di dalam withLock_. */
function deleteWhere_(name, key, val) {
  const sh = getSheet_(name);
  const values = sh.getDataRange().getValues();
  const k = values[0].map(String).indexOf(key);
  for (var i = values.length - 1; i >= 1; i--) if (String(values[i][k]) === String(val)) sh.deleteRow(i + 1);
  invalidate_(name);
}

// ---------------------------------------------------------------- data

function assetRows_() {
  return readTable_('T_Aset').map(function (r) {
    r.tgl_beli = ymd_(r.tgl_beli);
    r.mulai_susut = r.mulai_susut ? ym_(r.mulai_susut) : r.tgl_beli.slice(0, 7);
    r.akum_awal_per = r.akum_awal_per ? ym_(r.akum_awal_per) : '';
    r.tgl_lepas = r.tgl_lepas ? ymd_(r.tgl_lepas) : '';
    r.harga = Number(r.harga) || 0;
    r.residu = Number(r.residu) || 0;
    r.akum_awal = Number(r.akum_awal) || 0;
    r.umur_bln = Number(r.umur_bln) || 0;
    r.harga_lepas = Number(r.harga_lepas) || 0;
    ['kode', 'akun_aset', 'akun_akum', 'akun_beban', 'akun_lawan', 'lokasi', 'catatan'].forEach(function (k) { r[k] = String(r[k] === undefined || r[k] === null ? '' : r[k]); });
    r.metode = r.metode || 'garis_lurus';
    r.status = r.status || 'aktif';
    return r;
  });
}

function susutRows_() {
  return readTable_('T_Susut').map(function (r) {
    r.periode = ym_(r.periode);
    r.dari = ym_(r.dari);
    r.sampai = ym_(r.sampai);
    r.jumlah = Number(r.jumlah) || 0;
    return r;
  });
}

/** Rencana penyusutan bulanan (sen) untuk bulan sesudah akumulasi awal. [{i, ym, amt}] */
function scheduleOf_(a) {
  const umur = a.umur_bln;
  const harga = cents_(a.harga);
  const residu = cents_(a.residu);
  const base = harga - residu;
  const out = [];
  if (umur <= 0 || base <= 0) return out;
  const start = a.mulai_susut;
  const awal = cents_(a.akum_awal);
  const k0 = a.akum_awal_per ? Math.max(0, Math.min(umur, ymDiff_(start, a.akum_awal_per) + 1)) : 0;
  if (a.metode === 'saldo_menurun') {
    const rate = Math.min(1, 2 / (umur / 12));
    var akum = awal;
    var yearBase = 0;
    for (var i = k0 + 1; i <= umur; i++) {
      const bv = harga - akum;
      if ((i - 1) % 12 === 0 || i === k0 + 1) yearBase = bv;
      var d = i === umur ? bv - residu : Math.round(yearBase * rate / 12);
      d = Math.max(0, Math.min(d, bv - residu));
      out.push({ i: i, ym: ymAdd_(start, i - 1), amt: d });
      akum += d;
    }
  } else {
    const rem = umur - k0;
    const sisa = base - awal;
    for (var j = 1; j <= rem; j++) {
      const v = Math.round(sisa * j / rem) - Math.round(sisa * (j - 1) / rem);
      out.push({ i: k0 + j, ym: ymAdd_(start, k0 + j - 1), amt: Math.max(0, v) });
    }
  }
  return out;
}

/** Bulan terakhir yang sudah tercatat penyusutannya (akumulasi awal atau proses). */
function lastDone_(a, susut) {
  var done = a.akum_awal_per || ymAdd_(a.mulai_susut, -1);
  susut.forEach(function (s) { if (s.aset_id === a.id && s.status === 'aktif' && s.sampai > done) done = s.sampai; });
  return done;
}

/** Penyusutan yang jatuh tempo s/d bulan `upto` dan belum tercatat. */
function dueOf_(a, susut, upto) {
  const done = lastDone_(a, susut);
  var limit = upto;
  if (a.tgl_lepas) { const before = ymAdd_(a.tgl_lepas.slice(0, 7), -1); if (before < limit) limit = before; }
  var amt = 0, n = 0, dari = '', sampai = '';
  scheduleOf_(a).forEach(function (s) {
    if (s.ym <= done || s.ym > limit) return;
    amt += s.amt; n++;
    if (!dari) dari = s.ym;
    sampai = s.ym;
  });
  return { amt: amt, bulan: n, dari: dari, sampai: sampai, done: done };
}

/** Akumulasi penyusutan (sen) s/d akhir bulan `ym`. */
function akumAt_(a, susut, ym) {
  var c = cents_(a.akum_awal);
  susut.forEach(function (s) { if (s.aset_id === a.id && s.status === 'aktif' && s.periode <= ym) c += cents_(s.jumlah); });
  return c;
}

function kategoriOf_(kode) {
  return ASET_KATEGORI.filter(function (k) { return k.kode === kode; })[0] || null;
}

// ---------------------------------------------------------------- daftar & detail

/** p: { per? } — daftar aset per tanggal + cocokkan dengan buku besar. */
function actionAssetList_(p) {
  const per = p.per ? ymd_(p.per) : todayYmd_();
  const perYm = per.slice(0, 7);
  const susut = susutRows_();
  const accs = accountsMap_();
  const rows = [];
  const reg = {};
  const addReg = function (akun, c) { if (akun) reg[akun] = (reg[akun] || 0) + c; };
  assetRows_().forEach(function (a) {
    if (a.status === 'batal' || a.tgl_beli > per) return;
    const lepas = a.tgl_lepas && a.tgl_lepas <= per;
    const akum = akumAt_(a, susut, perYm);
    const sched = scheduleOf_(a);
    const cur = sched.filter(function (s) { return s.ym === perYm; })[0];
    const done = lastDone_(a, susut);
    const sisa = a.umur_bln ? Math.max(0, a.umur_bln - Math.max(0, ymDiff_(a.mulai_susut, done) + 1)) : 0;
    if (!lepas) { addReg(a.akun_aset, cents_(a.harga)); addReg(a.akun_akum, -akum); }
    rows.push({
      id: a.id, kode: a.kode, nama: a.nama, kategori: a.kategori, lokasi: a.lokasi, tgl_beli: a.tgl_beli, harga: a.harga, residu: a.residu,
      umur_bln: a.umur_bln, metode: a.metode, akum: lepas ? 0 : money_(akum), nilai_buku: lepas ? 0 : money_(cents_(a.harga) - akum),
      susut_bulan: cur && !lepas ? money_(cur.amt) : 0, sisa_bln: lepas ? 0 : sisa, disusutkan_sd: done < a.mulai_susut ? '' : done,
      status: lepas ? 'dilepas' : 'aktif', tgl_lepas: lepas ? a.tgl_lepas : '', habis: a.umur_bln > 0 && sisa === 0 && !lepas,
      akun_aset: a.akun_aset, akun_akum: a.akun_akum,
    });
  });
  rows.sort(function (x, y) { return x.kategori === y.kategori ? String(x.kode).localeCompare(String(y.kode)) : String(x.kategori).localeCompare(String(y.kategori)); });
  const aktif = rows.filter(function (r) { return r.status === 'aktif'; });
  const sum = function (k) { return money_(aktif.reduce(function (t, r) { return t + cents_(r[k]); }, 0)); };
  // akun aset tetap yang dipakai di register atau punya saldo
  const gl = [];
  Object.keys(accs).sort().forEach(function (k) {
    const a = accs[k];
    if (bool_(a.is_header) || String(k).indexOf('1-2') !== 0) return;
    const buku = balanceAt_(k, per);
    const r = reg[k] || 0;
    if (!buku && !r) return;
    gl.push({ akun: k, nama: a.nama, buku: money_(buku), register: money_(r), selisih: money_(buku - r) });
  });
  return {
    per: per, rows: rows, total: { harga: sum('harga'), akum: sum('akum'), nilai_buku: sum('nilai_buku'), susut_bulan: sum('susut_bulan'), jumlah: aktif.length },
    gl: gl, kategori: ASET_KATEGORI, metode: METODE_SUSUT, run: runInfo_(susut),
  };
}

function actionAssetGet_(p) {
  const a = assetRows_().filter(function (r) { return r.id === p.id; })[0];
  if (!a) throw new ApiError_('NOT_FOUND', 'Aset tidak ditemukan.');
  const susut = susutRows_();
  const done = lastDone_(a, susut);
  var akum = cents_(a.akum_awal);
  const jadwal = scheduleOf_(a).map(function (s) {
    akum += s.amt;
    return { ym: s.ym, jumlah: money_(s.amt), akum: money_(akum), nilai_buku: money_(cents_(a.harga) - akum), tercatat: s.ym <= done };
  });
  const heads = {};
  journalHeads_().forEach(function (h) { heads[h.id] = h; });
  const riwayat = susut.filter(function (s) { return s.aset_id === a.id; }).map(function (s) {
    const h = heads[s.jurnal_id] || {};
    return { periode: s.periode, dari: s.dari, sampai: s.sampai, jumlah: s.jumlah, status: s.status, sumber: s.sumber, jurnal_id: s.jurnal_id, no: h.no || '' };
  }).sort(function (x, y) { return x.periode < y.periode ? -1 : 1; });
  const kb = a.kasbank_id ? kasbankRows_().filter(function (k) { return k.id === a.kasbank_id; })[0] : null;
  return {
    aset: a, jadwal: jadwal, riwayat: riwayat, akum: money_(akumAt_(a, susut, '9999-12')), disusutkan_sd: done < a.mulai_susut ? '' : done,
    jurnal: a.jurnal_id && heads[a.jurnal_id] ? { id: a.jurnal_id, no: heads[a.jurnal_id].no } : null,
    jurnal_lepas: a.jurnal_lepas && heads[a.jurnal_lepas] ? { id: a.jurnal_lepas, no: heads[a.jurnal_lepas].no } : null,
    kasbank: kb ? kb.nama : '',
  };
}

// ---------------------------------------------------------------- catat aset

/**
 * p: { id? (ubah), kode?, nama, kategori, lokasi, catatan, tgl_beli, harga, umur_bln, residu, metode,
 *      akun_aset, akun_akum, akun_beban, sumber: kas|akun|tercatat, kasbank_id, akun_lawan, akum_awal, akum_awal_per }
 */
function actionAssetSave_(p, ctx) {
  const nama = String(p.nama || '').trim();
  if (!nama) throw new ApiError_('VALIDATION', 'Nama aset wajib diisi.');
  return withLock_(function () {
    const susut = susutRows_();
    if (p.id) {
      const a = assetRows_().filter(function (r) { return r.id === p.id; })[0];
      if (!a) throw new ApiError_('NOT_FOUND', 'Aset tidak ditemukan.');
      if (a.status === 'batal') throw new ApiError_('VALIDATION', 'Aset ini sudah dibatalkan.');
      const patch = { nama: asText_(nama), lokasi: asText_(String(p.lokasi || '').trim()), catatan: asText_(String(p.catatan || '').trim()) };
      const r = updateWhere_('T_Aset', 'id', a.id, patch);
      audit_(ctx, 'UBAH_ASET', 'T_Aset', a.kode, r.before, r.after, '');
      return { id: a.id, kode: a.kode };
    }
    const accs = accountsMap_();
    const kat = kategoriOf_(String(p.kategori || ''));
    if (!kat) throw new ApiError_('VALIDATION', 'Pilih kategori aset.');
    const tgl = ymd_(p.tgl_beli);
    if (!tgl) throw new ApiError_('VALIDATION', 'Tanggal perolehan wajib diisi.');
    const harga = cents_(p.harga || 0);
    if (harga <= 0) throw new ApiError_('VALIDATION', 'Harga perolehan harus lebih dari nol.');
    const residu = cents_(p.residu || 0);
    if (residu < 0 || residu >= harga) throw new ApiError_('VALIDATION', 'Nilai sisa harus 0 atau lebih kecil dari harga perolehan.');
    var umur = kat.kode === 'tanah' ? 0 : Number(p.umur_bln);
    if (!(umur >= 0) || Math.floor(umur) !== umur || umur > 600) throw new ApiError_('VALIDATION', 'Umur manfaat diisi dalam bulan bulat (0–600).');
    const metode = METODE_SUSUT[p.metode] ? p.metode : 'garis_lurus';
    if (metode === 'saldo_menurun' && umur && umur % 12) throw new ApiError_('VALIDATION', 'Metode saldo menurun memakai umur kelipatan 12 bulan.');
    const akunAset = String(p.akun_aset || kat.akun_aset);
    leafAccount_(accs, akunAset, 'Akun aset');
    if (accs[akunAset].tipe !== 'aset') throw new ApiError_('VALIDATION', 'Akun aset harus bertipe aset.');
    var akunAkum = '', akunBeban = '';
    if (umur > 0) {
      akunAkum = String(p.akun_akum || kat.akun_akum);
      leafAccount_(accs, akunAkum, 'Akun akumulasi penyusutan');
      if (akunAkum === akunAset) throw new ApiError_('VALIDATION', 'Akun akumulasi harus berbeda dengan akun aset.');
      akunBeban = String(p.akun_beban || AKUN_BEBAN_SUSUT);
      leafAccount_(accs, akunBeban, 'Akun beban penyusutan');
    }
    const mulai = isYm_(p.mulai_susut) ? p.mulai_susut : tgl.slice(0, 7);
    if (mulai < tgl.slice(0, 7)) throw new ApiError_('VALIDATION', 'Penyusutan tidak boleh dimulai sebelum bulan perolehan.');
    const sumber = String(p.sumber || 'kas');
    if (['kas', 'akun', 'tercatat'].indexOf(sumber) < 0) throw new ApiError_('VALIDATION', 'Cara perolehan tidak dikenal.');
    var akumAwal = 0, akumPer = '';
    if (sumber === 'tercatat') {
      akumAwal = cents_(p.akum_awal || 0);
      if (akumAwal < 0) throw new ApiError_('VALIDATION', 'Akumulasi penyusutan awal tidak boleh minus.');
      if (akumAwal > 0) {
        if (!umur) throw new ApiError_('VALIDATION', 'Aset yang tidak disusutkan tidak punya akumulasi penyusutan.');
        if (akumAwal > harga - residu) throw new ApiError_('VALIDATION', 'Akumulasi awal melebihi harga perolehan dikurangi nilai sisa.');
        akumPer = String(p.akum_awal_per || '');
        if (!isYm_(akumPer)) throw new ApiError_('VALIDATION', 'Isi bulan terakhir yang sudah termasuk di akumulasi awal.');
        if (akumPer < mulai) throw new ApiError_('VALIDATION', 'Bulan akumulasi awal tidak boleh sebelum mulai penyusutan.');
        if (akumPer > todayYmd_().slice(0, 7)) throw new ApiError_('VALIDATION', 'Bulan akumulasi awal tidak boleh di masa depan.');
      }
    }
    const id = newId_('AST');
    const kode = String(p.kode || '').trim() || formatNumber_('AT-{####}', 'PST', 0, nextNumber_('ASET', 'PST', 0));
    if (assetRows_().some(function (r) { return r.kode === kode && r.status !== 'batal'; })) throw new ApiError_('VALIDATION', 'Kode aset ' + kode + ' sudah dipakai.');
    var head = null, kb = null, trx = '', lawan = '';
    const ket = 'Perolehan aset ' + kode + ' — ' + nama;
    if (sumber === 'kas') {
      kb = pickCash_(ctx, p.kasbank_id, harga);
      lawan = kb.akun_id;
      head = postJournal_(ctx, { tgl: tgl, jenis: 'KK', keterangan: ket, referensi: kode, ref_dok: id, lines: [
        { akun_id: akunAset, memo: nama, debit: money_(harga), kredit: 0 },
        { akun_id: kb.akun_id, memo: ket, debit: 0, kredit: money_(harga) },
      ] });
      trx = writeCashTrx_(ctx, { no: head.no, tgl: tgl, kb: kb, jenis: 'keluar', akun_lawan: akunAset, jumlah: harga, keterangan: ket, referensi: kode, jurnal_id: head.id, sumber_dok: id, metode: p.metode_bayar });
    } else if (sumber === 'akun') {
      lawan = String(p.akun_lawan || '');
      leafAccount_(accs, lawan, 'Akun lawan');
      if (lawan === akunAset || lawan === akunAkum) throw new ApiError_('VALIDATION', 'Akun lawan tidak boleh sama dengan akun aset/akumulasi.');
      if (kasbankRows_().some(function (k) { return k.akun_id === lawan; })) throw new ApiError_('VALIDATION', 'Untuk pembelian tunai pilih cara "Dibayar dari kas/bank" supaya tercatat di Kas & Bank.');
      head = postJournal_(ctx, { tgl: tgl, jenis: 'JU', keterangan: ket, referensi: kode, ref_dok: id, lines: [
        { akun_id: akunAset, memo: nama, debit: money_(harga), kredit: 0 },
        { akun_id: lawan, memo: ket, debit: 0, kredit: money_(harga) },
      ] });
    }
    appendObjects_('T_Aset', [{
      id: id, kode: asText_(kode), nama: asText_(nama), kategori: kat.kode, cabang_id: '', tgl_beli: asText_(tgl), harga: money_(harga), umur_bln: umur, residu: money_(residu),
      metode: metode, akun_aset: asText_(akunAset), akun_akum: asText_(akunAkum), akun_beban: asText_(akunBeban), status: 'aktif',
      mulai_susut: asText_(mulai), akum_awal: money_(akumAwal), akum_awal_per: asText_(akumPer), sumber: sumber, akun_lawan: asText_(lawan),
      kasbank_id: kb ? kb.id : '', kasbank_trx: trx, jurnal_id: head ? head.id : '', lokasi: asText_(String(p.lokasi || '').trim()), catatan: asText_(String(p.catatan || '').trim()),
      dibuat_oleh: ctx.session.username, dibuat_pada: new Date(),
    }]);
    audit_(ctx, 'CATAT_ASET', 'T_Aset', kode, null, { nama: nama, harga: money_(harga), umur_bln: umur, sumber: sumber, jurnal: head ? head.no : '' }, '');
    return { id: id, kode: kode, no: head ? head.no : '' };
  });
}

/** Batalkan pencatatan aset (salah input). Hanya bila belum ada penyusutan tercatat. */
function actionAssetVoid_(p, ctx) {
  const alasan = String(p.alasan || '').trim();
  if (!alasan) throw new ApiError_('VALIDATION', 'Alasan pembatalan wajib diisi.');
  return withLock_(function () {
    const a = assetRows_().filter(function (r) { return r.id === p.id; })[0];
    if (!a) throw new ApiError_('NOT_FOUND', 'Aset tidak ditemukan.');
    if (a.status !== 'aktif') throw new ApiError_('VALIDATION', a.status === 'batal' ? 'Aset ini sudah dibatalkan.' : 'Batalkan pelepasan aset dulu.');
    const used = susutRows_().filter(function (s) { return s.aset_id === a.id && s.status === 'aktif'; });
    if (used.length) throw new ApiError_('VALIDATION', 'Penyusutan aset ini sudah diproses (' + used.map(function (s) { return s.periode; }).join(', ') + '). Batalkan proses penyusutan bulan itu dulu, mulai dari yang terakhir.');
    const rev = voidDocJournal_(ctx, a.jurnal_id, alasan, a.kasbank_trx);
    updateWhere_('T_Aset', 'id', a.id, { status: 'batal', alasan_batal: asText_(alasan) });
    audit_(ctx, 'BATAL', 'T_Aset', a.kode, { status: a.status }, { status: 'batal' }, alasan);
    return { id: a.id, status: 'batal', pembalik: rev ? rev.no : '' };
  });
}

// ---------------------------------------------------------------- pelepasan (jual / hapus)

/** p: { id, tgl, cara: jual|hapus, harga_jual, kasbank_id | akun_terima, keterangan } */
function actionAssetDispose_(p, ctx) {
  const tgl = ymd_(p.tgl);
  if (!tgl) throw new ApiError_('VALIDATION', 'Tanggal pelepasan wajib diisi.');
  const cara = p.cara === 'jual' ? 'jual' : 'hapus';
  return withLock_(function () {
    const a = assetRows_().filter(function (r) { return r.id === p.id; })[0];
    if (!a) throw new ApiError_('NOT_FOUND', 'Aset tidak ditemukan.');
    if (a.status !== 'aktif') throw new ApiError_('VALIDATION', 'Aset ini tidak aktif.');
    if (tgl < a.tgl_beli) throw new ApiError_('VALIDATION', 'Tanggal pelepasan sebelum tanggal perolehan.');
    const susut = susutRows_();
    const lepasYm = tgl.slice(0, 7);
    const done = lastDone_(a, susut);
    if (done >= lepasYm) throw new ApiError_('VALIDATION', 'Penyusutan aset ini sudah diproses s/d ' + done + '. Pilih tanggal sesudahnya, atau batalkan proses penyusutan bulan itu dulu.');
    const accs = accountsMap_();
    const tmp = Object.assign({}, a, { tgl_lepas: tgl });
    const due = dueOf_(tmp, susut, lepasYm);
    const akumBefore = akumAt_(a, susut, '9999-12');
    const harga = cents_(a.harga);
    const jual = cara === 'jual' ? cents_(p.harga_jual || 0) : 0;
    if (cara === 'jual' && jual <= 0) throw new ApiError_('VALIDATION', 'Isi harga jual.');
    const nb = harga - akumBefore - due.amt;
    const selisih = jual - nb;
    var kb = null, terima = '';
    if (jual > 0) {
      if (p.kasbank_id) { kb = pickCash_(ctx, p.kasbank_id, 0); terima = kb.akun_id; }
      else { terima = String(p.akun_terima || ''); leafAccount_(accs, terima, 'Akun penerimaan'); }
    }
    const ket = String(p.keterangan || '').trim() || ((cara === 'jual' ? 'Penjualan aset ' : 'Penghapusan aset ') + a.kode + ' — ' + a.nama);
    const lines = [];
    if (due.amt) lines.push({ akun_id: a.akun_beban, memo: 'Penyusutan ' + due.dari + (due.bulan > 1 ? ' s/d ' + due.sampai : '') + ' ' + a.nama, debit: money_(due.amt), kredit: 0 });
    if (jual) lines.push({ akun_id: terima, memo: ket, debit: money_(jual), kredit: 0 });
    if (akumBefore + due.amt) lines.push({ akun_id: a.akun_akum, memo: 'Akumulasi penyusutan ' + a.nama, debit: money_(akumBefore), kredit: 0 });
    if (selisih < 0) lines.push({ akun_id: AKUN_RUGI_ASET, memo: (cara === 'jual' ? 'Rugi penjualan ' : 'Rugi penghapusan ') + a.nama, debit: money_(-selisih), kredit: 0 });
    lines.push({ akun_id: a.akun_aset, memo: 'Harga perolehan ' + a.nama, debit: 0, kredit: money_(harga) });
    if (selisih > 0) lines.push({ akun_id: AKUN_LABA_ASET, memo: 'Laba penjualan ' + a.nama, debit: 0, kredit: money_(selisih) });
    // baris akumulasi: debit akumBefore (susulan sudah langsung menambah & menutup akumulasi di jurnal yang sama)
    const clean = lines.filter(function (l) { return l.debit || l.kredit; });
    const head = postJournal_(ctx, { tgl: tgl, jenis: kb ? 'KM' : 'JU', keterangan: ket, referensi: a.kode, ref_dok: a.id + '-LEPAS', lines: clean });
    var trx = '';
    if (kb) trx = writeCashTrx_(ctx, { no: head.no, tgl: tgl, kb: kb, jenis: 'masuk', akun_lawan: a.akun_aset, jumlah: jual, keterangan: ket, referensi: a.kode, jurnal_id: head.id, sumber_dok: a.id });
    if (due.amt) appendObjects_('T_Susut', [{ id: newId_('SST'), periode: asText_(lepasYm), aset_id: a.id, dari: asText_(due.dari), sampai: asText_(due.sampai), jumlah: money_(due.amt), jurnal_id: head.id, status: 'aktif', sumber: 'lepas', dibuat_oleh: ctx.session.username, dibuat_pada: new Date() }]);
    updateWhere_('T_Aset', 'id', a.id, { status: 'dilepas', tgl_lepas: asText_(tgl), harga_lepas: money_(jual), cara_lepas: cara, jurnal_lepas: head.id, kas_lepas: trx });
    audit_(ctx, cara === 'jual' ? 'JUAL_ASET' : 'HAPUS_ASET', 'T_Aset', a.kode, null, { nilai_buku: money_(nb), harga_jual: money_(jual), laba_rugi: money_(selisih), jurnal: head.no }, ket);
    return { id: a.id, no: head.no, nilai_buku: money_(nb), harga_jual: money_(jual), laba_rugi: money_(selisih), susulan: money_(due.amt) };
  });
}

function actionAssetDisposeVoid_(p, ctx) {
  const alasan = String(p.alasan || '').trim();
  if (!alasan) throw new ApiError_('VALIDATION', 'Alasan pembatalan wajib diisi.');
  return withLock_(function () {
    const a = assetRows_().filter(function (r) { return r.id === p.id; })[0];
    if (!a) throw new ApiError_('NOT_FOUND', 'Aset tidak ditemukan.');
    if (a.status !== 'dilepas') throw new ApiError_('VALIDATION', 'Aset ini tidak dalam status dilepas.');
    const rev = voidDocJournal_(ctx, a.jurnal_lepas, alasan, a.kas_lepas);
    susutRows_().forEach(function (s) { if (s.aset_id === a.id && s.jurnal_id === a.jurnal_lepas && s.status === 'aktif') updateWhere_('T_Susut', 'id', s.id, { status: 'batal' }); });
    updateWhere_('T_Aset', 'id', a.id, { status: 'aktif', tgl_lepas: '', harga_lepas: '', cara_lepas: '', jurnal_lepas: '', kas_lepas: '' });
    audit_(ctx, 'BATAL_PELEPASAN', 'T_Aset', a.kode, null, null, alasan);
    return { id: a.id, status: 'aktif', pembalik: rev ? rev.no : '' };
  });
}

// ---------------------------------------------------------------- proses penyusutan bulanan

function runInfo_(susut) {
  const runs = {};
  susut.forEach(function (s) {
    if (s.sumber !== 'run' || s.status !== 'aktif') return;
    const r = runs[s.periode] || (runs[s.periode] = { periode: s.periode, jumlah: 0, aset: 0, jurnal_id: s.jurnal_id });
    r.jumlah += cents_(s.jumlah); r.aset++;
  });
  const heads = {};
  journalHeads_().forEach(function (h) { heads[h.id] = h; });
  const list = Object.keys(runs).sort().reverse().map(function (k) {
    const r = runs[k];
    return { periode: r.periode, jumlah: money_(r.jumlah), aset: r.aset, jurnal_id: r.jurnal_id, no: (heads[r.jurnal_id] || {}).no || '', tgl: (heads[r.jurnal_id] || {}).tgl || '' };
  });
  return { terakhir: list.length ? list[0].periode : '', riwayat: list.slice(0, 36) };
}

function runPlan_(periode) {
  const susut = susutRows_();
  const info = runInfo_(susut);
  const now = todayYmd_().slice(0, 7);
  const assets = assetRows_().filter(function (a) { return a.status !== 'batal' && a.umur_bln > 0; });
  if (!periode) {
    if (info.terakhir) periode = ymAdd_(info.terakhir, 1);
    else {
      periode = now;
      assets.forEach(function (a) { const d = dueOf_(a, susut, now); if (d.dari && d.dari < periode) periode = d.dari; });
    }
  }
  if (!isYm_(periode)) throw new ApiError_('VALIDATION', 'Periode tidak valid.');
  const lines = [];
  assets.forEach(function (a) {
    if (a.tgl_beli.slice(0, 7) > periode) return;
    const d = dueOf_(a, susut, periode);
    if (!d.amt) return;
    lines.push({ aset_id: a.id, kode: a.kode, nama: a.nama, kategori: a.kategori, akun_beban: a.akun_beban, akun_akum: a.akun_akum,
      jumlah: d.amt, bulan: d.bulan, dari: d.dari, sampai: d.sampai, susulan: d.bulan > 1 || d.sampai < periode });
  });
  const blockers = [];
  if (info.terakhir && periode <= info.terakhir) blockers.push('Penyusutan sudah diproses s/d ' + info.terakhir + '.');
  if (periode > now) blockers.push('Bulan ' + periode + ' belum berjalan.');
  if (periodStatus_(periode) !== 'buka') blockers.push('Periode ' + periode + ' sudah dikunci/ditutup.');
  if (!lines.length && !blockers.length) blockers.push('Tidak ada penyusutan yang jatuh tempo s/d ' + periode + '.');
  const lewat = info.terakhir && periode > ymAdd_(info.terakhir, 1);
  return { periode: periode, tgl: monthEnd_(periode), lines: lines, total: lines.reduce(function (t, l) { return t + l.jumlah; }, 0), blockers: blockers,
    lewat: lewat ? ymAdd_(info.terakhir, 1) + (ymAdd_(info.terakhir, 1) === ymAdd_(periode, -1) ? '' : ' s/d ' + ymAdd_(periode, -1)) : '', info: info };
}

function actionAssetRunPreview_(p) {
  const plan = runPlan_(p.periode ? ym_(p.periode) : '');
  return {
    periode: plan.periode, tgl: plan.tgl, total: money_(plan.total), blockers: plan.blockers, lewat: plan.lewat,
    lines: plan.lines.map(function (l) { const o = Object.assign({}, l); o.jumlah = money_(l.jumlah); return o; }),
    terakhir: plan.info.terakhir, riwayat: plan.info.riwayat,
  };
}

function actionAssetRun_(p, ctx) {
  return withLock_(function () {
    const plan = runPlan_(ym_(p.periode));
    if (plan.blockers.length) throw new ApiError_('VALIDATION', plan.blockers[0]);
    // satu baris per pasangan akun beban/akumulasi supaya jurnal ringkas
    const dr = {}, cr = {};
    plan.lines.forEach(function (l) { dr[l.akun_beban] = (dr[l.akun_beban] || 0) + l.jumlah; cr[l.akun_akum] = (cr[l.akun_akum] || 0) + l.jumlah; });
    const jl = [];
    Object.keys(dr).sort().forEach(function (k) { jl.push({ akun_id: k, memo: 'Penyusutan ' + plan.periode, debit: money_(dr[k]), kredit: 0 }); });
    Object.keys(cr).sort().forEach(function (k) { jl.push({ akun_id: k, memo: 'Akumulasi penyusutan ' + plan.periode, debit: 0, kredit: money_(cr[k]) }); });
    const head = postJournal_(ctx, { tgl: plan.tgl, jenis: 'JP', keterangan: 'Penyusutan aset tetap ' + plan.periode + ' (' + plan.lines.length + ' aset)',
      referensi: 'SUSUT-' + plan.periode, ref_dok: 'SUSUT-' + plan.periode, lines: jl });
    const now = new Date();
    appendObjects_('T_Susut', plan.lines.map(function (l) {
      return { id: newId_('SST'), periode: asText_(plan.periode), aset_id: l.aset_id, dari: asText_(l.dari), sampai: asText_(l.sampai), jumlah: money_(l.jumlah),
        jurnal_id: head.id, status: 'aktif', sumber: 'run', dibuat_oleh: ctx.session.username, dibuat_pada: now };
    }));
    audit_(ctx, 'PROSES_PENYUSUTAN', 'T_Susut', plan.periode, null, { aset: plan.lines.length, total: money_(plan.total), jurnal: head.no }, '');
    return { periode: plan.periode, no: head.no, total: money_(plan.total), aset: plan.lines.length };
  });
}

function actionAssetRunVoid_(p, ctx) {
  const alasan = String(p.alasan || '').trim();
  if (!alasan) throw new ApiError_('VALIDATION', 'Alasan pembatalan wajib diisi.');
  return withLock_(function () {
    const susut = susutRows_();
    const info = runInfo_(susut);
    const periode = ym_(p.periode);
    if (!info.terakhir || info.terakhir !== periode) throw new ApiError_('VALIDATION', 'Hanya proses penyusutan terakhir (' + (info.terakhir || '—') + ') yang bisa dibatalkan.');
    const rows = susut.filter(function (s) { return s.sumber === 'run' && s.status === 'aktif' && s.periode === periode; });
    const jid = rows[0].jurnal_id;
    const disposedAfter = assetRows_().filter(function (a) {
      return a.status === 'dilepas' && rows.some(function (s) { return s.aset_id === a.id; });
    });
    if (disposedAfter.length) throw new ApiError_('VALIDATION', 'Aset ' + disposedAfter[0].kode + ' sudah dilepas sesudah proses ini. Batalkan pelepasannya dulu.');
    const rev = voidDocJournal_(ctx, jid, alasan, '');
    rows.forEach(function (s) { updateWhere_('T_Susut', 'id', s.id, { status: 'batal' }); });
    audit_(ctx, 'BATAL_PENYUSUTAN', 'T_Susut', periode, null, null, alasan);
    return { periode: periode, pembalik: rev ? rev.no : '' };
  });
}

// ---------------------------------------------------------------- mutasi untuk CALK

/** Mutasi aset tetap per kategori dalam tahun buku [fs, fe] (sen). */
function assetMovement_(fs, fe) {
  const assets = assetRows_().filter(function (a) { return a.status !== 'batal'; });
  if (!assets.length) return null;
  const susut = susutRows_();
  const prevYm = ymAdd_(fs.slice(0, 7), -1);
  const feYm = fe.slice(0, 7);
  const by = {};
  ASET_KATEGORI.forEach(function (k) { by[k.kode] = { kategori: k.nama, awal: 0, tambah: 0, kurang: 0, akhir: 0, akum_awal: 0, susut: 0, akum_kurang: 0, akum_akhir: 0 }; });
  assets.forEach(function (a) {
    const r = by[a.kategori] || (by[a.kategori] = { kategori: a.kategori, awal: 0, tambah: 0, kurang: 0, akhir: 0, akum_awal: 0, susut: 0, akum_kurang: 0, akum_akhir: 0 });
    if (a.tgl_beli > fe) return;
    if (a.tgl_lepas && a.tgl_lepas < fs) return;
    const h = cents_(a.harga);
    const existed = a.tgl_beli < fs;
    if (existed) { r.awal += h; r.akum_awal += akumAt_(a, susut, prevYm); }
    else r.tambah += h;
    var dep = 0;
    susut.forEach(function (s) { if (s.aset_id === a.id && s.status === 'aktif' && s.periode >= fs.slice(0, 7) && s.periode <= feYm) dep += cents_(s.jumlah); });
    if (!existed) dep += cents_(a.akum_awal); // akumulasi bawaan aset yang dicatat di tahun ini
    r.susut += dep;
    if (a.tgl_lepas && a.tgl_lepas <= fe) {
      r.kurang += h;
      r.akum_kurang += akumAt_(a, susut, '9999-12');
    }
  });
  const rows = Object.keys(by).map(function (k) { return by[k]; }).filter(function (r) { return r.awal || r.tambah || r.kurang || r.akum_awal || r.susut; });
  rows.forEach(function (r) { r.akhir = r.awal + r.tambah - r.kurang; r.akum_akhir = r.akum_awal + r.susut - r.akum_kurang; });
  const tot = { kategori: 'Jumlah' };
  ['awal', 'tambah', 'kurang', 'akhir', 'akum_awal', 'susut', 'akum_kurang', 'akum_akhir'].forEach(function (k) { tot[k] = rows.reduce(function (t, r) { return t + r[k]; }, 0); });
  const out = rows.concat([tot]).map(function (r) {
    const o = { kategori: r.kategori };
    Object.keys(r).forEach(function (k) { if (k !== 'kategori') o[k] = money_(r[k]); });
    o.nilai_buku = money_(r.akhir - r.akum_akhir);
    return o;
  });
  return out;
}
