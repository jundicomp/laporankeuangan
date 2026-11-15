/**
 * Closing — siklus akuntansi akhir periode (SAK EP):
 *   neraca lajur (worksheet), jurnal penutup tahunan, laporan arus kas (metode tidak langsung),
 *   laporan perubahan ekuitas.
 *
 * Jurnal penutup (JT) bertanggal akhir tahun buku: semua akun pendapatan & beban ditutup ke
 * 3-9999 Ikhtisar laba rugi, ikhtisar ditutup ke 3-2101 Saldo laba, dan (opsional) prive ke saldo laba.
 * Laporan laba rugi selalu mengabaikan JT supaya angka tahun yang sudah ditutup tetap terlihat.
 */

const AKUN_SALDO_LABA = '3-2101';
const AKUN_PRIVE = '3-3101';
const AKUN_IKHTISAR = '3-9999';
const PL_TYPES = { pendapatan: true, hpp: true, beban: true, lain: true, pajak: true };

/** Mutasi bersih (sen, debit +) per akun untuk jurnal efektif dalam [from, to] yang lolos filter kepala jurnal. */
function netBy_(from, to, accept) {
  const eff = effectiveIds_();
  const m = {};
  journalLines_().forEach(function (d) {
    if (!eff.ids[d.jurnal_id]) return;
    const h = eff.heads[d.jurnal_id];
    if (h.tgl < from || h.tgl > to) return;
    if (accept && !accept(h)) return;
    m[d.akun_id] = (m[d.akun_id] || 0) + cents_(d.debit) - cents_(d.kredit);
  });
  return m;
}
const NOT_CLOSING_ = function (h) { return h.jenis !== 'JT'; };
const IS_OPENING_ = function (h) { return h.jenis === 'SA'; };
/** Saldo pembuka periode: semua jurnal sebelum `from` + jurnal saldo awal (SA) di dalam periode. */
function openingBy_(from, to) {
  const a = netBy_('0000-00-00', dayBefore_(from), null);
  const b = netBy_(from, to, IS_OPENING_);
  Object.keys(b).forEach(function (k) { a[k] = (a[k] || 0) + b[k]; });
  return a;
}

function fiscalEnd_(fiscalStartYmd) {
  const y = Number(fiscalStartYmd.slice(0, 4)) + 1;
  return dayBefore_(y + fiscalStartYmd.slice(4));
}

/** Akun lengkap dengan rantai induk (untuk klasifikasi arus kas & lajur). */
function accountsTree_() {
  const map = {};
  readTable_('M_Akun').forEach(function (a) { a.kode = String(a.kode); a.parent = String(a.parent || ''); map[a.kode] = a; });
  Object.keys(map).forEach(function (k) {
    const anc = [];
    var cur = map[k], guard = 0;
    while (cur && cur.parent && map[cur.parent] && guard < 12) { anc.push(cur.parent); cur = map[cur.parent]; guard++; }
    map[k].ancestors = anc;
  });
  return map;
}

function leavesSorted_(map) {
  return Object.keys(map).map(function (k) { return map[k]; }).filter(function (a) { return !bool_(a.is_header); })
    .sort(function (a, b) { return a.kode.localeCompare(b.kode, undefined, { numeric: true }); });
}

// ---------------------------------------------------------------- neraca lajur

/**
 * p: { to, from? (default awal tahun buku) }
 * Kolom: neraca saldo (sebelum penyesuaian) · penyesuaian (JP dalam periode) · neraca saldo disesuaikan · laba rugi · posisi keuangan.
 * Akun laba rugi memakai mutasi periode; akun neraca memakai saldo kumulatif s/d `to`. Jurnal penutup tidak ikut.
 */
function actionReportWorksheet_(p) {
  const to = ymd_(p.to || todayYmd_());
  const from = p.from ? ymd_(p.from) : fiscalStart_(to);
  if (from > to) throw new ApiError_('VALIDATION', 'Tanggal awal setelah tanggal akhir.');
  const map = accountsTree_();
  const isAdj = function (h) { return h.jenis === 'JP' && h.tgl >= from; };
  // akun neraca: kumulatif s/d `to` tanpa JP periode & tanpa JT periode
  const balUnadj = netBy_('0000-00-00', to, function (h) { return !isAdj(h) && !(h.jenis === 'JT' && h.tgl >= from); });
  // akun laba rugi: mutasi periode tanpa JP & JT
  const plUnadj = netBy_(from, to, function (h) { return h.jenis !== 'JP' && h.jenis !== 'JT'; });
  const adj = netBy_(from, to, function (h) { return h.jenis === 'JP'; });
  // laba tahun-tahun lalu yang belum ditutup (termasuk JT sebelum periode)
  const priorPl = netBy_('0000-00-00', dayBefore_(from), null);
  var prior = 0;
  Object.keys(priorPl).forEach(function (k) { if (map[k] && PL_TYPES[map[k].tipe]) prior += priorPl[k]; });

  const split = function (c) { return { d: c > 0 ? money_(c) : 0, k: c < 0 ? money_(-c) : 0 }; };
  const rows = [];
  const tot = { ns_d: 0, ns_k: 0, aj_d: 0, aj_k: 0, nsd_d: 0, nsd_k: 0, lr_d: 0, lr_k: 0, pk_d: 0, pk_k: 0 };
  const add = function (kode, nama, ns, aj, isPl) {
    const nsd = ns + aj;
    if (!ns && !aj && !p.includeZero) return;
    const a = split(ns), b = split(aj), c = split(nsd);
    const r = { kode: kode, nama: nama, pl: isPl, ns_d: a.d, ns_k: a.k, aj_d: b.d, aj_k: b.k, nsd_d: c.d, nsd_k: c.k,
      lr_d: isPl ? c.d : 0, lr_k: isPl ? c.k : 0, pk_d: isPl ? 0 : c.d, pk_k: isPl ? 0 : c.k };
    Object.keys(tot).forEach(function (k) { tot[k] += cents_(r[k]); });
    rows.push(r);
  };
  leavesSorted_(map).forEach(function (a) {
    const isPl = !!PL_TYPES[a.tipe];
    add(a.kode, a.nama, isPl ? (plUnadj[a.kode] || 0) : (balUnadj[a.kode] || 0), adj[a.kode] || 0, isPl);
  });
  if (prior) add('', 'Laba tahun-tahun lalu (belum ditutup)', prior, 0, false);
  const laba = tot.lr_k - tot.lr_d; // + laba, − rugi
  const out = {};
  Object.keys(tot).forEach(function (k) { out[k] = money_(tot[k]); });
  return {
    from: from, to: to, rows: rows, total: out, laba: money_(laba),
    // baris penyeimbang: laba bersih masuk sisi debit L/R dan kredit posisi keuangan (rugi sebaliknya)
    akhir: {
      lr_d: money_(tot.lr_d + Math.max(laba, 0)), lr_k: money_(tot.lr_k + Math.max(-laba, 0)),
      pk_d: money_(tot.pk_d + Math.max(-laba, 0)), pk_k: money_(tot.pk_k + Math.max(laba, 0)),
    },
    seimbang: tot.ns_d === tot.ns_k && tot.aj_d === tot.aj_k && tot.nsd_d === tot.nsd_k && tot.pk_d + Math.max(-laba, 0) === tot.pk_k + Math.max(laba, 0),
  };
}

// ---------------------------------------------------------------- jurnal penutup

function closingId_(fs) { return 'TUTUP-' + fs.slice(0, 7); }

function closingJournal_(fs) {
  return journalHeads_().filter(function (h) { return h.jenis === 'JT' && h.ref_dok === closingId_(fs) && h.status === 'posted'; })[0] || null;
}

/** Rancangan baris jurnal penutup untuk tahun buku yang dimulai `fs`. */
function closingPlan_(fs, tutupPrive) {
  const fe = fiscalEnd_(fs);
  const map = accountsTree_();
  const net = netBy_(fs, fe, NOT_CLOSING_);
  const lines = [];
  var ikhtisar = 0;
  leavesSorted_(map).forEach(function (a) {
    if (!PL_TYPES[a.tipe]) return;
    const c = net[a.kode] || 0;
    if (!c) return;
    // tutup saldo: kebalikan dari saldonya
    lines.push({ akun_id: a.kode, memo: 'Penutupan ' + a.nama, debit: c < 0 ? money_(-c) : 0, kredit: c > 0 ? money_(c) : 0 });
    ikhtisar += c; // debit + = beban lebih besar
  });
  const laba = -ikhtisar; // + laba
  if (lines.length) {
    // ikhtisar menerima lawan semua penutupan, lalu ditutup ke saldo laba
    if (laba > 0) {
      lines.push({ akun_id: AKUN_IKHTISAR, memo: 'Ikhtisar laba rugi', debit: 0, kredit: money_(laba) });
      lines.push({ akun_id: AKUN_IKHTISAR, memo: 'Laba bersih ke saldo laba', debit: money_(laba), kredit: 0 });
      lines.push({ akun_id: AKUN_SALDO_LABA, memo: 'Laba bersih tahun buku', debit: 0, kredit: money_(laba) });
    } else if (laba < 0) {
      lines.push({ akun_id: AKUN_IKHTISAR, memo: 'Ikhtisar laba rugi', debit: money_(-laba), kredit: 0 });
      lines.push({ akun_id: AKUN_IKHTISAR, memo: 'Rugi bersih ke saldo laba', debit: 0, kredit: money_(-laba) });
      lines.push({ akun_id: AKUN_SALDO_LABA, memo: 'Rugi bersih tahun buku', debit: money_(-laba), kredit: 0 });
    }
  }
  var prive = 0;
  if (tutupPrive && map[AKUN_PRIVE]) {
    prive = balanceAt_(AKUN_PRIVE, fe); // saldo debit
    if (prive > 0) {
      lines.push({ akun_id: AKUN_SALDO_LABA, memo: 'Penutupan prive / distribusi', debit: money_(prive), kredit: 0 });
      lines.push({ akun_id: AKUN_PRIVE, memo: 'Penutupan prive / distribusi', debit: 0, kredit: money_(prive) });
    }
  }
  // sisihkan baris nol dan gabungkan pasangan ikhtisar supaya jurnal tetap rapi
  return { from: fs, to: fe, lines: lines.filter(function (l) { return l.debit || l.kredit; }), laba: money_(laba), prive: money_(Math.max(prive, 0)) };
}

/** p: { tahun_mulai? (YYYY-MM-DD awal tahun buku) | tanggal (sembarang tanggal di tahun itu) } */
function closingYear_(p) {
  const any = p.tanggal ? ymd_(p.tanggal) : (p.tahun_mulai ? ymd_(p.tahun_mulai) : todayYmd_());
  return fiscalStart_(any);
}

function actionClosingPreview_(p) {
  const fs = closingYear_(p);
  const plan = closingPlan_(fs, p.tutupPrive !== false);
  const done = closingJournal_(fs);
  const accs = accountsMap_();
  plan.lines.forEach(function (l) { l.nama = (accs[l.akun_id] || {}).nama || l.akun_id; });
  const heads = journalHeads_().filter(function (h) { return h.tgl >= fs && h.tgl <= plan.to; });
  const pending = heads.filter(function (h) { return h.status === 'draft' || h.status === 'menunggu'; }).length;
  const months = [];
  for (var d = fs; d <= plan.to; d = nextMonth_(d)) months.push({ periode: d.slice(0, 7), status: periodStatus_(d.slice(0, 7)) });
  return {
    from: fs, to: plan.to, lines: plan.lines, laba: plan.laba, prive: plan.prive,
    sudah: done ? { id: done.id, no: done.no, tgl: done.tgl } : null,
    peringatan: {
      draft: pending,
      akhir_terkunci: periodStatus_(plan.to.slice(0, 7)) !== 'buka',
      belum_berakhir: plan.to > todayYmd_(),
    },
    periode: months,
  };
}

function nextMonth_(ymd) {
  var y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7)) + 1;
  if (m > 12) { m = 1; y++; }
  return y + '-' + ('0' + m).slice(-2) + '-01';
}

function actionClosingPost_(p, ctx) {
  const fs = closingYear_(p);
  return withLock_(function () {
    if (closingJournal_(fs)) throw new ApiError_('VALIDATION', 'Tahun buku ini sudah ditutup. Batalkan jurnal penutupnya dulu bila perlu menutup ulang.');
    const plan = closingPlan_(fs, p.tutupPrive !== false);
    if (plan.to > todayYmd_() && !p.sebelumAkhir) throw new ApiError_('VALIDATION', 'Tahun buku belum berakhir (' + plan.to + '). Jurnal penutup dibuat setelah tanggal itu.');
    if (!plan.lines.length) throw new ApiError_('VALIDATION', 'Tidak ada saldo pendapatan/beban untuk ditutup pada tahun buku ini.');
    const pending = journalHeads_().filter(function (h) { return h.tgl >= fs && h.tgl <= plan.to && (h.status === 'draft' || h.status === 'menunggu'); }).length;
    if (pending && !p.abaikanDraft) throw new ApiError_('PENDING_DRAFT', pending + ' jurnal di tahun ini masih draft/menunggu persetujuan. Posting atau buang dulu, atau lanjutkan dengan sadar.');
    assertOpen_(plan.to);
    const head = postJournal_(ctx, {
      tgl: plan.to, jenis: 'JT', keterangan: 'Jurnal penutup tahun buku ' + fs + ' s/d ' + plan.to, referensi: 'TUTUP ' + fs.slice(0, 4),
      ref_dok: closingId_(fs), lines: plan.lines,
    });
    audit_(ctx, 'JURNAL_PENUTUP', 'T_Jurnal', head.no, null, { laba: plan.laba, prive: plan.prive }, '');
    return { id: head.id, no: head.no, tgl: plan.to, laba: plan.laba, prive: plan.prive };
  });
}

function actionClosingVoid_(p, ctx) {
  const fs = closingYear_(p);
  const alasan = String(p.alasan || '').trim();
  if (!alasan) throw new ApiError_('VALIDATION', 'Alasan membatalkan jurnal penutup wajib diisi.');
  return withLock_(function () {
    const h = closingJournal_(fs);
    if (!h) throw new ApiError_('NOT_FOUND', 'Tahun buku ini belum ditutup.');
    const j = actionJournalGet_({ id: h.id });
    assertOpen_(j.tgl);
    const linesC = j.lines.map(function (l) { return { akun_id: l.akun_id, memo: l.memo, debit: cents_(l.debit), kredit: cents_(l.kredit) }; });
    // pembalik juga berjenis JT supaya laporan laba rugi tetap mengabaikan seluruh siklus penutupan
    const rev = postJournal_(ctx, {
      tgl: j.tgl, jenis: 'JT', keterangan: 'Pembatalan ' + j.no + ': ' + alasan, referensi: j.no, jurnal_asal: j.id, ref_dok: closingId_(fs) + '-BATAL',
      lines: linesC.map(function (l) { return { akun_id: l.akun_id, memo: l.memo, debit: money_(l.kredit), kredit: money_(l.debit) }; }),
    });
    updateWhere_('T_Jurnal', 'id', j.id, { status: 'batal', alasan_batal: alasan, dibatalkan_oleh: ctx.session.username, dibatalkan_pada: new Date() });
    audit_(ctx, 'BATAL_PENUTUP', 'T_Jurnal', j.no, null, null, alasan);
    return { pembalik: rev.no };
  });
}

// ---------------------------------------------------------------- arus kas (tidak langsung)

/** Klasifikasi akun neraca untuk arus kas. */
function cashflowClass_(a, cashAccs) {
  if (cashAccs[a.kode]) return 'kas';
  const anc = a.ancestors || [];
  const under = function (k) { return a.kode === k || anc.indexOf(k) >= 0; };
  if (a.tipe === 'aset') {
    if (under('1-2')) return a.saldo_normal === 'K' ? 'nonkas' : 'investasi'; // akumulasi penyusutan = beban nonkas
    return 'modal_kerja';
  }
  if (a.tipe === 'liabilitas') {
    if (under('2-2') || a.kode === '2-1501' || /utang bank|pinjaman/i.test(a.nama)) return 'pendanaan';
    return 'modal_kerja';
  }
  if (a.tipe === 'ekuitas') return a.kode === AKUN_IKHTISAR || a.kode === AKUN_SALDO_LABA ? 'saldo_laba' : 'pendanaan';
  return 'laba';
}

function actionReportCashflow_(p) {
  const to = ymd_(p.to || todayYmd_());
  const from = p.from ? ymd_(p.from) : fiscalStart_(to);
  if (from > to) throw new ApiError_('VALIDATION', 'Tanggal awal setelah tanggal akhir.');
  const map = accountsTree_();
  const cashAccs = {};
  kasbankRows_().forEach(function (k) { cashAccs[k.akun_id] = true; });
  leavesSorted_(map).forEach(function (a) { if (a.kode.indexOf('1-11') === 0 && a.tipe === 'aset') cashAccs[a.kode] = true; });
  const mov = netBy_(from, to, function (h) { return h.jenis !== 'JT' && h.jenis !== 'SA'; }); // mutasi periode, debit +
  const open = openingBy_(from, to);
  const close = netBy_('0000-00-00', to, null);

  var laba = 0;
  const sec = { operasi: [], investasi: [], pendanaan: [] };
  const push = function (s, label, kode, c) { if (c) sec[s].push({ kode: kode, nama: label, jumlah: money_(c) }); };
  leavesSorted_(map).forEach(function (a) {
    const c = mov[a.kode] || 0;
    const cls = cashflowClass_(a, cashAccs);
    if (cls === 'laba') { laba -= c; return; }
    if (!c || cls === 'kas') return;
    // kenaikan aset (debit +) = kas keluar; kenaikan liabilitas/ekuitas (kredit) = kas masuk → arus kas = −c
    if (cls === 'nonkas') push('operasi', 'Penyusutan & amortisasi (' + a.nama + ')', a.kode, -c);
    else if (cls === 'modal_kerja') {
      const naik = a.saldo_normal === 'K' ? c < 0 : c > 0; // kenaikan saldo menurut saldo normalnya
      push('operasi', (naik ? 'Kenaikan ' : 'Penurunan ') + a.nama.toLowerCase(), a.kode, -c);
    }
    else if (cls === 'investasi') push('investasi', (c > 0 ? 'Perolehan ' : 'Pelepasan ') + a.nama.toLowerCase(), a.kode, -c);
    else if (cls === 'pendanaan') push('pendanaan', a.nama, a.kode, -c);
    else if (cls === 'saldo_laba') push('pendanaan', 'Koreksi / distribusi ' + a.nama.toLowerCase(), a.kode, -c);
  });
  const sum = function (list) { return list.reduce(function (t, r) { return t + cents_(r.jumlah); }, 0); };
  const operasi = laba + sum(sec.operasi);
  const investasi = sum(sec.investasi);
  const pendanaan = sum(sec.pendanaan);
  var kasAwal = 0, kasAkhir = 0;
  const kasRows = [];
  Object.keys(cashAccs).forEach(function (k) {
    if (!map[k]) return;
    kasAwal += open[k] || 0;
    kasAkhir += close[k] || 0;
    if ((open[k] || 0) || (close[k] || 0)) kasRows.push({ kode: k, nama: map[k].nama, awal: money_(open[k] || 0), akhir: money_(close[k] || 0) });
  });
  const naik = operasi + investasi + pendanaan;
  return {
    from: from, to: to, laba: money_(laba),
    operasi: { rows: sec.operasi, total: money_(operasi) },
    investasi: { rows: sec.investasi, total: money_(investasi) },
    pendanaan: { rows: sec.pendanaan, total: money_(pendanaan) },
    kenaikan: money_(naik), kas_awal: money_(kasAwal), kas_akhir: money_(kasAkhir), kas: kasRows,
    selisih: money_(kasAwal + naik - kasAkhir),
  };
}

// ---------------------------------------------------------------- perubahan ekuitas

function actionReportEquity_(p) {
  const to = ymd_(p.to || todayYmd_());
  const from = p.from ? ymd_(p.from) : fiscalStart_(to);
  if (from > to) throw new ApiError_('VALIDATION', 'Tanggal awal setelah tanggal akhir.');
  const map = accountsTree_();
  const leaves = leavesSorted_(map);
  const open = openingBy_(from, to);
  const close = netBy_('0000-00-00', to, null);
  const movNon = netBy_(from, to, function (h) { return h.jenis !== 'JT' && h.jenis !== 'SA'; });
  const movJT = netBy_(from, to, function (h) { return h.jenis === 'JT'; });
  const isRetained = function (a) { return a.kode === AKUN_SALDO_LABA || a.kode === AKUN_IKHTISAR; };
  const plSum = function (m) { return leaves.reduce(function (t, a) { return t + (PL_TYPES[a.tipe] ? (m[a.kode] || 0) : 0); }, 0); };

  // kolom: tiap akun ekuitas (selain saldo laba & ikhtisar) + kolom saldo laba (termasuk laba belum ditutup)
  const cols = leaves.filter(function (a) { return a.tipe === 'ekuitas' && !isRetained(a); })
    .map(function (a) { return { kode: a.kode, nama: a.nama, accs: [a.kode], retained: false }; });
  cols.push({ kode: AKUN_SALDO_LABA, nama: 'Saldo laba', accs: leaves.filter(isRetained).map(function (a) { return a.kode; }), retained: true });
  const val = function (col, m, withPl) {
    var c = col.accs.reduce(function (t, k) { return t + (m[k] || 0); }, 0);
    if (col.retained && withPl) c += plSum(m);
    return -c; // ekuitas: saldo kredit positif
  };
  const lines = [
    { key: 'awal', label: 'Saldo awal ' + from, f: function (c) { return val(c, open, true); } },
    { key: 'laba', label: 'Laba (rugi) periode berjalan', f: function (c) { return c.retained ? -plSum(movNon) : 0; } },
    { key: 'mutasi', label: 'Setoran / penarikan / distribusi', f: function (c) { return val(c, movNon, false); } },
    { key: 'tutup', label: 'Penutupan buku (pindah antar kolom)', f: function (c) { return val(c, movJT, true); } },
    { key: 'akhir', label: 'Saldo akhir ' + to, f: function (c) { return val(c, close, true); } },
  ];
  const rows = lines.map(function (l) {
    const amounts = cols.map(function (c) { return l.f(c); });
    return { key: l.key, label: l.label, amounts: amounts.map(money_), total: money_(amounts.reduce(function (t, x) { return t + x; }, 0)) };
  }).filter(function (r) { return r.key === 'awal' || r.key === 'akhir' || r.amounts.some(function (x) { return x !== 0; }); });
  const check = rows.filter(function (r) { return r.key !== 'awal' && r.key !== 'akhir'; })
    .reduce(function (t, r) { return t + cents_(r.total); }, cents_(rows[0].total)) - cents_(rows[rows.length - 1].total);
  return { from: from, to: to, columns: cols.map(function (c) { return { kode: c.kode, nama: c.nama }; }), rows: rows, seimbang: check === 0 };
}
