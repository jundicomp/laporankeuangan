/**
 * Budget — anggaran laba rugi per akun per bulan, realisasi vs anggaran, dan analisis rasio keuangan.
 *
 * Angka anggaran disimpan "alami" per akun (positif searah saldo normal): pendapatan positif, beban positif.
 * Sumbangan ke laba = angka × (+1 bila saldo normal kredit, −1 bila debit).
 */

/** 12 bulan tahun buku mulai fs. */
function fiscalMonths_(fs) {
  const out = [];
  for (var i = 0; i < 12; i++) out.push(ymAdd_(fs.slice(0, 7), i));
  return out;
}

/** Mutasi akun laba rugi per bulan (sen, arah saldo normal) dalam [from, to], tanpa jurnal penutup. */
function plMonthly_(from, to) {
  const eff = effectiveIds_();
  const accs = accountsMap_();
  const m = {};
  journalLines_().forEach(function (d) {
    if (!eff.ids[d.jurnal_id]) return;
    const h = eff.heads[d.jurnal_id];
    if (h.tgl < from || h.tgl > to || h.jenis === 'JT') return;
    const a = accs[d.akun_id];
    if (!a || !PL_TYPES[a.tipe]) return;
    const ym = h.tgl.slice(0, 7);
    const c = (cents_(d.debit) - cents_(d.kredit)) * (a.saldo_normal === 'K' ? -1 : 1);
    const r = m[d.akun_id] || (m[d.akun_id] = {});
    r[ym] = (r[ym] || 0) + c;
  });
  return m;
}

function budgetRows_(months) {
  const set = {};
  months.forEach(function (m) { set[m] = true; });
  return readTable_('T_Anggaran').map(function (r) { r.periode = ym_(r.periode); r.akun_id = String(r.akun_id); r.jumlah = Number(r.jumlah) || 0; return r; })
    .filter(function (r) { return set[r.periode]; });
}

/** p: { tahun_mulai | tanggal } — anggaran, realisasi, dan realisasi tahun lalu per akun per bulan. */
function actionBudgetGet_(p) {
  const fs = closingYear_(p);
  const fe = fiscalEnd_(fs);
  const months = fiscalMonths_(fs);
  const pfs = (Number(fs.slice(0, 4)) - 1) + fs.slice(4);
  const pfe = dayBefore_(fs);
  const prevMonths = fiscalMonths_(pfs);
  const map = accountsTree_();
  const real = plMonthly_(fs, fe);
  const prev = plMonthly_(pfs, pfe);
  const bud = {};
  var diubah = null;
  budgetRows_(months).forEach(function (r) {
    const arr = bud[r.akun_id] || (bud[r.akun_id] = months.map(function () { return 0; }));
    arr[months.indexOf(r.periode)] += r.jumlah;
    if (r.diubah_pada && (!diubah || new Date(r.diubah_pada) > new Date(diubah.pada))) diubah = { oleh: r.diubah_oleh, pada: r.diubah_pada };
  });
  const accounts = leavesSorted_(map).filter(function (a) {
    return PL_TYPES[a.tipe] && (bool_(a.aktif) || a.aktif === '' || real[a.kode] || prev[a.kode] || bud[a.kode]);
  }).map(function (a) {
    const g = groupOf_(a, map);
    return { kode: a.kode, nama: a.nama, tipe: a.tipe, saldo_normal: a.saldo_normal, grup: g ? g.nama : '' };
  });
  const arr = function (src, ms) { const o = {}; Object.keys(src).forEach(function (k) { o[k] = ms.map(function (m) { return money_(src[k][m] || 0); }); }); return o; };
  return {
    from: fs, to: fe, months: months, accounts: accounts, anggaran: bud, realisasi: arr(real, months), lalu: arr(prev, prevMonths),
    hari_ini: todayYmd_(), diubah: diubah,
  };
}

/** p: { tahun_mulai, rows: [{ akun_id, bulan: [12 angka] }] } — mengganti seluruh anggaran tahun buku itu. */
function actionBudgetSave_(p, ctx) {
  const fs = closingYear_(p);
  const months = fiscalMonths_(fs);
  const accs = accountsMap_();
  const out = [];
  const seen = {};
  var total = 0;
  (p.rows || []).forEach(function (r) {
    const k = String(r.akun_id || '');
    const a = accs[k];
    if (!a || bool_(a.is_header) || !PL_TYPES[a.tipe]) throw new ApiError_('VALIDATION', 'Akun ' + k + ' bukan akun laba rugi.');
    if (seen[k]) throw new ApiError_('VALIDATION', 'Akun ' + k + ' tercantum dua kali.');
    seen[k] = true;
    if (!Array.isArray(r.bulan) || r.bulan.length !== 12) throw new ApiError_('VALIDATION', 'Anggaran akun ' + k + ' harus 12 bulan.');
    r.bulan.forEach(function (v, i) {
      const c = cents_(v || 0);
      if (c < 0) throw new ApiError_('VALIDATION', 'Anggaran ' + a.nama + ' bulan ' + months[i] + ' tidak boleh minus.');
      if (c) { out.push({ periode: months[i], akun_id: k, jumlah: money_(c) }); total += c; }
    });
  });
  return withLock_(function () {
    const sh = getSheet_('T_Anggaran');
    const values = sh.getDataRange().getValues();
    const head = values[0].map(String);
    const cp = head.indexOf('periode');
    const set = {};
    months.forEach(function (m) { set[m] = true; });
    // tulis ulang tab tanpa baris tahun ini (lebih cepat daripada hapus baris satu per satu)
    const keep = values.slice(1).filter(function (row) { return !set[ym_(row[cp])]; })
      .map(function (row) { return row.map(function (c) { return typeof c === 'string' && c !== '' ? "'" + c : c; }); });
    if (values.length > 1) sh.getRange(2, 1, values.length - 1, head.length).clearContent();
    if (keep.length) sh.getRange(2, 1, keep.length, head.length).setValues(keep);
    invalidate_('T_Anggaran');
    const now = new Date();
    appendObjects_('T_Anggaran', out.map(function (o) {
      return { periode: asText_(o.periode), cabang_id: '', divisi: '', akun_id: asText_(o.akun_id), jumlah: o.jumlah, diubah_oleh: ctx.session.username, diubah_pada: now };
    }));
    audit_(ctx, 'SIMPAN_ANGGARAN', 'T_Anggaran', fs.slice(0, 7), null, { akun: Object.keys(seen).length, baris: out.length }, '');
    return { tahun_mulai: fs, akun: Object.keys(seen).length, baris: out.length };
  });
}

/** Ringkasan s/d bulan `to` untuk peringatan dashboard (sen). */
function budgetYtd_(to) {
  const fs = fiscalStart_(to);
  const months = fiscalMonths_(fs).filter(function (m) { return m <= to.slice(0, 7); });
  const rows = budgetRows_(months);
  if (!rows.length) return null;
  const accs = accountsMap_();
  const real = plMonthly_(fs, to);
  const sum = { pendapatan: [0, 0], beban: [0, 0] };
  const bucket = function (a) { return a.tipe === 'pendapatan' ? 'pendapatan' : a.tipe === 'beban' || a.tipe === 'hpp' ? 'beban' : null; };
  rows.forEach(function (r) { const a = accs[r.akun_id]; const b = a && bucket(a); if (b) sum[b][0] += cents_(r.jumlah) * (a.saldo_normal === 'K' ? 1 : -1) * (b === 'beban' ? -1 : 1); });
  Object.keys(real).forEach(function (k) {
    const a = accs[k]; const b = a && bucket(a); if (!b) return;
    months.forEach(function (m) { sum[b][1] += (real[k][m] || 0) * (a.saldo_normal === 'K' ? 1 : -1) * (b === 'beban' ? -1 : 1); });
  });
  return { sampai: months[months.length - 1], pendapatan: { anggaran: sum.pendapatan[0], realisasi: sum.pendapatan[1] }, beban: { anggaran: sum.beban[0], realisasi: sum.beban[1] } };
}

// ---------------------------------------------------------------- analisis rasio

function ratioBase_(from, to) {
  const map = accountsTree_();
  const cash = {};
  kasbankRows_().forEach(function (k) { cash[k.akun_id] = true; });
  const bal = netBy_('0000-00-00', to, null);
  const open = openingBy_(from, to); // saldo awal (SA) dalam periode dihitung pembuka
  const pl = netBy_(from, to, NOT_CLOSING_);
  const leaves = leavesSorted_(map);
  const sumBy = function (src, f, sign) { return leaves.filter(f).reduce(function (t, a) { return t + (src[a.kode] || 0); }, 0) * (sign || 1); };
  const is = function (pre) { return function (a) { return a.kode.indexOf(pre) === 0; }; };
  const tipe = function (t) { return function (a) { return a.tipe === t; }; };
  const and = function (f, g) { return function (a) { return f(a) && g(a); }; };
  const isCash = function (a) { return cash[a.kode] || (a.tipe === 'aset' && a.kode.indexOf('1-11') === 0); };
  const isAR = function (a) { return a.tipe === 'aset' && a.kode.indexOf('1-13') === 0 && a.kode !== '1-1302'; };
  const isBank = function (a) { return a.tipe === 'liabilitas' && (a.kode.indexOf('2-2') === 0 || a.kode === '2-1501' || /utang bank|pinjaman/i.test(a.nama)); };
  const isInterest = function (a) { return a.kode === '7-2101' || (a.tipe === 'lain' && a.saldo_normal === 'D' && /bunga/i.test(a.nama)); };
  const isDep = function (a) { return (a.tipe === 'beban' || a.tipe === 'hpp') && /penyusutan|amortisasi/i.test(a.nama); };
  const snap = function (src) {
    return {
      aset: sumBy(src, tipe('aset')), aset_lancar: sumBy(src, and(tipe('aset'), is('1-1'))), kas: sumBy(src, isCash),
      piutang: sumBy(src, isAR), persediaan: sumBy(src, and(tipe('aset'), is('1-14'))),
      liabilitas: sumBy(src, tipe('liabilitas'), -1), liab_lancar: sumBy(src, and(tipe('liabilitas'), is('2-1')), -1),
      utang_usaha: sumBy(src, and(tipe('liabilitas'), is('2-11')), -1), utang_bank: sumBy(src, isBank, -1),
    };
  };
  const b = snap(bal), o = snap(open);
  b.ekuitas = b.aset - b.liabilitas; o.ekuitas = o.aset - o.liabilitas;
  const r = {
    pendapatan: sumBy(pl, tipe('pendapatan'), -1), hpp: sumBy(pl, tipe('hpp')), beban: sumBy(pl, tipe('beban')),
    lain: sumBy(pl, tipe('lain'), -1), pajak: sumBy(pl, tipe('pajak')), bunga: sumBy(pl, isInterest), penyusutan: sumBy(pl, isDep),
  };
  r.laba_kotor = r.pendapatan - r.hpp;
  r.laba_usaha = r.laba_kotor - r.beban;
  r.laba_bersih = r.laba_usaha + r.lain - r.pajak;
  r.ebit = r.laba_bersih + r.pajak + r.bunga;
  r.ebitda = r.ebit + r.penyusutan;
  return { from: from, to: to, hari: daysBetween_(from, to) + 1, akhir: b, awal: o, lr: r };
}

const RATIO_DEFS_ = [
  { grup: 'Likuiditas', kode: 'current', nama: 'Rasio lancar (current ratio)', satuan: 'x', rumus: 'Aset lancar ÷ liabilitas jangka pendek', baik: 1.5, waspada: 1,
    arti: 'Kemampuan membayar kewajiban jangka pendek dengan aset lancar. Bank umumnya mencari ≥ 1,2–1,5 kali.' },
  { grup: 'Likuiditas', kode: 'quick', nama: 'Rasio cepat (quick ratio)', satuan: 'x', rumus: '(Aset lancar − persediaan) ÷ liabilitas jangka pendek', baik: 1, waspada: 0.7,
    arti: 'Seperti rasio lancar tanpa persediaan, yang paling lama dicairkan.' },
  { grup: 'Likuiditas', kode: 'cash', nama: 'Rasio kas', satuan: 'x', rumus: 'Kas & bank ÷ liabilitas jangka pendek', baik: 0.5, waspada: 0.2,
    arti: 'Seberapa banyak kewajiban jangka pendek yang bisa dilunasi hari ini dengan uang yang ada.' },
  { grup: 'Likuiditas', kode: 'modal_kerja', nama: 'Modal kerja bersih', satuan: 'Rp', rumus: 'Aset lancar − liabilitas jangka pendek', baik: 0.0001, waspada: 0,
    arti: 'Dana yang tersisa untuk operasional setelah kewajiban jangka pendek tertutup.' },
  { grup: 'Solvabilitas', kode: 'der', nama: 'Utang terhadap ekuitas (DER)', satuan: 'x', rumus: 'Total liabilitas ÷ ekuitas', baik: 1, waspada: 2, rendah: true,
    arti: 'Seberapa besar usaha dibiayai utang dibanding modal sendiri. Makin kecil makin aman.' },
  { grup: 'Solvabilitas', kode: 'dar', nama: 'Utang terhadap aset (DAR)', satuan: '%', rumus: 'Total liabilitas ÷ total aset', baik: 50, waspada: 70, rendah: true,
    arti: 'Porsi aset yang dibiayai utang.' },
  { grup: 'Solvabilitas', kode: 'debt_ebitda', nama: 'Utang bank terhadap EBITDA', satuan: 'x', rumus: 'Utang bank ÷ EBITDA setahun', baik: 3, waspada: 4, rendah: true,
    arti: 'Berapa tahun laba operasi (sebelum penyusutan) dibutuhkan untuk melunasi utang bank.' },
  { grup: 'Solvabilitas', kode: 'icr', nama: 'Kemampuan bayar bunga (ICR)', satuan: 'x', rumus: 'EBIT ÷ beban bunga', baik: 3, waspada: 1.5,
    arti: 'Berapa kali laba operasi menutup beban bunga. Bank umumnya mensyaratkan ≥ 1,5–2 kali.' },
  { grup: 'Profitabilitas', kode: 'gpm', nama: 'Margin laba kotor', satuan: '%', rumus: 'Laba kotor ÷ pendapatan', arti: 'Sisa pendapatan setelah beban pokok penjualan.' },
  { grup: 'Profitabilitas', kode: 'opm', nama: 'Margin laba usaha', satuan: '%', rumus: 'Laba usaha ÷ pendapatan', baik: 10, waspada: 0, arti: 'Keuntungan dari kegiatan utama sebelum pendapatan/beban lain dan pajak.' },
  { grup: 'Profitabilitas', kode: 'npm', nama: 'Margin laba bersih', satuan: '%', rumus: 'Laba bersih ÷ pendapatan', baik: 10, waspada: 0, arti: 'Keuntungan bersih dari setiap Rp100 pendapatan.' },
  { grup: 'Profitabilitas', kode: 'roa', nama: 'Imbal hasil aset (ROA)', satuan: '%', rumus: 'Laba bersih setahun ÷ rata-rata total aset', baik: 5, waspada: 0, arti: 'Seberapa efektif aset menghasilkan laba.' },
  { grup: 'Profitabilitas', kode: 'roe', nama: 'Imbal hasil ekuitas (ROE)', satuan: '%', rumus: 'Laba bersih setahun ÷ rata-rata ekuitas', baik: 10, waspada: 0, arti: 'Hasil yang diterima pemilik atas modalnya.' },
  { grup: 'Aktivitas', kode: 'dso', nama: 'Rata-rata umur piutang (DSO)', satuan: 'hari', rumus: 'Rata-rata piutang ÷ pendapatan × hari', baik: 45, waspada: 90, rendah: true,
    arti: 'Berapa hari rata-rata pelanggan membayar.' },
  { grup: 'Aktivitas', kode: 'dio', nama: 'Rata-rata umur persediaan (DIO)', satuan: 'hari', rumus: 'Rata-rata persediaan ÷ HPP × hari', baik: 60, waspada: 120, rendah: true,
    arti: 'Berapa hari barang tersimpan sebelum terjual/terpakai.' },
  { grup: 'Aktivitas', kode: 'dpo', nama: 'Rata-rata umur utang usaha (DPO)', satuan: 'hari', rumus: 'Rata-rata utang usaha ÷ HPP × hari', arti: 'Berapa hari rata-rata usaha membayar supplier.' },
  { grup: 'Aktivitas', kode: 'ccc', nama: 'Siklus konversi kas', satuan: 'hari', rumus: 'DSO + DIO − DPO', baik: 60, waspada: 120, rendah: true,
    arti: 'Berapa hari uang tertahan dari membeli barang sampai menerima pembayaran pelanggan.' },
  { grup: 'Aktivitas', kode: 'tato', nama: 'Perputaran total aset', satuan: 'x', rumus: 'Pendapatan setahun ÷ rata-rata total aset', arti: 'Berapa rupiah pendapatan per Rp1 aset dalam setahun.' },
];

function ratioValues_(x) {
  const a = x.akhir, o = x.awal, l = x.lr;
  const div = function (n, d) { return d > 0 ? n / d : null; };
  const avg = function (k) { return (a[k] + o[k]) / 2; };
  const yr = 365 / x.hari;
  const v = {};
  v.current = div(a.aset_lancar, a.liab_lancar);
  v.quick = div(a.aset_lancar - a.persediaan, a.liab_lancar);
  v.cash = div(a.kas, a.liab_lancar);
  v.modal_kerja = money_(a.aset_lancar - a.liab_lancar);
  v.der = a.ekuitas > 0 ? a.liabilitas / a.ekuitas : (a.liabilitas > 0 ? Infinity : null);
  v.dar = div(a.liabilitas * 100, a.aset);
  v.debt_ebitda = a.utang_bank > 0 ? (l.ebitda > 0 ? a.utang_bank / (l.ebitda * yr) : Infinity) : null;
  v.icr = l.bunga > 0 ? l.ebit / l.bunga : null;
  v.gpm = div(l.laba_kotor * 100, l.pendapatan);
  v.opm = div(l.laba_usaha * 100, l.pendapatan);
  v.npm = div(l.laba_bersih * 100, l.pendapatan);
  v.roa = div(l.laba_bersih * yr * 100, avg('aset'));
  v.roe = avg('ekuitas') > 0 ? l.laba_bersih * yr * 100 / avg('ekuitas') : null;
  v.dso = avg('piutang') > 0 ? div(avg('piutang') * x.hari, l.pendapatan) : (l.pendapatan > 0 ? 0 : null);
  v.dio = avg('persediaan') > 0 ? div(avg('persediaan') * x.hari, l.hpp) : null; // usaha tanpa stok: tidak relevan
  v.dpo = avg('utang_usaha') > 0 ? div(avg('utang_usaha') * x.hari, l.hpp) : (l.hpp > 0 ? 0 : null);
  v.ccc = v.dso === null && v.dio === null ? null : (v.dso || 0) + (v.dio || 0) - (v.dpo || 0);
  v.tato = div(l.pendapatan * yr, avg('aset'));
  return v;
}

function ratioStatus_(d, v) {
  if (v === null || v === undefined) return 'na';
  if (d.baik === undefined) return 'netral';
  if (d.rendah) return v <= d.baik ? 'baik' : v <= d.waspada ? 'waspada' : 'buruk';
  if (v >= d.baik) return 'baik';
  return (d.waspada === 0 ? v > 0 : v >= d.waspada) ? 'waspada' : 'buruk';
}

/** p: { to, from? } — rasio periode ini dan periode yang sama tahun lalu. */
function actionRatioGet_(p) {
  const to = ymd_(p.to || todayYmd_());
  const from = p.from ? ymd_(p.from) : fiscalStart_(to);
  if (from > to) throw new ApiError_('VALIDATION', 'Tanggal awal setelah tanggal akhir.');
  const back = function (d) { return (Number(d.slice(0, 4)) - 1) + d.slice(4); };
  const cur = ratioBase_(from, to);
  const prev = ratioBase_(back(from), back(to).slice(5) === '02-29' ? back(to).slice(0, 8) + '28' : back(to));
  const vc = ratioValues_(cur), vp = ratioValues_(prev);
  const fix = function (v) { return v === null ? null : v === Infinity ? 'tak_hingga' : Math.round(v * 100) / 100; };
  const money = function (o) { const r = {}; Object.keys(o).forEach(function (k) { r[k] = money_(o[k]); }); return r; };
  return {
    from: from, to: to, lalu: { from: prev.from, to: prev.to }, hari: cur.hari,
    rasio: RATIO_DEFS_.map(function (d) {
      return { grup: d.grup, kode: d.kode, nama: d.nama, satuan: d.satuan, rumus: d.rumus, arti: d.arti, rendah: !!d.rendah, baik: d.baik, waspada: d.waspada,
        nilai: fix(vc[d.kode]), lalu: fix(vp[d.kode]), status: ratioStatus_(d, vc[d.kode]) };
    }),
    dasar: { akhir: money(cur.akhir), awal: money(cur.awal), lr: money(cur.lr), lalu_akhir: money(prev.akhir), lalu_lr: money(prev.lr) },
  };
}
