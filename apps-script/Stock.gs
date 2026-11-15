/**
 * Stock — persediaan perpetual metode rata-rata tertimbang (moving average).
 *
 * Hanya produk tipe "barang" dengan lacak_stok = "ya", dan hanya bila modul persediaan aktif.
 * Setiap mutasi menyimpan qty (+ masuk / − keluar) dan nilai (Rp) — saldo persediaan = jumlah nilai mutasi aktif,
 * sehingga selalu sama dengan jurnal yang dibuat bersamaan.
 *
 * Sumber mutasi: pembelian (BELI), penjualan (INV), penyesuaian (ADJ: pemakaian bahan, stok opname, stok awal).
 */

const AKUN_PERSEDIAAN = '1-1401';
const AKUN_HPP = '5-1101';
const AKUN_SELISIH_STOK = '5-1301';
const ADJ_TYPES = { pemakaian: 'Pemakaian bahan', opname: 'Stok opname', awal: 'Stok awal' };

function productsMap_() {
  const m = {};
  masterRows_(MASTER.produk).forEach(function (x) {
    ['harga_beli', 'harga_jual', 'stok_min', 'stok_max'].forEach(function (k) { x[k] = Number(x[k]) || 0; });
    x.lacak_stok = String(x.lacak_stok || '');
    m[x.id] = x;
  });
  return m;
}

function isTracked_(prod) {
  return !!prod && prod.tipe === 'barang' && prod.lacak_stok === 'ya' && moduleActive_('persediaan');
}

function invAccount_(prod) { return (prod && prod.akun_persediaan) || AKUN_PERSEDIAAN; }
function cogsAccount_(prod) { return (prod && prod.akun_hpp) || AKUN_HPP; }

function stockRows_() {
  return readTable_('T_StokMutasi').map(function (r) {
    r.tgl = ymd_(r.tgl);
    r.qty = Number(r.qty) || 0;
    r.harga = Number(r.harga) || 0;
    r.nilai = Number(r.nilai) || 0;
    r.status = r.status || 'aktif';
    r.produk_id = String(r.produk_id);
    return r;
  }).sort(function (a, b) {
    if (a.tgl !== b.tgl) return a.tgl < b.tgl ? -1 : 1;
    return String(a.dibuat_pada).localeCompare(String(b.dibuat_pada));
  });
}

/** Posisi stok per produk: { qty, nilai (sen) } dari mutasi aktif s/d tanggal `to`. */
function stockPositions_(to) {
  const pos = {};
  stockRows_().forEach(function (r) {
    if (r.status !== 'aktif' || (to && r.tgl > to)) return;
    const p = pos[r.produk_id] || (pos[r.produk_id] = { qty: 0, nilai: 0, last: 0 });
    p.qty = Math.round((p.qty + r.qty) * 10000) / 10000;
    p.nilai += cents_(r.nilai);
    if (r.qty > 0 && r.harga) p.last = cents_(r.harga);
  });
  return pos;
}

/**
 * Hitung nilai keluar untuk beberapa item TANPA menulis apa pun (validasi dulu, tulis setelah jurnal berhasil).
 * items: [{ produk_id, qty }]. Mengembalikan [{ produk_id, qty, nilai (sen), harga (sen/unit) }].
 */
function planStockOut_(items, prods) {
  const pos = stockPositions_();
  const allowNeg = getSetting_('stok_minus_boleh') === 'ya';
  const used = {};
  return items.map(function (it) {
    const p = pos[it.produk_id] || { qty: 0, nilai: 0, last: 0 };
    const u = used[it.produk_id] || (used[it.produk_id] = { qty: 0, nilai: 0 });
    const qtyLeft = Math.round((p.qty - u.qty) * 10000) / 10000;
    const valLeft = p.nilai - u.nilai;
    const prod = prods[it.produk_id];
    if (it.qty > qtyLeft + 1e-9 && !allowNeg) {
      throw new ApiError_('STOCK_SHORT', 'Stok ' + prod.nama + ' tidak cukup: tersedia ' + fmtQty_(qtyLeft) + ' ' + (prod.satuan || '') + ', dibutuhkan ' + fmtQty_(it.qty) + '.');
    }
    var nilai;
    if (Math.abs(it.qty - qtyLeft) < 1e-9 && qtyLeft > 0) nilai = valLeft;              // habis → ambil sisa nilai persis
    else if (qtyLeft > 0) nilai = Math.round(valLeft / qtyLeft * it.qty);
    else nilai = Math.round((p.last || cents_(prod.harga_beli)) * it.qty);             // stok minus (bila diizinkan)
    u.qty += it.qty;
    u.nilai += nilai;
    return { produk_id: it.produk_id, qty: it.qty, nilai: nilai, harga: it.qty ? nilai / it.qty : 0 };
  });
}

function fmtQty_(q) {
  return String(Math.round(q * 100) / 100).replace('.', ',');
}

/** Tulis mutasi. rows: [{ produk_id, qty (+/−), nilai (sen, bertanda sama), jenis, ref_no, keterangan }] */
function writeStock_(ctx, tgl, sumber, jurnalId, rows) {
  if (!rows.length) return;
  const now = new Date();
  appendObjects_('T_StokMutasi', rows.map(function (r) {
    return {
      id: newId_('STK'), tgl: asText_(tgl), produk_id: r.produk_id, gudang_id: 'UTAMA', qty: r.qty,
      harga: r.qty ? money_(Math.round(Math.abs(r.nilai / r.qty))) : 0, nilai: money_(r.nilai),
      batch: '', serial: '', exp: '', sumber_dok: sumber, jenis: r.jenis, ref_no: asText_(r.ref_no || ''),
      keterangan: asText_(r.keterangan || ''), status: 'aktif', jurnal_id: jurnalId || '', dibuat_oleh: ctx.session.username, dibuat_pada: now,
    };
  }));
}

/** Batalkan semua mutasi dari satu dokumen. Untuk mutasi masuk, pastikan stoknya belum terpakai. */
function voidStockOf_(sumber, prods) {
  const rows = stockRows_().filter(function (r) { return r.sumber_dok === sumber && r.status === 'aktif'; });
  if (!rows.length) return 0;
  const pos = stockPositions_();
  const net = {};
  rows.forEach(function (r) { net[r.produk_id] = (net[r.produk_id] || 0) + r.qty; });
  Object.keys(net).forEach(function (pid) {
    const left = (pos[pid] || { qty: 0 }).qty - net[pid];
    if (left < -1e-9 && getSetting_('stok_minus_boleh') !== 'ya') {
      const prod = prods[pid] || { nama: pid, satuan: '' };
      throw new ApiError_('STOCK_SHORT', 'Tidak bisa dibatalkan: stok ' + prod.nama + ' akan menjadi ' + fmtQty_(left) + ' ' + prod.satuan +
        ' karena sebagian sudah terjual/terpakai. Batalkan transaksi keluarnya dulu.');
    }
  });
  rows.forEach(function (r) { updateWhere_('T_StokMutasi', 'id', r.id, { status: 'batal' }); });
  return rows.length;
}

// ---------------------------------------------------------------- daftar & kartu stok

function actionStockList_(p) {
  const to = p.per ? ymd_(p.per) : todayYmd_();
  const prods = productsMap_();
  const pos = stockPositions_(to);
  var rows = Object.keys(prods).map(function (k) { return prods[k]; })
    .filter(function (x) { return x.tipe === 'barang' && (x.lacak_stok === 'ya' || pos[x.id]); })
    .map(function (x) {
      const ps = pos[x.id] || { qty: 0, nilai: 0 };
      return {
        id: x.id, sku: x.sku, nama: x.nama, satuan: x.satuan, aktif: x.aktif, lacak: x.lacak_stok === 'ya',
        qty: ps.qty, nilai: money_(ps.nilai), rata: ps.qty > 0 ? money_(Math.round(ps.nilai / ps.qty)) : 0,
        stok_min: x.stok_min, stok_max: x.stok_max, harga_beli: x.harga_beli, harga_jual: x.harga_jual,
        rendah: x.stok_min > 0 && ps.qty <= x.stok_min, akun: invAccount_(x),
      };
    });
  if (p.q) {
    const q = String(p.q).toLowerCase();
    rows = rows.filter(function (r) { return (r.sku + ' ' + r.nama).toLowerCase().indexOf(q) >= 0; });
  }
  rows.sort(function (a, b) { return a.nama.localeCompare(b.nama); });
  const accs = {};
  accs[AKUN_PERSEDIAAN] = true;
  rows.forEach(function (r) { accs[r.akun] = true; });
  var gl = 0;
  Object.keys(accs).forEach(function (a) { gl += balanceAt_(a, to); });
  const total = rows.reduce(function (t, r) { return t + cents_(r.nilai); }, 0);
  return { per: to, rows: rows, total: money_(total), gl: money_(gl), akun: Object.keys(accs), rendah: rows.filter(function (r) { return r.rendah; }).length };
}

function actionStockCard_(p) {
  const prods = productsMap_();
  const prod = prods[p.produk_id];
  if (!prod) throw new ApiError_('NOT_FOUND', 'Produk tidak ditemukan.');
  const from = p.from ? ymd_(p.from) : '0000-01-01';
  const to = p.to ? ymd_(p.to) : '9999-12-31';
  var qty = 0, nilai = 0, oQty = 0, oNilai = 0;
  const rows = [];
  stockRows_().forEach(function (r) {
    if (r.produk_id !== prod.id || r.status !== 'aktif' || r.tgl > to) return;
    qty = Math.round((qty + r.qty) * 10000) / 10000;
    nilai += cents_(r.nilai);
    if (r.tgl < from) { oQty = qty; oNilai = nilai; return; }
    rows.push({ tgl: r.tgl, jenis: r.jenis, ref_no: r.ref_no, keterangan: r.keterangan, sumber_dok: r.sumber_dok,
      masuk: r.qty > 0 ? r.qty : 0, keluar: r.qty < 0 ? -r.qty : 0, harga: r.harga, nilai: r.nilai, saldo_qty: qty, saldo_nilai: money_(nilai) });
  });
  return { produk: { id: prod.id, sku: prod.sku, nama: prod.nama, satuan: prod.satuan }, awal: { qty: oQty, nilai: money_(oNilai) }, rows: rows,
    akhir: { qty: qty, nilai: money_(nilai), rata: qty > 0 ? money_(Math.round(nilai / qty)) : 0 } };
}

// ---------------------------------------------------------------- penyesuaian: pemakaian, opname, stok awal

function adjRows_() {
  return docRows_('ADJ');
}

function actionStockAdjList_(p) {
  var rows = adjRows_();
  if (p.from) rows = rows.filter(function (r) { return r.tgl >= p.from; });
  if (p.to) rows = rows.filter(function (r) { return r.tgl <= p.to; });
  rows.sort(function (a, b) { return a.tgl < b.tgl ? 1 : a.tgl > b.tgl ? -1 : String(b.dibuat_pada).localeCompare(String(a.dibuat_pada)); });
  return rows.slice(0, Math.min(Number(p.limit) || 100, 300));
}

/**
 * p: { tgl, jenis: pemakaian|opname|awal, keterangan, akun_id (pemakaian; default 5-1101),
 *      items: [{ produk_id, qty }] — pemakaian: qty keluar · opname: qty fisik · awal: qty + harga }
 */
function actionStockAdjust_(p, ctx) {
  const tgl = ymd_(p.tgl);
  if (!tgl) throw new ApiError_('VALIDATION', 'Tanggal wajib diisi.');
  const jenis = String(p.jenis || '');
  if (!ADJ_TYPES[jenis]) throw new ApiError_('VALIDATION', 'Jenis penyesuaian tidak dikenal.');
  const ket = String(p.keterangan || '').trim();
  if (!ket) throw new ApiError_('VALIDATION', 'Keterangan wajib diisi.');
  return withLock_(function () {
    const prods = productsMap_();
    const accs = accountsMap_();
    const seen = {};
    const items = [];
    (p.items || []).forEach(function (it, i) {
      if (!it.produk_id) return;
      const prod = prods[it.produk_id];
      if (!isTracked_(prod)) throw new ApiError_('VALIDATION', 'Baris ' + (i + 1) + ': produk ini tidak dilacak stoknya.');
      if (seen[it.produk_id]) throw new ApiError_('VALIDATION', 'Baris ' + (i + 1) + ': ' + prod.nama + ' tercantum dua kali.');
      seen[it.produk_id] = true;
      const qty = Number(String(it.qty === undefined ? '' : it.qty).replace(',', '.'));
      if (!isFinite(qty) || qty < 0 || (jenis !== 'opname' && qty === 0)) throw new ApiError_('VALIDATION', 'Baris ' + (i + 1) + ': kuantitas ' + prod.nama + ' tidak valid.');
      items.push({ produk_id: it.produk_id, qty: qty, harga: cents_(it.harga || 0), prod: prod });
    });
    if (!items.length) throw new ApiError_('VALIDATION', 'Isi minimal satu barang.');
    const id = newId_('ADJ');
    const moves = [];
    const jl = [];
    if (jenis === 'pemakaian') {
      const akun = String(p.akun_id || AKUN_HPP);
      const a = accs[akun];
      if (!a || bool_(a.is_header)) throw new ApiError_('VALIDATION', 'Pilih akun pemakaian (mis. 5-1101 HPP).');
      planStockOut_(items, prods).forEach(function (o, i) {
        const prod = items[i].prod;
        moves.push({ produk_id: o.produk_id, qty: -o.qty, nilai: -o.nilai, jenis: 'pemakaian', keterangan: ket });
        jl.push({ akun_id: akun, memo: prod.nama, debit: money_(o.nilai), kredit: 0 });
        jl.push({ akun_id: invAccount_(prod), memo: prod.nama, debit: 0, kredit: money_(o.nilai) });
      });
    } else if (jenis === 'opname') {
      const pos = stockPositions_();
      items.forEach(function (it) {
        const ps = pos[it.produk_id] || { qty: 0, nilai: 0, last: 0 };
        const diff = Math.round((it.qty - ps.qty) * 10000) / 10000;
        if (Math.abs(diff) < 1e-9) return;
        var nilai;
        if (diff < 0) nilai = planStockOut_([{ produk_id: it.produk_id, qty: -diff }], prods)[0].nilai;
        else nilai = Math.round((ps.qty > 0 ? ps.nilai / ps.qty : (ps.last || cents_(it.prod.harga_beli))) * diff);
        const signed = diff > 0 ? nilai : -nilai;
        moves.push({ produk_id: it.produk_id, qty: diff, nilai: signed, jenis: 'opname', keterangan: ket + ' (sistem ' + fmtQty_(ps.qty) + ', fisik ' + fmtQty_(it.qty) + ')' });
        if (nilai) {
          jl.push({ akun_id: invAccount_(it.prod), memo: 'Selisih opname ' + it.prod.nama, debit: diff > 0 ? money_(nilai) : 0, kredit: diff < 0 ? money_(nilai) : 0 });
          jl.push({ akun_id: AKUN_SELISIH_STOK, memo: 'Selisih opname ' + it.prod.nama, debit: diff < 0 ? money_(nilai) : 0, kredit: diff > 0 ? money_(nilai) : 0 });
        }
      });
      if (!moves.length) throw new ApiError_('VALIDATION', 'Semua jumlah fisik sama dengan sistem — tidak ada selisih untuk dicatat.');
    } else {
      items.forEach(function (it) {
        if (it.harga <= 0) throw new ApiError_('VALIDATION', 'Isi harga pokok per satuan untuk ' + it.prod.nama + '.');
        moves.push({ produk_id: it.produk_id, qty: it.qty, nilai: Math.round(it.qty * it.harga), jenis: 'awal', keterangan: ket });
      });
    }
    var head = null;
    if (jl.length) {
      assertOpen_(tgl);
      head = postJournal_(ctx, { tgl: tgl, jenis: 'PS', keterangan: ADJ_TYPES[jenis] + ': ' + ket, ref_dok: id, lines: jl });
    }
    const no = head ? head.no : 'SA-STOK/' + tgl.replace(/-/g, '') + '/' + id.slice(-4);
    moves.forEach(function (m) { m.ref_no = no; });
    writeStock_(ctx, tgl, id, head ? head.id : '', moves);
    const total = moves.reduce(function (t, m) { return t + Math.abs(m.nilai); }, 0);
    appendObjects_('T_Dokumen', [{
      id: id, jenis: 'ADJ', no: asText_(no), tgl: asText_(tgl), status: 'posted', subtotal: 0, diskon: 0, pajak: 0, total: money_(total), sisa: 0,
      catatan: asText_(ket), referensi: asText_(jenis), jurnal_id: head ? head.id : '', ref_id: head ? head.no : '',
      lines_json: JSON.stringify(moves.map(function (m) { return { produk_id: m.produk_id, deskripsi: prods[m.produk_id].nama, satuan: prods[m.produk_id].satuan, qty: m.qty, nilai: money_(m.nilai) }; })),
      dibuat_oleh: ctx.session.username, dibuat_pada: new Date(), diposting_oleh: ctx.session.username, diposting_pada: new Date(),
    }]);
    audit_(ctx, 'STOK_' + jenis.toUpperCase(), 'T_StokMutasi', no, null, { baris: moves.length, nilai: money_(total) }, ket);
    return { id: id, no: no, baris: moves.length, nilai: money_(total) };
  });
}

function actionStockAdjVoid_(p, ctx) {
  const alasan = String(p.alasan || '').trim();
  if (!alasan) throw new ApiError_('VALIDATION', 'Alasan pembatalan wajib diisi.');
  return withLock_(function () {
    const d = adjRows_().filter(function (r) { return r.id === p.id; })[0];
    if (!d) throw new ApiError_('NOT_FOUND', 'Penyesuaian tidak ditemukan.');
    if (d.status === 'batal') throw new ApiError_('VALIDATION', 'Penyesuaian ini sudah dibatalkan.');
    const prods = productsMap_();
    var pembalik = '';
    if (d.jurnal_id) {
      const j = actionJournalGet_({ id: d.jurnal_id });
      assertOpen_(j.tgl);
      voidStockOf_(d.id, prods);
      const linesC = j.lines.map(function (l) { return { akun_id: l.akun_id, memo: l.memo, debit: cents_(l.debit), kredit: cents_(l.kredit) }; });
      pembalik = reverseJournal_(ctx, j, linesC, j.tgl, 'Pembatalan ' + j.no + ': ' + alasan, true).no;
      updateWhere_('T_Jurnal', 'id', j.id, { status: 'batal', alasan_batal: alasan, dibatalkan_oleh: ctx.session.username, dibatalkan_pada: new Date() });
    } else {
      voidStockOf_(d.id, prods);
    }
    updateWhere_('T_Dokumen', 'id', d.id, { status: 'batal', alasan_batal: asText_(alasan), dibatalkan_oleh: ctx.session.username, dibatalkan_pada: new Date() });
    audit_(ctx, 'BATAL', 'T_StokMutasi', d.no, null, null, alasan);
    return { id: d.id, status: 'batal', pembalik: pembalik };
  });
}
