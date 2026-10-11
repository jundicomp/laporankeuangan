/**
 * Kas & Bank — rekening, pemasukan, pengeluaran, transfer.
 * Setiap transaksi otomatis menjadi jurnal lewat postJournal_ (KM / KK / TR).
 */

const CASH_TYPES = { masuk: 'KM', keluar: 'KK', transfer: 'TR' };
const CASH_METHODS = ['tunai', 'transfer', 'qris', 'kartu', 'cek/giro', 'lainnya'];

function kasbankRows_() {
  return readTable_('M_KasBank').map(function (r) {
    r.akun_id = String(r.akun_id);
    r.no_rek = String(r.no_rek || '');
    r.aktif = r.aktif === '' ? true : bool_(r.aktif);
    return r;
  });
}

function canSeeAccount_(session, kb) {
  return kb.jenis !== 'bank' || hasPerm_(session, 'bank.saldo');
}

/** Saldo akun (sen, arah saldo normal debit) per tanggal. */
function balanceAt_(kode, to) {
  const eff = effectiveIds_();
  var c = 0;
  journalLines_().forEach(function (d) {
    if (eff.ids[d.jurnal_id] && d.akun_id === kode && eff.heads[d.jurnal_id].tgl <= to) c += cents_(d.debit) - cents_(d.kredit);
  });
  return c;
}

function actionKasbankList_(p, ctx) {
  const to = p.to ? ymd_(p.to) : '9999-12-31';
  const eff = effectiveIds_();
  const sums = {};
  journalLines_().forEach(function (d) {
    if (eff.ids[d.jurnal_id] && eff.heads[d.jurnal_id].tgl <= to) sums[d.akun_id] = (sums[d.akun_id] || 0) + cents_(d.debit) - cents_(d.kredit);
  });
  return kasbankRows_().filter(function (k) { return canSeeAccount_(ctx.session, k); }).map(function (k) {
    k.saldo = money_(sums[k.akun_id] || 0);
    return k;
  });
}

function nextCashAccountCode_() {
  const accs = readTable_('M_Akun').map(function (a) { return String(a.kode); });
  var n = 1101;
  while (accs.indexOf('1-' + n) >= 0) n++;
  if (n > 1299) throw new ApiError_('VALIDATION', 'Nomor akun kas/bank (1-1101 s/d 1-1299) sudah penuh.');
  return '1-' + n;
}

function actionKasbankSave_(p, ctx) {
  const nama = String(p.nama || '').trim();
  if (!nama) throw new ApiError_('VALIDATION', 'Nama rekening wajib diisi.');
  if (['kas', 'bank', 'kas_kecil'].indexOf(p.jenis) < 0) throw new ApiError_('VALIDATION', 'Jenis harus kas, bank, atau kas kecil.');
  return withLock_(function () {
    const rows = kasbankRows_();
    if (rows.some(function (r) { return r.nama.toLowerCase() === nama.toLowerCase() && r.id !== p.id; })) throw new ApiError_('VALIDATION', 'Nama rekening sudah dipakai.');
    var akun = String(p.akun_id || '');
    if (!p.id && p.buatAkun) {
      akun = nextCashAccountCode_();
      appendObjects_('M_Akun', [{ kode: asText_(akun), nama: nama, tipe: 'aset', saldo_normal: 'D', parent: asText_('1-1'), is_header: false, aktif: true }]);
      audit_(ctx, 'BUAT', 'M_Akun', akun, null, { kode: akun, nama: nama }, 'otomatis dari rekening kas/bank');
    }
    const acc = accountsMap_()[akun];
    if (!acc || bool_(acc.is_header) || acc.tipe !== 'aset') throw new ApiError_('VALIDATION', 'Pilih akun aset (bukan header) untuk rekening ini.');
    if (rows.some(function (r) { return r.akun_id === akun && r.id !== p.id; })) throw new ApiError_('VALIDATION', 'Akun ' + akun + ' sudah dipakai rekening lain.');
    const o = { nama: asText_(nama), jenis: p.jenis, no_rek: asText_(String(p.no_rek || '').trim()), akun_id: asText_(akun), aktif: p.aktif !== false };
    if (p.id) {
      const old = rows.filter(function (r) { return r.id === p.id; })[0];
      if (!old) throw new ApiError_('NOT_FOUND', 'Rekening tidak ditemukan.');
      if (old.akun_id !== akun && balanceAt_(old.akun_id, '9999-12-31') !== 0) throw new ApiError_('VALIDATION', 'Rekening sudah bersaldo, akun COA-nya tidak bisa diganti.');
      if (o.aktif === false && balanceAt_(old.akun_id, '9999-12-31') !== 0) throw new ApiError_('VALIDATION', 'Rekening masih bersaldo, tidak bisa dinonaktifkan.');
      const r = updateWhere_('M_KasBank', 'id', p.id, o);
      audit_(ctx, 'UBAH', 'M_KasBank', p.id, r.before, r.after, '');
    } else {
      o.id = newId_('KB');
      appendObjects_('M_KasBank', [o]);
      audit_(ctx, 'BUAT', 'M_KasBank', o.id, null, { nama: nama, jenis: p.jenis, akun_id: akun }, '');
    }
    return kasbankRows_();
  });
}

// ---------------------------------------------------------------- transaksi

function cashRows_() {
  return readTable_('T_KasBank').map(function (r) {
    r.tgl = ymd_(r.tgl);
    r.jumlah = Number(r.jumlah) || 0;
    try { r.lines = JSON.parse(r.lines_json || '[]'); } catch (e) { r.lines = []; }
    delete r.lines_json;
    r.status = r.status || 'posted';
    return r;
  });
}

function actionCashList_(p, ctx) {
  const visible = {};
  kasbankRows_().forEach(function (k) { if (canSeeAccount_(ctx.session, k)) visible[k.id] = k; });
  var rows = cashRows_().filter(function (r) { return visible[r.kasbank_id] || visible[r.kasbank_tujuan]; });
  if (p.kasbank_id) rows = rows.filter(function (r) { return r.kasbank_id === p.kasbank_id || r.kasbank_tujuan === p.kasbank_id; });
  if (p.from) rows = rows.filter(function (r) { return r.tgl >= p.from; });
  if (p.to) rows = rows.filter(function (r) { return r.tgl <= p.to; });
  if (p.jenis) rows = rows.filter(function (r) { return r.jenis === p.jenis; });
  if (p.q) {
    const q = String(p.q).toLowerCase();
    rows = rows.filter(function (r) { return (r.no + ' ' + r.keterangan + ' ' + r.kontak_nama + ' ' + r.referensi).toLowerCase().indexOf(q) >= 0; });
  }
  rows.sort(function (a, b) { return a.tgl < b.tgl ? 1 : a.tgl > b.tgl ? -1 : String(b.dibuat_pada).localeCompare(String(a.dibuat_pada)); });
  const limit = Math.min(Number(p.limit) || 50, 200);
  const offset = Number(p.offset) || 0;
  return { total: rows.length, rows: rows.slice(offset, offset + limit) };
}

function actionCashSave_(p, ctx) {
  const jenis = String(p.jenis);
  const jj = CASH_TYPES[jenis];
  if (!jj) throw new ApiError_('VALIDATION', 'Jenis transaksi tidak dikenal.');
  const tgl = ymd_(p.tgl);
  if (!tgl) throw new ApiError_('VALIDATION', 'Tanggal wajib diisi.');
  const ket = String(p.keterangan || '').trim();
  if (!ket) throw new ApiError_('VALIDATION', 'Keterangan wajib diisi.');
  const metode = String(p.metode || 'tunai');
  if (CASH_METHODS.indexOf(metode) < 0) throw new ApiError_('VALIDATION', 'Metode pembayaran tidak dikenal.');

  return withLock_(function () {
    const kbs = {};
    kasbankRows_().forEach(function (k) { kbs[k.id] = k; });
    const src = kbs[p.kasbank_id];
    if (!src || !src.aktif) throw new ApiError_('VALIDATION', 'Pilih rekening kas/bank yang aktif.');
    if (!canSeeAccount_(ctx.session, src)) throw new ApiError_('FORBIDDEN', 'Peran Anda tidak punya akses ke rekening bank ini.');
    var journalLines;
    var total = 0;
    var lines = [];
    var dst = null;
    if (jenis === 'transfer') {
      dst = kbs[p.kasbank_tujuan];
      if (!dst || !dst.aktif) throw new ApiError_('VALIDATION', 'Pilih rekening tujuan yang aktif.');
      if (dst.id === src.id) throw new ApiError_('VALIDATION', 'Rekening asal dan tujuan tidak boleh sama.');
      if (!canSeeAccount_(ctx.session, dst)) throw new ApiError_('FORBIDDEN', 'Peran Anda tidak punya akses ke rekening tujuan.');
      total = cents_(p.jumlah);
      if (total <= 0) throw new ApiError_('VALIDATION', 'Jumlah transfer harus lebih dari nol.');
      journalLines = [
        { akun_id: dst.akun_id, memo: ket, debit: money_(total), kredit: 0 },
        { akun_id: src.akun_id, memo: ket, debit: 0, kredit: money_(total) },
      ];
    } else {
      const accs = accountsMap_();
      const cashAccs = {};
      Object.keys(kbs).forEach(function (k) { cashAccs[kbs[k].akun_id] = true; });
      (p.lines || []).forEach(function (l, i) {
        const akun = String(l.akun_id || '').trim();
        const amt = cents_(l.jumlah || 0);
        if (!akun && !amt) return;
        if (!akun) throw new ApiError_('VALIDATION', 'Baris ' + (i + 1) + ': akun belum dipilih.');
        if (!accs[akun] || bool_(accs[akun].is_header)) throw new ApiError_('VALIDATION', 'Baris ' + (i + 1) + ': akun ' + akun + ' tidak valid.');
        if (cashAccs[akun]) throw new ApiError_('VALIDATION', 'Baris ' + (i + 1) + ': untuk memindahkan uang antar rekening gunakan Transfer.');
        if (amt <= 0) throw new ApiError_('VALIDATION', 'Baris ' + (i + 1) + ': jumlah harus lebih dari nol.');
        lines.push({ akun_id: akun, memo: String(l.memo || '').slice(0, 200), jumlah: amt });
        total += amt;
      });
      if (!lines.length) throw new ApiError_('VALIDATION', 'Isi minimal satu baris rincian.');
      const cashSide = { akun_id: src.akun_id, memo: ket, debit: jenis === 'masuk' ? money_(total) : 0, kredit: jenis === 'keluar' ? money_(total) : 0 };
      const detail = lines.map(function (l) {
        return { akun_id: l.akun_id, memo: l.memo || ket, debit: jenis === 'keluar' ? money_(l.jumlah) : 0, kredit: jenis === 'masuk' ? money_(l.jumlah) : 0 };
      });
      journalLines = jenis === 'masuk' ? [cashSide].concat(detail) : detail.concat([cashSide]);
    }
    // uang tunai tidak boleh minus
    if ((jenis === 'keluar' || jenis === 'transfer') && src.jenis !== 'bank') {
      const saldo = balanceAt_(src.akun_id, '9999-12-31');
      if (saldo - total < 0) {
        throw new ApiError_('INSUFFICIENT', 'Saldo ' + src.nama + ' tidak cukup (saldo ' + money_(saldo).toLocaleString('id-ID') + ', keluar ' + money_(total).toLocaleString('id-ID') + ').');
      }
    }
    const id = newId_('KB' + jj);
    const head = postJournal_(ctx, { tgl: tgl, jenis: jj, keterangan: ket, referensi: p.referensi || '', ref_dok: id, lines: journalLines });
    const row = {
      id: id, no: head.no, tgl: asText_(tgl), kasbank_id: src.id, kasbank_tujuan: dst ? dst.id : '', jenis: jenis, metode: metode,
      kontak_tipe: p.kontak_tipe || '', kontak_id: p.kontak_id || '', kontak_nama: asText_(String(p.kontak_nama || '').trim()),
      akun_lawan: lines.length === 1 ? asText_(lines[0].akun_id) : '', jumlah: money_(total), keterangan: asText_(ket), referensi: asText_(String(p.referensi || '').trim()),
      lines_json: JSON.stringify(lines.map(function (l) { return { akun_id: l.akun_id, memo: l.memo, jumlah: money_(l.jumlah) }; })),
      rekon: false, jurnal_id: head.id, status: 'posted', dibuat_oleh: ctx.session.username, dibuat_pada: new Date(),
    };
    appendObjects_('T_KasBank', [row]);
    return { id: id, no: head.no, jumlah: money_(total) };
  });
}

function actionCashVoid_(p, ctx) {
  const alasan = String(p.alasan || '').trim();
  if (!alasan) throw new ApiError_('VALIDATION', 'Alasan pembatalan wajib diisi.');
  return withLock_(function () {
    const r = cashRows_().filter(function (x) { return x.id === p.id; })[0];
    if (!r) throw new ApiError_('NOT_FOUND', 'Transaksi tidak ditemukan.');
    if (r.status === 'batal') throw new ApiError_('VALIDATION', 'Transaksi ini sudah dibatalkan.');
    if (r.sumber_dok) throw new ApiError_('VALIDATION', 'Transaksi ini pelunasan invoice ' + (r.referensi || '') + '. Batalkan dari menu Penjualan/Piutang supaya sisa tagihan ikut kembali.');
    if (bool_(r.rekon)) throw new ApiError_('VALIDATION', 'Transaksi sudah direkonsiliasi dengan rekening koran.');
    const j = actionJournalGet_({ id: r.jurnal_id });
    assertOpen_(j.tgl);
    const linesC = j.lines.map(function (l) { return { akun_id: l.akun_id, memo: l.memo, debit: cents_(l.debit), kredit: cents_(l.kredit) }; });
    const rev = reverseJournal_(ctx, j, linesC, j.tgl, 'Pembatalan ' + j.no + ': ' + alasan, true);
    const now = new Date();
    updateWhere_('T_Jurnal', 'id', j.id, { status: 'batal', alasan_batal: alasan, dibatalkan_oleh: ctx.session.username, dibatalkan_pada: now });
    const u = updateWhere_('T_KasBank', 'id', r.id, { status: 'batal', alasan_batal: alasan });
    audit_(ctx, 'BATAL', 'T_KasBank', r.no, u.before, u.after, alasan);
    return { id: r.id, status: 'batal', pembalik: rev.no };
  });
}
