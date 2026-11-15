/**
 * Purchase — tagihan pembelian dari supplier, pembayaran utang bertahap, umur utang.
 *
 * Posting tagihan : Dr Persediaan (barang dilacak) / Dr akun biaya per baris · Dr PPN masukan · Cr Utang usaha
 * Pembayaran      : Dr Utang usaha · Cr Kas/Bank (uang keluar) · Cr akun potongan (mis. PPh 23 yang kita potong → Utang PPh 23)
 * Diskon (per baris & nota) mengurangi harga perolehan; diskon nota dibagi proporsional ke baris.
 */

const AKUN_UTANG = '2-1101';
const AKUN_PPN_MASUKAN = '1-1601';
const AKUN_UTANG_PPH23 = '2-1203';

function suppliersMap_() {
  const m = {};
  masterRows_(MASTER.supplier).forEach(function (c) { c.top_hari = Number(c.top_hari) || 0; m[c.id] = c; });
  return m;
}

function purchaseRows_() {
  return docRows_('BELI');
}

function actionPurchaseList_(p) {
  const today = todayYmd_();
  var rows = purchaseRows_().map(function (r) { return decorate_(r, today); });
  if (p.supplier_id) rows = rows.filter(function (r) { return r.pihak_id === p.supplier_id; });
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

function actionPurchaseGet_(p) {
  const today = todayYmd_();
  const d = purchaseRows_().filter(function (r) { return r.id === p.id; })[0];
  if (!d) throw new ApiError_('NOT_FOUND', 'Tagihan pembelian tidak ditemukan.');
  decorate_(d, today);
  d.pembayaran = paymentRows_().filter(function (r) { return r.dok_id === d.id; })
    .sort(function (a, b) { return a.tgl < b.tgl ? -1 : a.tgl > b.tgl ? 1 : 0; });
  const s = suppliersMap_()[d.pihak_id];
  d.supplier = s ? { id: s.id, kode: s.kode, nama: s.nama, npwp: s.npwp, alamat: s.alamat, telepon: s.telepon } : null;
  return d;
}

/**
 * Hitung baris pembelian (sen). Akun tiap baris: persediaan bila barang dilacak stoknya, selain itu akun pilihan
 * (default: barang → 5-1101 HPP, jasa/bebas → 6-1901). Diskon nota dibagi proporsional ke baris.
 */
function computePurchase_(p, accs, prods, cashAccs) {
  const lines = [];
  (p.lines || []).forEach(function (l, i) {
    const desk = String(l.deskripsi || '').trim();
    if (!desk && !l.produk_id && !Number(l.harga)) return;
    const n = i + 1;
    const qty = Number(String(l.qty === undefined ? 1 : l.qty).replace(',', '.'));
    if (!isFinite(qty) || qty <= 0) throw new ApiError_('VALIDATION', 'Baris ' + n + ': kuantitas harus lebih dari nol.');
    const harga = cents_(l.harga || 0);
    if (harga < 0) throw new ApiError_('VALIDATION', 'Baris ' + n + ': harga tidak boleh minus.');
    const gross = Math.round(qty * harga);
    const disc = cents_(l.diskon || 0);
    if (disc < 0 || disc > gross) throw new ApiError_('VALIDATION', 'Baris ' + n + ': diskon tidak boleh minus atau melebihi jumlah baris.');
    const prod = l.produk_id ? prods[l.produk_id] : null;
    if (l.produk_id && !prod) throw new ApiError_('VALIDATION', 'Baris ' + n + ': produk tidak ditemukan.');
    if (!desk && !prod) throw new ApiError_('VALIDATION', 'Baris ' + n + ': isi deskripsi barang/jasa.');
    const tracked = isTracked_(prod);
    var akun = tracked ? invAccount_(prod) : (String(l.akun_id || '').trim() || (prod && prod.tipe === 'barang' ? AKUN_HPP : '6-1901'));
    const acc = accs[akun];
    if (!acc || bool_(acc.is_header)) throw new ApiError_('VALIDATION', 'Baris ' + n + ': akun ' + akun + ' tidak valid.');
    if (!tracked && akun === AKUN_PERSEDIAAN && moduleActive_('persediaan')) throw new ApiError_('VALIDATION', 'Baris ' + n + ': untuk menambah persediaan pilih produk yang dilacak stoknya, supaya kartu stok ikut bertambah.');
    if (cashAccs[akun] || akun === AKUN_UTANG) throw new ApiError_('VALIDATION', 'Baris ' + n + ': akun ' + akun + ' tidak bisa dipakai untuk baris pembelian.');
    lines.push({ produk_id: l.produk_id || '', deskripsi: desk || prod.nama, qty: qty, satuan: String(l.satuan || (prod && prod.satuan) || '').trim(),
      harga: money_(harga), diskon: money_(disc), akun_id: akun, stok: tracked, _gross: gross, _disc: disc, _net: gross - disc });
  });
  const subtotal = lines.reduce(function (s, l) { return s + l._gross; }, 0);
  const discLines = lines.reduce(function (s, l) { return s + l._disc; }, 0);
  const discNota = cents_(p.diskon_nota || 0);
  if (discNota < 0) throw new ApiError_('VALIDATION', 'Diskon nota tidak boleh minus.');
  const netLines = subtotal - discLines;
  const dpp = netLines - discNota;
  if (lines.length && dpp < 0) throw new ApiError_('VALIDATION', 'Diskon melebihi nilai pembelian.');
  // bagi diskon nota proporsional; sisa pembulatan ke baris terakhir yang bernilai
  var left = discNota;
  lines.forEach(function (l, i) {
    const share = i === lines.length - 1 ? left : (netLines ? Math.round(discNota * l._net / netLines) : 0);
    l._cost = l._net - share;
    left -= share;
  });
  const tarif = Number(p.ppn_tarif) || 0;
  if (tarif < 0 || tarif > 100) throw new ApiError_('VALIDATION', 'Tarif PPN tidak valid.');
  const pajak = tarif ? Math.round(dpp * tarif / 100) : 0;
  lines.forEach(function (l) { l.jumlah = money_(l._net); l.nilai = money_(l._cost); });
  return { lines: lines, subtotal: subtotal, diskon: discLines + discNota, discNota: discNota, dpp: dpp, pajak: pajak, tarif: tarif, total: dpp + pajak };
}

function purchaseNumber_(tgl) {
  const year = Number(tgl.slice(0, 4));
  const n = nextNumber_('BELI', 'PST', year);
  const fmt = getSetting_('format_nomor_pembelian') || 'BL/{YYYY}/{MM}/{####}';
  return formatNumber_(String(fmt).replace('{MM}', tgl.slice(5, 7)), 'PST', year, n);
}

/** p: { id?, tgl, supplier_id, jatuh_tempo?, referensi (no. tagihan supplier), catatan, ppn_tarif, diskon_nota, lines[], post, saldo_awal?, no_asal?, total? } */
function actionPurchaseSave_(p, ctx) {
  const tgl = ymd_(p.tgl);
  if (!tgl) throw new ApiError_('VALIDATION', 'Tanggal tagihan wajib diisi.');
  return withLock_(function () {
    const s = suppliersMap_()[p.supplier_id];
    if (!s) throw new ApiError_('VALIDATION', 'Pilih supplier.');
    if (!s.aktif) throw new ApiError_('VALIDATION', 'Supplier ' + s.nama + ' nonaktif.');
    const accs = accountsMap_();
    const prods = productsMap_();
    const cashAccs = {};
    kasbankRows_().forEach(function (k) { cashAccs[k.akun_id] = true; });
    const old = p.id ? purchaseRows_().filter(function (r) { return r.id === p.id; })[0] : null;
    if (p.id && !old) throw new ApiError_('NOT_FOUND', 'Tagihan tidak ditemukan.');
    if (old && old.status !== 'draft') throw new ApiError_('VALIDATION', 'Tagihan yang sudah diposting tidak bisa diubah. Batalkan lalu buat ulang.');
    const jt = p.jatuh_tempo ? ymd_(p.jatuh_tempo) : addDays_(tgl, s.top_hari);
    if (jt < tgl) throw new ApiError_('VALIDATION', 'Jatuh tempo tidak boleh sebelum tanggal tagihan.');
    const utangAcc = s.akun_utang && accs[s.akun_utang] ? s.akun_utang : AKUN_UTANG;
    const saldoAwal = !!p.saldo_awal;
    var calc;
    if (saldoAwal) {
      const amt = cents_(p.total || 0);
      if (amt <= 0) throw new ApiError_('VALIDATION', 'Isi sisa utang yang belum dibayar.');
      if (!String(p.no_asal || '').trim()) throw new ApiError_('VALIDATION', 'Isi nomor tagihan lama.');
      calc = { lines: [{ deskripsi: String(p.catatan || 'Saldo awal utang').trim(), qty: 1, satuan: '', harga: money_(amt), diskon: 0, jumlah: money_(amt), akun_id: '' }],
        subtotal: amt, diskon: 0, discNota: 0, dpp: amt, pajak: 0, tarif: 0, total: amt };
    } else {
      calc = computePurchase_(p, accs, prods, cashAccs);
      if (p.post && !calc.lines.length) throw new ApiError_('VALIDATION', 'Isi minimal satu baris barang/jasa.');
      if (p.post && calc.total <= 0) throw new ApiError_('VALIDATION', 'Total tagihan harus lebih dari nol.');
    }
    const ref = String(p.referensi || '').trim();
    if (p.post && ref && !saldoAwal) {
      const dup = purchaseRows_().filter(function (r) { return r.status === 'posted' && r.pihak_id === s.id && r.referensi.toLowerCase() === ref.toLowerCase() && r.id !== p.id; })[0];
      if (dup && !p.lewatiDuplikat) throw new ApiError_('DUPLICATE_REF', 'Tagihan ' + ref + ' dari ' + s.nama + ' sudah pernah dicatat (' + dup.no + ').');
    }
    const clean = function (ls) { return JSON.stringify(ls.map(function (l) { const o = Object.assign({}, l); delete o._gross; delete o._disc; delete o._net; delete o._cost; return o; })); };
    const now = new Date();
    const row = {
      jenis: 'BELI', tgl: asText_(tgl), pihak_id: s.id, pihak_nama: asText_(s.nama), jatuh_tempo: asText_(jt),
      referensi: asText_(ref), catatan: asText_(String(p.catatan || '').trim()),
      subtotal: money_(calc.subtotal), diskon: money_(calc.diskon), diskon_nota: money_(calc.discNota), pajak: money_(calc.pajak), ppn_tarif: calc.tarif,
      total: money_(calc.total), sisa: money_(calc.total), saldo_awal: saldoAwal, lines_json: clean(calc.lines), akun_utang: asText_(utangAcc), diubah_pada: now,
    };
    const id = old ? old.id : newId_('BELI');
    if (p.post) {
      row.status = 'posted';
      row.diposting_oleh = ctx.session.username;
      row.diposting_pada = now;
      if (saldoAwal) {
        row.no = asText_(String(p.no_asal).trim());
      } else {
        assertOpen_(tgl);
        row.no = asText_(purchaseNumber_(tgl));
        const no = String(row.no).slice(1);
        const byAcc = {};
        const order = [];
        calc.lines.forEach(function (l) { if (!(l.akun_id in byAcc)) { byAcc[l.akun_id] = 0; order.push(l.akun_id); } byAcc[l.akun_id] += l._cost; });
        const jl = order.filter(function (a) { return byAcc[a]; }).map(function (a) { return { akun_id: a, memo: (accs[a] || {}).nama || '', debit: money_(byAcc[a]), kredit: 0 }; });
        if (calc.pajak) jl.push({ akun_id: AKUN_PPN_MASUKAN, memo: 'PPN masukan ' + calc.tarif + '%', debit: money_(calc.pajak), kredit: 0 });
        jl.push({ akun_id: utangAcc, memo: s.nama, debit: 0, kredit: money_(calc.total) });
        const head = postJournal_(ctx, { tgl: tgl, jenis: 'PB', keterangan: 'Pembelian ' + no + ' — ' + s.nama + (ref ? ' (' + ref + ')' : ''), referensi: ref || no, ref_dok: id, lines: jl });
        row.jurnal_id = head.id;
        row.ref_id = head.no;
        writeStock_(ctx, tgl, id, head.id, calc.lines.filter(function (l) { return l.stok; }).map(function (l) {
          return { produk_id: l.produk_id, qty: l.qty, nilai: l._cost, jenis: 'beli', ref_no: no, keterangan: s.nama };
        }));
        appendObjects_('T_DokumenDetail', calc.lines.map(function (l, i) {
          return { dok_id: id, baris: i + 1, produk_id: l.produk_id, deskripsi: asText_(l.deskripsi), qty: l.qty, harga: l.harga, diskon: l.diskon, pajak_id: calc.tarif ? 'PPN' : '', gudang_id: l.stok ? 'UTAMA' : '', hpp: l.nilai };
        }));
      }
    } else {
      row.status = 'draft';
    }
    if (old) {
      updateWhere_('T_Dokumen', 'id', id, row);
      audit_(ctx, p.post ? 'POSTING' : 'UBAH_DRAFT', 'T_Dokumen', p.post ? String(row.no).slice(1) : id, null, { total: row.total, supplier: s.nama }, '');
    } else {
      row.id = id;
      row.dibuat_oleh = ctx.session.username;
      row.dibuat_pada = now;
      appendObjects_('T_Dokumen', [row]);
      audit_(ctx, p.post ? 'POSTING' : 'BUAT_DRAFT', 'T_Dokumen', p.post ? String(row.no).slice(1) : id, null, { total: row.total, supplier: s.nama, saldo_awal: saldoAwal }, '');
    }
    return { id: id, no: row.no ? String(row.no).slice(1) : '', status: row.status, total: row.total };
  });
}

function actionPurchaseVoid_(p, ctx) {
  const alasan = String(p.alasan || '').trim();
  if (!alasan) throw new ApiError_('VALIDATION', 'Alasan pembatalan wajib diisi.');
  return withLock_(function () {
    const d = purchaseRows_().filter(function (r) { return r.id === p.id; })[0];
    if (!d) throw new ApiError_('NOT_FOUND', 'Tagihan tidak ditemukan.');
    if (d.status === 'batal') throw new ApiError_('VALIDATION', 'Tagihan ini sudah dibatalkan.');
    const now = new Date();
    const patch = { status: 'batal', sisa: 0, alasan_batal: asText_(alasan), dibatalkan_oleh: ctx.session.username, dibatalkan_pada: now };
    if (d.status === 'draft') {
      updateWhere_('T_Dokumen', 'id', d.id, patch);
      audit_(ctx, 'BUANG_DRAFT', 'T_Dokumen', d.id, null, null, alasan);
      return { id: d.id, status: 'batal' };
    }
    const pays = paymentRows_().filter(function (r) { return r.dok_id === d.id && r.status !== 'batal'; });
    if (pays.length) throw new ApiError_('VALIDATION', 'Tagihan sudah dibayar ' + pays.length + ' kali. Batalkan pembayarannya dulu.');
    var pembalik = '';
    if (d.jurnal_id) {
      const j = actionJournalGet_({ id: d.jurnal_id });
      assertOpen_(j.tgl);
      voidStockOf_(d.id, productsMap_());
      const linesC = j.lines.map(function (l) { return { akun_id: l.akun_id, memo: l.memo, debit: cents_(l.debit), kredit: cents_(l.kredit) }; });
      pembalik = reverseJournal_(ctx, j, linesC, j.tgl, 'Pembatalan ' + d.no + ': ' + alasan, true).no;
      updateWhere_('T_Jurnal', 'id', j.id, { status: 'batal', alasan_batal: alasan, dibatalkan_oleh: ctx.session.username, dibatalkan_pada: now });
    }
    updateWhere_('T_Dokumen', 'id', d.id, patch);
    audit_(ctx, 'BATAL', 'T_Dokumen', d.no, { status: d.status, total: d.total }, { status: 'batal' }, alasan);
    return { id: d.id, status: 'batal', pembalik: pembalik };
  });
}

/** p: { dok_id, tgl, kasbank_id, metode, jumlah (uang keluar), potongan, akun_potongan (default Utang PPh 23), keterangan, referensi } */
function actionApPay_(p, ctx) {
  const tgl = ymd_(p.tgl);
  if (!tgl) throw new ApiError_('VALIDATION', 'Tanggal pembayaran wajib diisi.');
  const metode = String(p.metode || 'transfer');
  if (CASH_METHODS.indexOf(metode) < 0) throw new ApiError_('VALIDATION', 'Metode pembayaran tidak dikenal.');
  return withLock_(function () {
    const d = purchaseRows_().filter(function (r) { return r.id === p.dok_id; })[0];
    if (!d) throw new ApiError_('NOT_FOUND', 'Tagihan tidak ditemukan.');
    if (d.status !== 'posted') throw new ApiError_('VALIDATION', 'Hanya tagihan yang sudah diposting yang bisa dibayar.');
    if (tgl < d.tgl) throw new ApiError_('VALIDATION', 'Tanggal bayar tidak boleh sebelum tanggal tagihan (' + d.tgl + ').');
    const jumlah = cents_(p.jumlah || 0);
    const potongan = cents_(p.potongan || 0);
    if (jumlah < 0 || potongan < 0) throw new ApiError_('VALIDATION', 'Jumlah tidak boleh minus.');
    if (jumlah + potongan <= 0) throw new ApiError_('VALIDATION', 'Isi jumlah yang dibayar.');
    const sisa = cents_(d.sisa);
    if (jumlah + potongan > sisa) throw new ApiError_('VALIDATION', 'Pembayaran Rp ' + formatRp_(jumlah + potongan) + ' melebihi sisa utang Rp ' + formatRp_(sisa) + '.');
    const accs = accountsMap_();
    const utangAcc = String(d.akun_utang || AKUN_UTANG);
    const kbs = {};
    kasbankRows_().forEach(function (k) { kbs[k.id] = k; });
    var kb = null;
    if (jumlah > 0) {
      kb = kbs[p.kasbank_id];
      if (!kb || !kb.aktif) throw new ApiError_('VALIDATION', 'Pilih rekening pembayar yang aktif.');
      if (!canSeeAccount_(ctx.session, kb)) throw new ApiError_('FORBIDDEN', 'Peran Anda tidak punya akses ke rekening bank ini.');
      if (kb.jenis !== 'bank') {
        const saldo = balanceAt_(kb.akun_id, '9999-12-31');
        if (saldo - jumlah < 0) throw new ApiError_('INSUFFICIENT', 'Saldo ' + kb.nama + ' tidak cukup (saldo ' + formatRp_(saldo) + ', keluar ' + formatRp_(jumlah) + ').');
      }
    }
    var akunPot = '';
    if (potongan > 0) {
      akunPot = String(p.akun_potongan || AKUN_UTANG_PPH23).trim();
      const a = accs[akunPot];
      if (!a || bool_(a.is_header)) throw new ApiError_('VALIDATION', 'Pilih akun untuk potongan.');
      const isCash = Object.keys(kbs).some(function (k) { return kbs[k].akun_id === akunPot; });
      if (isCash || akunPot === utangAcc) throw new ApiError_('VALIDATION', 'Akun potongan tidak boleh rekening kas/bank atau akun utang.');
    }
    const ket = String(p.keterangan || '').trim() || ('Pembayaran ' + d.no + (d.referensi ? ' (' + d.referensi + ')' : '') + ' — ' + d.pihak_nama);
    const id = newId_('PAY');
    const jl = [{ akun_id: utangAcc, memo: d.pihak_nama, debit: money_(jumlah + potongan), kredit: 0 }];
    if (jumlah) jl.push({ akun_id: kb.akun_id, memo: ket, debit: 0, kredit: money_(jumlah) });
    if (potongan) jl.push({ akun_id: akunPot, memo: 'Potongan ' + d.no, debit: 0, kredit: money_(potongan) });
    const head = postJournal_(ctx, { tgl: tgl, jenis: jumlah ? 'KK' : 'JU', keterangan: ket, referensi: d.no, ref_dok: id, lines: jl });
    var kbTrx = '';
    if (jumlah) {
      kbTrx = newId_('KBKK');
      appendObjects_('T_KasBank', [{
        id: kbTrx, no: head.no, tgl: asText_(tgl), kasbank_id: kb.id, kasbank_tujuan: '', jenis: 'keluar', metode: metode,
        kontak_tipe: 'supplier', kontak_id: d.pihak_id, kontak_nama: asText_(d.pihak_nama), akun_lawan: asText_(utangAcc),
        jumlah: money_(jumlah), keterangan: asText_(ket), referensi: asText_(d.no),
        lines_json: JSON.stringify([{ akun_id: utangAcc, memo: 'Pembayaran ' + d.no, jumlah: money_(jumlah) }]),
        rekon: false, jurnal_id: head.id, status: 'posted', sumber_dok: id, dibuat_oleh: ctx.session.username, dibuat_pada: new Date(),
      }]);
    }
    appendObjects_('T_Pembayaran', [{
      id: id, no: head.no, dok_id: d.id, tgl: asText_(tgl), metode: jumlah ? metode : 'potongan', kasbank_id: kb ? kb.id : '',
      jumlah: money_(jumlah), potongan: money_(potongan), akun_potongan: asText_(akunPot), keterangan: asText_(ket),
      referensi: asText_(String(p.referensi || '').trim()), jurnal_id: head.id, kasbank_trx: kbTrx, status: 'posted',
      dibuat_oleh: ctx.session.username, dibuat_pada: new Date(),
    }]);
    const newSisa = recomputeSisa_(d);
    audit_(ctx, 'BAYAR_UTANG', 'T_Pembayaran', head.no, null, { tagihan: d.no, jumlah: money_(jumlah), potongan: money_(potongan), sisa: money_(newSisa) }, '');
    return { id: id, no: head.no, sisa: money_(newSisa), lunas: newSisa === 0 };
  });
}

function actionApAging_(p) {
  const per = p.per ? ymd_(p.per) : todayYmd_();
  return agingOf_(per, { jenis: 'BELI', akunDefault: AKUN_UTANG, akunField: 'akun_utang', pihak: suppliersMap_(), sign: -1 });
}
