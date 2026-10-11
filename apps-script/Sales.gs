/**
 * Sales — invoice penjualan, pelunasan piutang bertahap, umur piutang, penagihan.
 *
 * Posting invoice  : Dr Piutang (total) · Dr Potongan penjualan (diskon) · Cr Pendapatan per akun · Cr PPN keluaran
 * Pelunasan        : Dr Kas/Bank (diterima) · Dr akun potongan (PPh 23 dipotong, biaya admin…) · Cr Piutang
 * Semua jurnal lewat postJournal_ dengan ref_dok, jadi hanya bisa dibatalkan dari dokumennya.
 * Invoice saldo awal: piutang lama yang sudah masuk saldo awal — tercatat di buku piutang tanpa jurnal baru.
 */

const AKUN_PIUTANG = '1-1301';
const AKUN_PPN_KELUARAN = '2-1201';
const AKUN_POTONGAN_JUAL = '4-1902';
const AKUN_JUAL_BARANG = '4-1101';
const AKUN_JUAL_JASA = '4-1201';
const AGING_BUCKETS = [
  { key: 'belum', label: 'Belum jatuh tempo' },
  { key: 'd30', label: '1–30 hari' },
  { key: 'd60', label: '31–60 hari' },
  { key: 'd90', label: '61–90 hari' },
  { key: 'd90p', label: '> 90 hari' },
];

function todayYmd_() {
  return ymd_(new Date());
}

function addDays_(ymd, n) {
  const d = new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween_(a, b) {
  const pa = Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)));
  const pb = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)));
  return Math.round((pb - pa) / 86400000);
}

// ---------------------------------------------------------------- baca

function invoiceRows_() {
  return readTable_('T_Dokumen').filter(function (r) { return r.jenis === 'INV'; }).map(function (r) {
    r.tgl = ymd_(r.tgl);
    r.jatuh_tempo = r.jatuh_tempo ? ymd_(r.jatuh_tempo) : r.tgl;
    ['subtotal', 'diskon', 'diskon_nota', 'pajak', 'total', 'sisa', 'ppn_tarif'].forEach(function (k) { r[k] = Number(r[k]) || 0; });
    r.saldo_awal = bool_(r.saldo_awal);
    r.no = String(r.no || '');
    r.referensi = String(r.referensi || '');
    try { r.lines = JSON.parse(r.lines_json || '[]'); } catch (e) { r.lines = []; }
    delete r.lines_json;
    return r;
  });
}

function paymentRows_() {
  return readTable_('T_Pembayaran').map(function (r) {
    r.tgl = ymd_(r.tgl);
    r.jumlah = Number(r.jumlah) || 0;
    r.potongan = Number(r.potongan) || 0;
    r.akun_potongan = String(r.akun_potongan || '');
    r.status = r.status || 'posted';
    return r;
  });
}

/** Status pembayaran untuk tampilan: draft · batal · lunas · sebagian · belum (+ flag lewat jatuh tempo). */
function payState_(inv, today) {
  if (inv.status === 'draft' || inv.status === 'batal') return inv.status;
  if (inv.sisa <= 0) return 'lunas';
  return inv.sisa < inv.total ? 'sebagian' : 'belum';
}

function decorate_(inv, today) {
  inv.bayar = payState_(inv, today);
  inv.terlambat = (inv.bayar === 'belum' || inv.bayar === 'sebagian') && inv.jatuh_tempo < today ? daysBetween_(inv.jatuh_tempo, today) : 0;
  return inv;
}

function customersMap_() {
  const m = {};
  masterRows_(MASTER.pelanggan).forEach(function (c) { c.batas_kredit = Number(c.batas_kredit) || 0; c.top_hari = Number(c.top_hari) || 0; m[c.id] = c; });
  return m;
}

function outstandingOf_(pelangganId, exceptId) {
  return invoiceRows_().filter(function (r) { return r.pihak_id === pelangganId && r.status === 'posted' && r.id !== exceptId; })
    .reduce(function (s, r) { return s + cents_(r.sisa); }, 0);
}

function actionSalesList_(p) {
  const today = todayYmd_();
  var rows = invoiceRows_().map(function (r) { return decorate_(r, today); });
  if (p.pelanggan_id) rows = rows.filter(function (r) { return r.pihak_id === p.pelanggan_id; });
  if (p.from) rows = rows.filter(function (r) { return r.tgl >= p.from; });
  if (p.to) rows = rows.filter(function (r) { return r.tgl <= p.to; });
  if (p.q) {
    const q = String(p.q).toLowerCase();
    rows = rows.filter(function (r) { return (r.no + ' ' + r.pihak_nama + ' ' + r.referensi + ' ' + r.catatan).toLowerCase().indexOf(q) >= 0; });
  }
  const sum = { total: 0, sisa: 0, terlambat: 0, n: 0 };
  rows.forEach(function (r) {
    if (r.status !== 'posted') return;
    sum.n++;
    sum.total += cents_(r.total);
    sum.sisa += cents_(r.sisa);
    if (r.terlambat) sum.terlambat += cents_(r.sisa);
  });
  if (p.status === 'terlambat') rows = rows.filter(function (r) { return r.terlambat > 0; });
  else if (p.status === 'terbuka') rows = rows.filter(function (r) { return r.bayar === 'belum' || r.bayar === 'sebagian'; });
  else if (p.status) rows = rows.filter(function (r) { return r.bayar === p.status; });
  rows.sort(function (a, b) {
    if (a.tgl !== b.tgl) return a.tgl < b.tgl ? 1 : -1;
    return String(b.no || b.dibuat_pada).localeCompare(String(a.no || a.dibuat_pada));
  });
  const limit = Math.min(Number(p.limit) || 50, 200);
  const offset = Number(p.offset) || 0;
  rows.forEach(function (r) { delete r.lines; });
  return {
    total: rows.length, rows: rows.slice(offset, offset + limit),
    summary: { n: sum.n, total: money_(sum.total), sisa: money_(sum.sisa), terlambat: money_(sum.terlambat) },
  };
}

function actionSalesGet_(p) {
  const today = todayYmd_();
  const inv = invoiceRows_().filter(function (r) { return r.id === p.id; })[0];
  if (!inv) throw new ApiError_('NOT_FOUND', 'Invoice tidak ditemukan.');
  decorate_(inv, today);
  inv.pembayaran = paymentRows_().filter(function (r) { return r.dok_id === inv.id; })
    .sort(function (a, b) { return a.tgl < b.tgl ? -1 : a.tgl > b.tgl ? 1 : 0; });
  inv.penagihan = readTable_('T_Penagihan').filter(function (r) { return r.dok_id === inv.id; })
    .map(function (r) { r.tgl = ymd_(r.tgl); return r; }).reverse();
  const c = customersMap_()[inv.pihak_id];
  inv.pelanggan = c ? { id: c.id, kode: c.kode, nama: c.nama, npwp: c.npwp, alamat: c.alamat, telepon: c.telepon, email: c.email } : null;
  return inv;
}

/** Ringkasan piutang satu pelanggan untuk form invoice (peringatan batas kredit & tunggakan). */
function actionArCustomer_(p) {
  const today = todayYmd_();
  const c = customersMap_()[p.pelanggan_id];
  if (!c) throw new ApiError_('NOT_FOUND', 'Pelanggan tidak ditemukan.');
  var sisa = 0, telat = 0, nTelat = 0;
  invoiceRows_().forEach(function (r) {
    if (r.pihak_id !== c.id || r.status !== 'posted' || r.sisa <= 0) return;
    sisa += cents_(r.sisa);
    if (r.jatuh_tempo < today) { telat += cents_(r.sisa); nTelat++; }
  });
  return { id: c.id, nama: c.nama, batas_kredit: c.batas_kredit, top_hari: c.top_hari, piutang: money_(sisa), terlambat: money_(telat), n_terlambat: nTelat };
}

// ---------------------------------------------------------------- simpan & posting

/** Hitung ulang semua angka invoice dari baris (sen). Server tidak percaya angka total dari browser. */
function computeInvoice_(p, accs, products) {
  const lines = [];
  (p.lines || []).forEach(function (l, i) {
    const desk = String(l.deskripsi || '').trim();
    const hasAny = desk || l.produk_id || Number(l.harga) || Number(l.qty);
    if (!hasAny) return;
    const n = i + 1;
    const qty = Number(String(l.qty === undefined ? 1 : l.qty).replace(',', '.'));
    if (!isFinite(qty) || qty <= 0) throw new ApiError_('VALIDATION', 'Baris ' + n + ': kuantitas harus lebih dari nol.');
    const harga = cents_(l.harga || 0);
    if (harga < 0) throw new ApiError_('VALIDATION', 'Baris ' + n + ': harga tidak boleh minus.');
    const gross = Math.round(qty * harga);
    const disc = cents_(l.diskon || 0);
    if (disc < 0 || disc > gross) throw new ApiError_('VALIDATION', 'Baris ' + n + ': diskon tidak boleh minus atau melebihi jumlah baris.');
    const prod = l.produk_id ? products[l.produk_id] : null;
    if (l.produk_id && !prod) throw new ApiError_('VALIDATION', 'Baris ' + n + ': produk tidak ditemukan.');
    if (!desk && !prod) throw new ApiError_('VALIDATION', 'Baris ' + n + ': isi deskripsi barang/jasa.');
    var akun = String(l.akun_id || '').trim() || (prod && prod.akun_penjualan) || (prod && prod.tipe === 'barang' ? AKUN_JUAL_BARANG : AKUN_JUAL_JASA);
    const acc = accs[akun];
    if (!acc || bool_(acc.is_header) || acc.tipe !== 'pendapatan') throw new ApiError_('VALIDATION', 'Baris ' + n + ': akun pendapatan ' + akun + ' tidak valid.');
    lines.push({
      produk_id: l.produk_id || '', deskripsi: desk || prod.nama, qty: qty, satuan: String(l.satuan || (prod && prod.satuan) || '').trim(),
      harga: money_(harga), diskon: money_(disc), jumlah: money_(gross - disc), akun_id: akun, _gross: gross, _disc: disc,
    });
  });
  const subtotal = lines.reduce(function (s, l) { return s + l._gross; }, 0);
  const discLines = lines.reduce(function (s, l) { return s + l._disc; }, 0);
  const discNota = cents_(p.diskon_nota || 0);
  if (discNota < 0) throw new ApiError_('VALIDATION', 'Diskon nota tidak boleh minus.');
  const dpp = subtotal - discLines - discNota;
  if (lines.length && dpp < 0) throw new ApiError_('VALIDATION', 'Diskon melebihi nilai penjualan.');
  const tarif = Number(p.ppn_tarif) || 0;
  if (tarif < 0 || tarif > 100) throw new ApiError_('VALIDATION', 'Tarif PPN tidak valid.');
  const pajak = tarif ? Math.round(dpp * tarif / 100) : 0;
  return { lines: lines, subtotal: subtotal, diskon: discLines + discNota, discNota: discNota, dpp: dpp, pajak: pajak, tarif: tarif, total: dpp + pajak };
}

function invoiceNumber_(tgl) {
  const year = Number(tgl.slice(0, 4));
  const n = nextNumber_('INV', 'PST', year);
  const fmt = getSetting_('format_nomor_invoice') || 'INV/{YYYY}/{MM}/{####}';
  return formatNumber_(String(fmt).replace('{MM}', tgl.slice(5, 7)), 'PST', year, n);
}

/**
 * p: { id?, tgl, pelanggan_id, jatuh_tempo?, referensi, catatan, ppn_tarif, diskon_nota, lines[], post:boolean,
 *      saldo_awal?:boolean, no_asal?, total? (khusus saldo awal), lewatiBatas?:boolean }
 */
function actionSalesSave_(p, ctx) {
  const tgl = ymd_(p.tgl);
  if (!tgl) throw new ApiError_('VALIDATION', 'Tanggal invoice wajib diisi.');
  return withLock_(function () {
    const custs = customersMap_();
    const c = custs[p.pelanggan_id];
    if (!c) throw new ApiError_('VALIDATION', 'Pilih pelanggan.');
    if (!c.aktif) throw new ApiError_('VALIDATION', 'Pelanggan ' + c.nama + ' nonaktif.');
    const accs = accountsMap_();
    const products = {};
    masterRows_(MASTER.produk).forEach(function (x) { products[x.id] = x; });
    const old = p.id ? invoiceRows_().filter(function (r) { return r.id === p.id; })[0] : null;
    if (p.id && !old) throw new ApiError_('NOT_FOUND', 'Invoice tidak ditemukan.');
    if (old && old.status !== 'draft') throw new ApiError_('VALIDATION', 'Invoice yang sudah diposting tidak bisa diubah. Batalkan lalu buat ulang.');

    const jt = p.jatuh_tempo ? ymd_(p.jatuh_tempo) : addDays_(tgl, c.top_hari || Number(getSetting_('top_default') || 0));
    if (jt < tgl) throw new ApiError_('VALIDATION', 'Jatuh tempo tidak boleh sebelum tanggal invoice.');
    const piutangAcc = c.akun_piutang && accs[c.akun_piutang] ? c.akun_piutang : AKUN_PIUTANG;
    const saldoAwal = !!p.saldo_awal;
    var calc;
    if (saldoAwal) {
      const amt = cents_(p.total || 0);
      if (amt <= 0) throw new ApiError_('VALIDATION', 'Isi sisa piutang yang belum dibayar.');
      if (!String(p.no_asal || '').trim()) throw new ApiError_('VALIDATION', 'Isi nomor invoice lama.');
      calc = { lines: [{ deskripsi: String(p.catatan || 'Saldo awal piutang').trim(), qty: 1, satuan: '', harga: money_(amt), diskon: 0, jumlah: money_(amt), akun_id: '' }],
        subtotal: amt, diskon: 0, discNota: 0, dpp: amt, pajak: 0, tarif: 0, total: amt };
    } else {
      calc = computeInvoice_(p, accs, products);
      if (p.post && !calc.lines.length) throw new ApiError_('VALIDATION', 'Isi minimal satu baris barang/jasa.');
      if (p.post && calc.total <= 0) throw new ApiError_('VALIDATION', 'Total invoice harus lebih dari nol.');
    }

    // batas kredit — peringatan yang bisa dilewati secara sadar
    if (p.post && !saldoAwal && c.batas_kredit > 0 && !p.lewatiBatas) {
      const out = outstandingOf_(c.id, p.id);
      if (out + calc.total > cents_(c.batas_kredit)) {
        throw new ApiError_('CREDIT_LIMIT', 'Piutang ' + c.nama + ' akan menjadi Rp ' + formatRp_(out + calc.total) +
          ', melewati batas kredit Rp ' + formatRp_(cents_(c.batas_kredit)) + '.');
      }
    }

    const now = new Date();
    const row = {
      jenis: 'INV', tgl: asText_(tgl), pihak_id: c.id, pihak_nama: asText_(c.nama), jatuh_tempo: asText_(jt),
      referensi: asText_(String(p.referensi || '').trim()), catatan: asText_(String(p.catatan || '').trim()),
      subtotal: money_(calc.subtotal), diskon: money_(calc.diskon), diskon_nota: money_(calc.discNota), pajak: money_(calc.pajak), ppn_tarif: calc.tarif,
      total: money_(calc.total), sisa: money_(calc.total), saldo_awal: saldoAwal,
      lines_json: JSON.stringify(calc.lines.map(function (l) { const o = Object.assign({}, l); delete o._gross; delete o._disc; return o; })),
      akun_piutang: asText_(piutangAcc), diubah_pada: now,
    };
    const id = old ? old.id : newId_('INV');
    if (p.post) {
      row.status = 'posted';
      row.diposting_oleh = ctx.session.username;
      row.diposting_pada = now;
      if (saldoAwal) {
        row.no = asText_(String(p.no_asal).trim());
      } else {
        assertOpen_(tgl);
        row.no = asText_(invoiceNumber_(tgl));
        const jl = [{ akun_id: piutangAcc, memo: c.nama, debit: money_(calc.total), kredit: 0 }];
        if (calc.diskon) jl.push({ akun_id: AKUN_POTONGAN_JUAL, memo: 'Diskon penjualan', debit: money_(calc.diskon), kredit: 0 });
        const byAcc = {};
        calc.lines.forEach(function (l) { byAcc[l.akun_id] = (byAcc[l.akun_id] || 0) + l._gross; });
        Object.keys(byAcc).forEach(function (a) { if (byAcc[a]) jl.push({ akun_id: a, memo: (accs[a] || {}).nama || '', debit: 0, kredit: money_(byAcc[a]) }); });
        if (calc.pajak) jl.push({ akun_id: AKUN_PPN_KELUARAN, memo: 'PPN ' + calc.tarif + '%', debit: 0, kredit: money_(calc.pajak) });
        const no = String(row.no).slice(1);
        const head = postJournal_(ctx, { tgl: tgl, jenis: 'PJ', keterangan: 'Penjualan ' + no + ' — ' + c.nama, referensi: no, ref_dok: id, lines: jl });
        row.jurnal_id = head.id;
        row.ref_id = head.no;
        appendObjects_('T_DokumenDetail', calc.lines.map(function (l, i) {
          return { dok_id: id, baris: i + 1, produk_id: l.produk_id, deskripsi: asText_(l.deskripsi), qty: l.qty, harga: l.harga, diskon: l.diskon, pajak_id: calc.tarif ? 'PPN' : '', gudang_id: '', hpp: '' };
        }));
      }
    } else {
      row.status = 'draft';
    }
    if (old) {
      const u = updateWhere_('T_Dokumen', 'id', id, row);
      audit_(ctx, p.post ? 'POSTING' : 'UBAH_DRAFT', 'T_Dokumen', p.post ? String(row.no).slice(1) : id, null, { total: row.total, pelanggan: c.nama }, '');
      void u;
    } else {
      row.id = id;
      row.dibuat_oleh = ctx.session.username;
      row.dibuat_pada = now;
      appendObjects_('T_Dokumen', [row]);
      audit_(ctx, p.post ? 'POSTING' : 'BUAT_DRAFT', 'T_Dokumen', p.post ? String(row.no).slice(1) : id, null, { total: row.total, pelanggan: c.nama, saldo_awal: saldoAwal }, '');
    }
    return { id: id, no: row.no ? String(row.no).slice(1) : '', status: row.status, total: row.total };
  });
}

function formatRp_(c) {
  const v = Math.round(c / 100);
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function actionSalesVoid_(p, ctx) {
  const alasan = String(p.alasan || '').trim();
  if (!alasan) throw new ApiError_('VALIDATION', 'Alasan pembatalan wajib diisi.');
  return withLock_(function () {
    const inv = invoiceRows_().filter(function (r) { return r.id === p.id; })[0];
    if (!inv) throw new ApiError_('NOT_FOUND', 'Invoice tidak ditemukan.');
    if (inv.status === 'batal') throw new ApiError_('VALIDATION', 'Invoice ini sudah dibatalkan.');
    const now = new Date();
    const patch = { status: 'batal', sisa: 0, alasan_batal: asText_(alasan), dibatalkan_oleh: ctx.session.username, dibatalkan_pada: now };
    if (inv.status === 'draft') {
      updateWhere_('T_Dokumen', 'id', inv.id, patch);
      audit_(ctx, 'BUANG_DRAFT', 'T_Dokumen', inv.id, null, null, alasan);
      return { id: inv.id, status: 'batal' };
    }
    const pays = paymentRows_().filter(function (r) { return r.dok_id === inv.id && r.status !== 'batal'; });
    if (pays.length) throw new ApiError_('VALIDATION', 'Invoice sudah menerima ' + pays.length + ' pembayaran. Batalkan pembayarannya dulu.');
    var pembalik = '';
    if (inv.jurnal_id) {
      const j = actionJournalGet_({ id: inv.jurnal_id });
      assertOpen_(j.tgl);
      const linesC = j.lines.map(function (l) { return { akun_id: l.akun_id, memo: l.memo, debit: cents_(l.debit), kredit: cents_(l.kredit) }; });
      pembalik = reverseJournal_(ctx, j, linesC, j.tgl, 'Pembatalan ' + inv.no + ': ' + alasan, true).no;
      updateWhere_('T_Jurnal', 'id', j.id, { status: 'batal', alasan_batal: alasan, dibatalkan_oleh: ctx.session.username, dibatalkan_pada: now });
    }
    updateWhere_('T_Dokumen', 'id', inv.id, patch);
    audit_(ctx, 'BATAL', 'T_Dokumen', inv.no, { status: inv.status, total: inv.total }, { status: 'batal' }, alasan);
    return { id: inv.id, status: 'batal', pembalik: pembalik };
  });
}

// ---------------------------------------------------------------- pelunasan

function recomputeSisa_(inv) {
  const paid = paymentRows_().filter(function (r) { return r.dok_id === inv.id && r.status !== 'batal'; })
    .reduce(function (s, r) { return s + cents_(r.jumlah) + cents_(r.potongan); }, 0);
  const sisa = cents_(inv.total) - paid;
  updateWhere_('T_Dokumen', 'id', inv.id, { sisa: money_(sisa) });
  return sisa;
}

/** p: { dok_id, tgl, kasbank_id, metode, jumlah (uang diterima), potongan, akun_potongan, keterangan, referensi } */
function actionArPay_(p, ctx) {
  const tgl = ymd_(p.tgl);
  if (!tgl) throw new ApiError_('VALIDATION', 'Tanggal pembayaran wajib diisi.');
  const metode = String(p.metode || 'transfer');
  if (CASH_METHODS.indexOf(metode) < 0) throw new ApiError_('VALIDATION', 'Metode pembayaran tidak dikenal.');
  return withLock_(function () {
    const inv = invoiceRows_().filter(function (r) { return r.id === p.dok_id; })[0];
    if (!inv) throw new ApiError_('NOT_FOUND', 'Invoice tidak ditemukan.');
    if (inv.status !== 'posted') throw new ApiError_('VALIDATION', 'Hanya invoice yang sudah diposting yang bisa dibayar.');
    if (tgl < inv.tgl) throw new ApiError_('VALIDATION', 'Tanggal bayar tidak boleh sebelum tanggal invoice (' + inv.tgl + ').');
    const jumlah = cents_(p.jumlah || 0);
    const potongan = cents_(p.potongan || 0);
    if (jumlah < 0 || potongan < 0) throw new ApiError_('VALIDATION', 'Jumlah tidak boleh minus.');
    if (jumlah + potongan <= 0) throw new ApiError_('VALIDATION', 'Isi jumlah yang diterima.');
    const sisa = cents_(inv.sisa);
    if (jumlah + potongan > sisa) {
      throw new ApiError_('VALIDATION', 'Pembayaran Rp ' + formatRp_(jumlah + potongan) + ' melebihi sisa tagihan Rp ' + formatRp_(sisa) + '.');
    }
    const accs = accountsMap_();
    const piutangAcc = String(inv.akun_piutang || AKUN_PIUTANG);
    const kbs = {};
    kasbankRows_().forEach(function (k) { kbs[k.id] = k; });
    var kb = null;
    if (jumlah > 0) {
      kb = kbs[p.kasbank_id];
      if (!kb || !kb.aktif) throw new ApiError_('VALIDATION', 'Pilih rekening penerima yang aktif.');
      if (!canSeeAccount_(ctx.session, kb)) throw new ApiError_('FORBIDDEN', 'Peran Anda tidak punya akses ke rekening bank ini.');
    }
    var akunPot = '';
    if (potongan > 0) {
      akunPot = String(p.akun_potongan || '').trim();
      const a = accs[akunPot];
      if (!a || bool_(a.is_header)) throw new ApiError_('VALIDATION', 'Pilih akun untuk potongan.');
      const isCash = Object.keys(kbs).some(function (k) { return kbs[k].akun_id === akunPot; });
      if (isCash || akunPot === piutangAcc) throw new ApiError_('VALIDATION', 'Akun potongan tidak boleh rekening kas/bank atau akun piutang.');
    }
    const ket = String(p.keterangan || '').trim() || ('Pelunasan ' + inv.no + ' — ' + inv.pihak_nama);
    const id = newId_('PAY');
    const jl = [];
    if (jumlah) jl.push({ akun_id: kb.akun_id, memo: ket, debit: money_(jumlah), kredit: 0 });
    if (potongan) jl.push({ akun_id: akunPot, memo: 'Potongan ' + inv.no, debit: money_(potongan), kredit: 0 });
    jl.push({ akun_id: piutangAcc, memo: inv.pihak_nama, debit: 0, kredit: money_(jumlah + potongan) });
    const head = postJournal_(ctx, { tgl: tgl, jenis: jumlah ? 'KM' : 'JU', keterangan: ket, referensi: inv.no, ref_dok: id, lines: jl });
    var kbTrx = '';
    if (jumlah) {
      kbTrx = newId_('KBKM');
      appendObjects_('T_KasBank', [{
        id: kbTrx, no: head.no, tgl: asText_(tgl), kasbank_id: kb.id, kasbank_tujuan: '', jenis: 'masuk', metode: metode,
        kontak_tipe: 'pelanggan', kontak_id: inv.pihak_id, kontak_nama: asText_(inv.pihak_nama), akun_lawan: asText_(piutangAcc),
        jumlah: money_(jumlah), keterangan: asText_(ket), referensi: asText_(inv.no),
        lines_json: JSON.stringify([{ akun_id: piutangAcc, memo: 'Pelunasan ' + inv.no, jumlah: money_(jumlah) }]),
        rekon: false, jurnal_id: head.id, status: 'posted', sumber_dok: id, dibuat_oleh: ctx.session.username, dibuat_pada: new Date(),
      }]);
    }
    appendObjects_('T_Pembayaran', [{
      id: id, no: head.no, dok_id: inv.id, tgl: asText_(tgl), metode: jumlah ? metode : 'potongan', kasbank_id: kb ? kb.id : '',
      jumlah: money_(jumlah), potongan: money_(potongan), akun_potongan: asText_(akunPot), keterangan: asText_(ket),
      referensi: asText_(String(p.referensi || '').trim()), jurnal_id: head.id, kasbank_trx: kbTrx, status: 'posted',
      dibuat_oleh: ctx.session.username, dibuat_pada: new Date(),
    }]);
    const newSisa = recomputeSisa_(inv);
    audit_(ctx, 'PELUNASAN', 'T_Pembayaran', head.no, null, { invoice: inv.no, jumlah: money_(jumlah), potongan: money_(potongan), sisa: money_(newSisa) }, '');
    return { id: id, no: head.no, sisa: money_(newSisa), lunas: newSisa === 0 };
  });
}

function actionArPayVoid_(p, ctx) {
  const alasan = String(p.alasan || '').trim();
  if (!alasan) throw new ApiError_('VALIDATION', 'Alasan pembatalan wajib diisi.');
  return withLock_(function () {
    const pay = paymentRows_().filter(function (r) { return r.id === p.id; })[0];
    if (!pay) throw new ApiError_('NOT_FOUND', 'Pembayaran tidak ditemukan.');
    if (pay.status === 'batal') throw new ApiError_('VALIDATION', 'Pembayaran ini sudah dibatalkan.');
    if (pay.kasbank_id) {
      const kb = kasbankRows_().filter(function (k) { return k.id === pay.kasbank_id; })[0];
      if (kb && !canSeeAccount_(ctx.session, kb)) throw new ApiError_('FORBIDDEN', 'Peran Anda tidak punya akses ke rekening bank ini.');
    }
    if (pay.kasbank_trx) {
      const trx = cashRows_().filter(function (r) { return r.id === pay.kasbank_trx; })[0];
      if (trx && bool_(trx.rekon)) throw new ApiError_('VALIDATION', 'Penerimaan ini sudah direkonsiliasi dengan rekening koran.');
    }
    const j = actionJournalGet_({ id: pay.jurnal_id });
    assertOpen_(j.tgl);
    const linesC = j.lines.map(function (l) { return { akun_id: l.akun_id, memo: l.memo, debit: cents_(l.debit), kredit: cents_(l.kredit) }; });
    const rev = reverseJournal_(ctx, j, linesC, j.tgl, 'Pembatalan ' + j.no + ': ' + alasan, true);
    const now = new Date();
    updateWhere_('T_Jurnal', 'id', j.id, { status: 'batal', alasan_batal: alasan, dibatalkan_oleh: ctx.session.username, dibatalkan_pada: now });
    if (pay.kasbank_trx) updateWhere_('T_KasBank', 'id', pay.kasbank_trx, { status: 'batal', alasan_batal: asText_(alasan) });
    updateWhere_('T_Pembayaran', 'id', pay.id, { status: 'batal', alasan_batal: asText_(alasan) });
    const inv = invoiceRows_().filter(function (r) { return r.id === pay.dok_id; })[0];
    const sisa = recomputeSisa_(inv);
    audit_(ctx, 'BATAL', 'T_Pembayaran', pay.no, { jumlah: pay.jumlah, potongan: pay.potongan }, { status: 'batal', sisa_invoice: money_(sisa) }, alasan);
    return { id: pay.id, status: 'batal', pembalik: rev.no, sisa: money_(sisa) };
  });
}

function actionArFollowup_(p, ctx) {
  const catatan = String(p.catatan || '').trim();
  if (!catatan) throw new ApiError_('VALIDATION', 'Isi catatan penagihan.');
  const inv = invoiceRows_().filter(function (r) { return r.id === p.dok_id; })[0];
  if (!inv) throw new ApiError_('NOT_FOUND', 'Invoice tidak ditemukan.');
  const tgl = p.tgl ? ymd_(p.tgl) : todayYmd_();
  appendObjects_('T_Penagihan', [{ dok_id: inv.id, tgl: asText_(tgl), via: asText_(String(p.via || 'telepon')), catatan: asText_(catatan), oleh: ctx.session.username }]);
  return { ok: true };
}

// ---------------------------------------------------------------- umur piutang

/** Sisa tiap invoice per tanggal `per` (pembayaran sesudah `per` belum dihitung). */
function openInvoicesAt_(per) {
  const paid = {};
  paymentRows_().forEach(function (r) {
    if (r.status === 'batal' || r.tgl > per) return;
    paid[r.dok_id] = (paid[r.dok_id] || 0) + cents_(r.jumlah) + cents_(r.potongan);
  });
  // invoice batal dibalik bertanggal sama dengan invoice-nya, jadi dianggap tidak pernah ada
  return invoiceRows_().filter(function (r) { return r.tgl <= per && r.status === 'posted'; })
    .map(function (r) { r.sisa_c = cents_(r.total) - (paid[r.id] || 0); return r; })
    .filter(function (r) { return r.sisa_c > 0; });
}

function bucketOf_(jt, per) {
  const d = daysBetween_(jt, per);
  if (d <= 0) return 'belum';
  if (d <= 30) return 'd30';
  if (d <= 60) return 'd60';
  if (d <= 90) return 'd90';
  return 'd90p';
}

function actionArAging_(p) {
  const per = p.per ? ymd_(p.per) : todayYmd_();
  const custs = {};
  const totals = {};
  AGING_BUCKETS.forEach(function (b) { totals[b.key] = 0; });
  var grand = 0;
  const piutangAccs = {};
  piutangAccs[AKUN_PIUTANG] = true;
  const cmap = customersMap_();
  openInvoicesAt_(per).forEach(function (r) {
    const b = bucketOf_(r.jatuh_tempo, per);
    piutangAccs[String(r.akun_piutang || AKUN_PIUTANG)] = true;
    if (!custs[r.pihak_id]) {
      const c = cmap[r.pihak_id] || {};
      custs[r.pihak_id] = { pelanggan_id: r.pihak_id, nama: c.nama || r.pihak_nama, telepon: c.telepon || '', batas_kredit: c.batas_kredit || 0, total: 0, b: {}, invoices: [] };
      AGING_BUCKETS.forEach(function (x) { custs[r.pihak_id].b[x.key] = 0; });
    }
    const cu = custs[r.pihak_id];
    cu.total += r.sisa_c;
    cu.b[b] += r.sisa_c;
    totals[b] += r.sisa_c;
    grand += r.sisa_c;
    cu.invoices.push({ id: r.id, no: r.no, tgl: r.tgl, jatuh_tempo: r.jatuh_tempo, total: r.total, sisa: money_(r.sisa_c), bucket: b,
      hari: Math.max(0, daysBetween_(r.jatuh_tempo, per)), saldo_awal: r.saldo_awal });
  });
  const list = Object.keys(custs).map(function (k) {
    const c = custs[k];
    c.total = money_(c.total);
    Object.keys(c.b).forEach(function (x) { c.b[x] = money_(c.b[x]); });
    c.invoices.sort(function (a, b) { return a.jatuh_tempo < b.jatuh_tempo ? -1 : 1; });
    c.lewat_batas = c.batas_kredit > 0 && c.total > c.batas_kredit;
    return c;
  }).sort(function (a, b) { return b.total - a.total; });
  var gl = 0;
  Object.keys(piutangAccs).forEach(function (a) { gl += balanceAt_(a, per); });
  const t = {};
  Object.keys(totals).forEach(function (k) { t[k] = money_(totals[k]); });
  return { per: per, buckets: AGING_BUCKETS, customers: list, totals: t, total: money_(grand), gl: money_(gl), akun: Object.keys(piutangAccs) };
}

// ---------------------------------------------------------------- dashboard

function monthsBack_(ym, n) {
  const out = [];
  var y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  for (var i = 0; i < n; i++) {
    out.unshift(y + '-' + ('0' + m).slice(-2));
    m--;
    if (m === 0) { m = 12; y--; }
  }
  return out;
}

function actionDashboard_(p, ctx) {
  const s = ctx.session;
  const to = p.to ? ymd_(p.to) : todayYmd_();
  const ym = to.slice(0, 7);
  const months = monthsBack_(ym, 6);
  const fy = fiscalStart_(to);
  const from = months[0] + '-01' < fy ? months[0] + '-01' : fy;
  const accs = accountsMap_();
  const eff = effectiveIds_();
  const per = {};
  months.forEach(function (m) { per[m] = { pendapatan: 0, laba: 0 }; });
  var ytdP = 0, ytdL = 0;
  const signIncome = { pendapatan: -1, lain: -1, hpp: -1, beban: -1, pajak: -1 };
  journalLines_().forEach(function (d) {
    if (!eff.ids[d.jurnal_id]) return;
    const t = eff.heads[d.jurnal_id].tgl;
    if (t < from || t > to) return;
    const a = accs[d.akun_id];
    if (!a || !signIncome[a.tipe]) return;
    const net = cents_(d.kredit) - cents_(d.debit);
    const bucket = per[t.slice(0, 7)];
    if (bucket) {
      if (a.tipe === 'pendapatan') bucket.pendapatan += net;
      bucket.laba += net;
    }
    if (t >= fy) {
      if (a.tipe === 'pendapatan') ytdP += net;
      ytdL += net;
    }
  });
  const prevYm = months[months.length - 2];
  const out = {
    per: to,
    bulan: ym,
    tren: months.map(function (m) { return { bulan: m, pendapatan: money_(per[m].pendapatan), laba: money_(per[m].laba) }; }),
    omzet: { bulan: money_(per[ym].pendapatan), lalu: money_(per[prevYm].pendapatan), ytd: money_(ytdP) },
    laba: { bulan: money_(per[ym].laba), lalu: money_(per[prevYm].laba), ytd: money_(ytdL) },
    awal_tahun_buku: fy,
    peringatan: [],
  };
  const warn = function (level, text, link) { out.peringatan.push({ level: level, text: text, link: link || '' }); };

  if (hasPerm_(s, 'kas.view') && moduleActive_('kasbank')) {
    const kas = kasbankRows_().filter(function (k) { return k.aktif && canSeeAccount_(s, k); })
      .map(function (k) { return { id: k.id, nama: k.nama, jenis: k.jenis, saldo: money_(balanceAt_(k.akun_id, to)) }; });
    out.kas = { total: kas.reduce(function (t, k) { return t + k.saldo; }, 0), rekening: kas, termasuk_bank: hasPerm_(s, 'bank.saldo') };
    kas.forEach(function (k) { if (k.saldo < 0) warn('err', 'Saldo ' + k.nama + ' minus Rp ' + formatRp_(-k.saldo * 100) + '.', '/kas-bank'); });
  }

  if (hasPerm_(s, 'penjualan.view') && moduleActive_('penjualan')) {
    const today = to;
    var sisa = 0, telat = 0, nTelat = 0, segera = 0, nSegera = 0, draft = 0;
    const overdue = [];
    const byCust = {};
    invoiceRows_().forEach(function (r) {
      if (r.status === 'draft') { draft++; return; }
      if (r.status !== 'posted' || r.sisa <= 0) return;
      const c = cents_(r.sisa);
      sisa += c;
      byCust[r.pihak_id] = (byCust[r.pihak_id] || 0) + c;
      if (r.jatuh_tempo < today) {
        telat += c; nTelat++;
        overdue.push({ id: r.id, no: r.no, pelanggan: r.pihak_nama, sisa: r.sisa, jatuh_tempo: r.jatuh_tempo, hari: daysBetween_(r.jatuh_tempo, today) });
      } else if (r.jatuh_tempo <= addDays_(today, 7)) { segera += c; nSegera++; }
    });
    overdue.sort(function (a, b) { return b.hari - a.hari; });
    out.piutang = { total: money_(sisa), terlambat: money_(telat), n_terlambat: nTelat, segera: money_(segera), n_segera: nSegera, draft: draft, teratas: overdue.slice(0, 5) };
    if (nTelat) warn('warn', nTelat + ' invoice lewat jatuh tempo, total Rp ' + formatRp_(telat) + '.', '/piutang');
    if (nSegera) warn('info', nSegera + ' invoice jatuh tempo dalam 7 hari (Rp ' + formatRp_(segera) + ').', '/penjualan?status=terbuka');
    if (draft) warn('info', draft + ' invoice masih draft — belum tercatat sebagai penjualan.', '/penjualan?status=draft');
    const cmap = customersMap_();
    Object.keys(byCust).forEach(function (id) {
      const c = cmap[id];
      if (c && c.batas_kredit > 0 && byCust[id] > cents_(c.batas_kredit)) warn('warn', 'Piutang ' + c.nama + ' melewati batas kredit.', '/piutang');
    });
    // buku pembantu piutang harus sama dengan buku besar
    if (moduleActive_('piutang')) {
      const ag = actionArAging_({ per: to });
      if (Math.abs(cents_(ag.total) - cents_(ag.gl)) > 0) {
        warn('warn', 'Saldo piutang di buku besar (Rp ' + formatRp_(cents_(ag.gl)) + ') berbeda dengan daftar invoice terbuka (Rp ' + formatRp_(cents_(ag.total)) +
          '). Catat piutang lama sebagai invoice saldo awal, atau periksa jurnal manual ke akun piutang.', '/piutang');
      }
    }
  }

  if (hasPerm_(s, 'jurnal.approve') && moduleActive_('approval')) {
    const n = journalHeads_().filter(function (h) { return h.status === 'menunggu'; }).length;
    if (n) warn('info', n + ' jurnal menunggu persetujuan.', '/jurnal?status=menunggu');
  }
  if (hasPerm_(s, 'periode.lock')) {
    const lastYm = prevYm;
    if (Number(to.slice(8, 10)) > 10 && periodStatus_(lastYm) === 'buka') warn('info', 'Periode ' + lastYm + ' belum dikunci. Kunci setelah pembukuan bulan itu selesai.', '/tutup-buku');
  }
  return out;
}
