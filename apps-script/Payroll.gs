/**
 * Payroll — data karyawan, penggajian bulanan, BPJS, PPh 21, slip gaji.
 *
 * PPh 21 pegawai tetap (PP 58/2023 & PMK 168/2023):
 *   Januari–November : tarif efektif rata-rata (TER) bulanan kategori A/B/C × penghasilan bruto bulan itu.
 *   Desember / masa terakhir (karyawan berhenti) : tarif Pasal 17 atas penghasilan neto setahun
 *   (bruto − biaya jabatan 5% maks Rp500.000/bulan − iuran JHT & JP karyawan − PTKP), dikurangi PPh 21
 *   yang sudah dipotong Januari s/d bulan sebelumnya.
 * Penghasilan bruto termasuk premi JKK, JKM, dan BPJS Kesehatan yang dibayar perusahaan.
 *
 * Jurnal penggajian (GJ):
 *   Dr Beban gaji & tunjangan / lembur & insentif / THR & bonus / BPJS perusahaan
 *   Cr Utang BPJS (iuran perusahaan + karyawan), Cr Utang PPh 21, Cr Piutang karyawan (kasbon), Cr Utang gaji (take home pay)
 * Pembayaran gaji (KK): Dr Utang gaji, Cr kas/bank.
 */

const AKUN_GAJI = '6-1101';
const AKUN_LEMBUR = '6-1102';
const AKUN_THR = '6-1103';
const AKUN_BPJS_BEBAN = '6-1104';
const AKUN_UTANG_PPH21 = '2-1202';
const AKUN_UTANG_GAJI = '2-1302';
const AKUN_UTANG_BPJS = '2-1303';
const AKUN_PIUTANG_KARYAWAN = '1-1302';

const PTKP_ = { 'TK/0': 54000000, 'TK/1': 58500000, 'TK/2': 63000000, 'TK/3': 67500000, 'K/0': 58500000, 'K/1': 63000000, 'K/2': 67500000, 'K/3': 72000000 };
const TER_KATEGORI_ = { 'TK/0': 'A', 'TK/1': 'A', 'K/0': 'A', 'TK/2': 'B', 'TK/3': 'B', 'K/1': 'B', 'K/2': 'B', 'K/3': 'C' };
/** Batas atas (inklusif) penghasilan bruto bulanan → tarif %. Lampiran PP 58/2023. */
const TER_ = {
  A: [[5400000, 0], [5650000, 0.25], [5950000, 0.5], [6300000, 0.75], [6750000, 1], [7500000, 1.25], [8550000, 1.5], [9650000, 1.75], [10050000, 2],
    [10350000, 2.25], [10700000, 2.5], [11050000, 3], [11600000, 3.5], [12500000, 4], [13750000, 5], [15100000, 6], [16950000, 7], [19750000, 8],
    [24150000, 9], [26450000, 10], [28000000, 11], [30050000, 12], [32400000, 13], [35400000, 14], [39100000, 15], [43850000, 16], [47800000, 17],
    [51400000, 18], [56300000, 19], [62200000, 20], [68600000, 21], [77500000, 22], [89000000, 23], [103000000, 24], [125000000, 25], [157000000, 26],
    [206000000, 27], [337000000, 28], [454000000, 29], [550000000, 30], [695000000, 31], [910000000, 32], [1400000000, 33], [Infinity, 34]],
  B: [[6200000, 0], [6500000, 0.25], [6850000, 0.5], [7300000, 0.75], [9200000, 1], [10750000, 1.5], [11250000, 2], [11600000, 2.5], [12600000, 3],
    [13600000, 4], [14950000, 5], [16400000, 6], [18450000, 7], [21850000, 8], [26000000, 9], [27700000, 10], [29350000, 11], [31450000, 12],
    [33950000, 13], [37100000, 14], [41100000, 15], [45800000, 16], [49500000, 17], [53800000, 18], [58500000, 19], [64000000, 20], [71000000, 21],
    [80000000, 22], [93000000, 23], [109000000, 24], [129000000, 25], [163000000, 26], [211000000, 27], [374000000, 28], [459000000, 29],
    [555000000, 30], [704000000, 31], [957000000, 32], [1405000000, 33], [Infinity, 34]],
  C: [[6600000, 0], [6950000, 0.25], [7350000, 0.5], [7800000, 0.75], [8850000, 1], [9800000, 1.25], [10950000, 1.5], [11200000, 1.75], [12050000, 2],
    [12950000, 3], [14150000, 4], [15550000, 5], [17050000, 6], [19500000, 7], [22700000, 8], [26600000, 9], [28100000, 10], [30100000, 11],
    [32600000, 12], [35400000, 13], [38900000, 14], [43000000, 15], [47400000, 16], [51200000, 17], [55800000, 18], [60400000, 19], [66700000, 20],
    [74500000, 21], [83200000, 22], [95600000, 23], [110000000, 24], [134000000, 25], [169000000, 26], [221000000, 27], [390000000, 28],
    [463000000, 29], [561000000, 30], [709000000, 31], [965000000, 32], [1419000000, 33], [Infinity, 34]],
};
const PASAL17_ = [[60000000, 5], [250000000, 15], [500000000, 25], [5000000000, 30], [Infinity, 35]];

const BPJS_DEFAULT_ = { bpjs_kes_batas: 12000000, bpjs_jp_batas: 10547400, bpjs_jkk_tarif: 0.24 };

function payrollSetting_(k) {
  const v = Number(getSetting_(k));
  return isFinite(v) && v > 0 ? v : BPJS_DEFAULT_[k];
}

function terRate_(kat, bruto) {
  const t = TER_[kat] || TER_.A;
  for (var i = 0; i < t.length; i++) if (bruto <= t[i][0]) return t[i][1];
  return 34;
}

function pasal17_(pkp) {
  var tax = 0, lower = 0;
  for (var i = 0; i < PASAL17_.length && pkp > lower; i++) {
    const upper = PASAL17_[i][0];
    tax += (Math.min(pkp, upper) - lower) * PASAL17_[i][1] / 100;
    lower = upper;
  }
  return Math.floor(tax);
}

// ---------------------------------------------------------------- karyawan

const EMP_TEXT_ = ['kode', 'nama', 'nik', 'npwp', 'jabatan', 'divisi', 'ptkp', 'bank', 'rekening', 'bpjs_kes', 'bpjs_tk', 'email'];

function employeeRows_() {
  return readTable_('M_Karyawan').map(function (r) {
    EMP_TEXT_.forEach(function (k) { r[k] = r[k] === undefined || r[k] === null ? '' : String(r[k]); });
    r.gaji_pokok = Number(r.gaji_pokok) || 0;
    r.tunjangan = Number(r.tunjangan) || 0;
    r.tgl_masuk = r.tgl_masuk ? ymd_(r.tgl_masuk) : '';
    r.tgl_keluar = r.tgl_keluar ? ymd_(r.tgl_keluar) : '';
    r.aktif = r.aktif === '' ? true : bool_(r.aktif);
    r.bpjs_kes = r.bpjs_kes || 'ya';
    r.bpjs_tk = r.bpjs_tk || 'ya';
    return r;
  });
}

function actionEmployeeList_() {
  return employeeRows_().sort(function (a, b) { return a.nama.localeCompare(b.nama); });
}

function actionEmployeeSave_(p, ctx) {
  const nama = String(p.nama || '').trim();
  if (!nama) throw new ApiError_('VALIDATION', 'Nama karyawan wajib diisi.');
  const ptkp = String(p.ptkp || '').toUpperCase().replace(/\s/g, '');
  if (!PTKP_[ptkp]) throw new ApiError_('VALIDATION', 'Status PTKP harus salah satu dari ' + Object.keys(PTKP_).join(', ') + '.');
  const num = function (k, label) {
    const v = cents_(p[k] || 0);
    if (v < 0) throw new ApiError_('VALIDATION', label + ' tidak boleh minus.');
    return Math.round(money_(v));
  };
  const gaji = num('gaji_pokok', 'Gaji pokok');
  if (gaji <= 0) throw new ApiError_('VALIDATION', 'Gaji pokok wajib diisi.');
  const nik = String(p.nik || '').replace(/\D/g, '');
  if (nik && nik.length !== 16) throw new ApiError_('VALIDATION', 'NIK harus 16 digit.');
  const yn = function (v) { return v === 'tidak' ? 'tidak' : 'ya'; };
  if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(p.email).trim())) throw new ApiError_('VALIDATION', 'Format email tidak valid.');
  return withLock_(function () {
    const all = employeeRows_();
    const row = {
      nama: asText_(nama), nik: asText_(nik), npwp: asText_(String(p.npwp || '').trim()), jabatan: asText_(String(p.jabatan || '').trim()),
      divisi: asText_(String(p.divisi || '').trim()), gaji_pokok: gaji, tunjangan: num('tunjangan', 'Tunjangan'), ptkp: asText_(ptkp),
      bank: asText_(String(p.bank || '').trim()), rekening: asText_(String(p.rekening || '').trim()), email: asText_(String(p.email || '').trim()),
      bpjs_kes: yn(p.bpjs_kes), bpjs_tk: yn(p.bpjs_tk), tgl_masuk: p.tgl_masuk ? asText_(ymd_(p.tgl_masuk)) : '',
      tgl_keluar: p.tgl_keluar ? asText_(ymd_(p.tgl_keluar)) : '', aktif: p.aktif === false ? false : true,
    };
    var kode = String(p.kode || '').trim();
    if (p.id) {
      const old = all.filter(function (e) { return e.id === p.id; })[0];
      if (!old) throw new ApiError_('NOT_FOUND', 'Karyawan tidak ditemukan.');
      if (!kode) kode = old.kode;
      if (all.some(function (e) { return e.id !== p.id && e.kode === kode; })) throw new ApiError_('VALIDATION', 'Kode ' + kode + ' sudah dipakai.');
      row.kode = asText_(kode);
      const r = updateWhere_('M_Karyawan', 'id', p.id, row);
      audit_(ctx, 'UBAH', 'M_Karyawan', kode, r.before, r.after, '');
      return { id: p.id, kode: kode };
    }
    if (!kode) kode = formatNumber_('K-{####}', 'PST', 0, nextNumber_('KARYAWAN', 'PST', 0));
    if (all.some(function (e) { return e.kode === kode; })) throw new ApiError_('VALIDATION', 'Kode ' + kode + ' sudah dipakai.');
    row.id = newId_('EMP');
    row.kode = asText_(kode);
    appendObjects_('M_Karyawan', [row]);
    audit_(ctx, 'TAMBAH', 'M_Karyawan', kode, null, { nama: nama, ptkp: ptkp }, '');
    return { id: row.id, kode: kode };
  });
}

// ---------------------------------------------------------------- penggajian

const SLIP_NUM_ = ['gaji_pokok', 'tunjangan', 'lembur', 'bonus', 'thr', 'potongan_absen', 'kasbon',
  'bpjs_kes_p', 'bpjs_kes_k', 'jht_p', 'jht_k', 'jp_p', 'jp_k', 'jkk', 'jkm', 'bruto', 'pph21', 'neto', 'ter_tarif',
  'th_bruto', 'th_biaya_jabatan', 'th_iuran', 'th_neto', 'th_ptkp', 'th_pkp', 'th_pph', 'th_dipotong'];

function runRows_() {
  return readTable_('T_GajiRun').map(function (r) {
    r.periode = ym_(r.periode);
    r.tgl = r.tgl ? ymd_(r.tgl) : '';
    r.tgl_bayar = r.tgl_bayar ? ymd_(r.tgl_bayar) : '';
    ['total_bruto', 'total_pph21', 'total_neto', 'total_bpjs', 'total_beban'].forEach(function (k) { r[k] = Number(r[k]) || 0; });
    r.karyawan = Number(r.karyawan) || 0;
    return r;
  });
}

function slipRows_() {
  return readTable_('T_Payroll').map(function (r) {
    r.periode = ym_(r.periode);
    SLIP_NUM_.forEach(function (k) { r[k] = Number(r[k]) || 0; });
    r.akhir = bool_(r.akhir);
    ['nama', 'ptkp', 'ter_kategori', 'metode', 'kode', 'jabatan', 'catatan'].forEach(function (k) { r[k] = r[k] === undefined || r[k] === null ? '' : String(r[k]); });
    return r;
  });
}

/** Total yang sudah tercatat tahun ini untuk satu karyawan, dari penggajian posted sebelum `periode`. */
function ytdOf_(empId, periode, slips, runs) {
  const posted = {};
  runs.forEach(function (r) { if (r.status === 'posted') posted[r.id] = r; });
  const y = periode.slice(0, 4);
  const o = { bruto: 0, pph: 0, iuran: 0, bulan: 0 };
  slips.forEach(function (s) {
    if (s.karyawan_id !== empId || !posted[s.run_id]) return;
    if (s.periode.slice(0, 4) !== y || s.periode >= periode) return;
    o.bruto += s.bruto; o.pph += s.pph21; o.iuran += s.jht_k + s.jp_k; o.bulan++;
  });
  return o;
}

/** Hitung satu slip (rupiah bulat). in: komponen variabel; emp: master karyawan. */
function calcSlip_(emp, inp, periode, ytd) {
  const n = function (k, def) { const v = inp[k] === undefined || inp[k] === '' ? def : Number(inp[k]); if (!isFinite(v) || v < 0) throw new ApiError_('VALIDATION', emp.nama + ': ' + k + ' harus angka ≥ 0.'); return Math.round(v); };
  const s = {
    karyawan_id: emp.id, kode: emp.kode, nama: emp.nama, jabatan: emp.jabatan, ptkp: emp.ptkp,
    gaji_pokok: n('gaji_pokok', emp.gaji_pokok), tunjangan: n('tunjangan', emp.tunjangan), lembur: n('lembur', 0), bonus: n('bonus', 0), thr: n('thr', 0),
    potongan_absen: n('potongan_absen', 0), kasbon: n('kasbon', 0), akhir: !!inp.akhir, catatan: String(inp.catatan || '').slice(0, 200),
  };
  const upah = s.gaji_pokok + s.tunjangan;
  if (s.potongan_absen > upah + s.lembur + s.bonus + s.thr) throw new ApiError_('VALIDATION', emp.nama + ': potongan absensi melebihi penghasilan.');
  const r = function (x) { return Math.round(x); };
  if (emp.bpjs_kes === 'ya') {
    const b = Math.min(upah, payrollSetting_('bpjs_kes_batas'));
    s.bpjs_kes_p = r(b * 0.04); s.bpjs_kes_k = r(b * 0.01);
  } else { s.bpjs_kes_p = 0; s.bpjs_kes_k = 0; }
  if (emp.bpjs_tk === 'ya') {
    s.jht_p = r(upah * 0.037); s.jht_k = r(upah * 0.02);
    const jb = Math.min(upah, payrollSetting_('bpjs_jp_batas'));
    s.jp_p = r(jb * 0.02); s.jp_k = r(jb * 0.01);
    s.jkk = r(upah * payrollSetting_('bpjs_jkk_tarif') / 100); s.jkm = r(upah * 0.003);
  } else { s.jht_p = 0; s.jht_k = 0; s.jp_p = 0; s.jp_k = 0; s.jkk = 0; s.jkm = 0; }
  s.bruto = upah + s.lembur + s.bonus + s.thr - s.potongan_absen + s.jkk + s.jkm + s.bpjs_kes_p;
  s.ter_kategori = TER_KATEGORI_[emp.ptkp] || 'A';
  const tahunan = periode.slice(5, 7) === '12' || s.akhir;
  ['th_bruto', 'th_biaya_jabatan', 'th_iuran', 'th_neto', 'th_ptkp', 'th_pkp', 'th_pph', 'th_dipotong', 'ter_tarif'].forEach(function (k) { s[k] = 0; });
  if (!tahunan) {
    s.metode = 'ter';
    s.ter_tarif = terRate_(s.ter_kategori, s.bruto);
    s.pph21 = Math.floor(s.bruto * s.ter_tarif / 100);
  } else {
    s.metode = 'tahunan';
    const bulan = ytd.bulan + 1;
    s.th_bruto = ytd.bruto + s.bruto;
    s.th_biaya_jabatan = Math.min(Math.floor(s.th_bruto * 0.05), 500000 * bulan);
    s.th_iuran = ytd.iuran + s.jht_k + s.jp_k;
    s.th_neto = s.th_bruto - s.th_biaya_jabatan - s.th_iuran;
    s.th_ptkp = PTKP_[emp.ptkp] || PTKP_['TK/0'];
    s.th_pkp = Math.max(0, Math.floor((s.th_neto - s.th_ptkp) / 1000) * 1000);
    s.th_pph = pasal17_(s.th_pkp);
    s.th_dipotong = ytd.pph;
    s.pph21 = s.th_pph - ytd.pph; // bisa minus = kelebihan potong dikembalikan ke karyawan
  }
  s.neto = upah + s.lembur + s.bonus + s.thr - s.potongan_absen - s.bpjs_kes_k - s.jht_k - s.jp_k - s.pph21 - s.kasbon;
  if (s.neto < 0) throw new ApiError_('VALIDATION', s.nama + ': gaji bersih minus (Rp ' + formatRp_(s.neto * 100) + '). Kurangi kasbon/potongan.');
  return s;
}

function computeRun_(periode, lines, excludeRunId) {
  if (!isYm_(periode)) throw new ApiError_('VALIDATION', 'Periode gaji tidak valid.');
  const emps = {};
  employeeRows_().forEach(function (e) { emps[e.id] = e; });
  const runs = runRows_().filter(function (r) { return r.id !== excludeRunId; });
  const slips = slipRows_();
  const seen = {};
  const out = (lines || []).map(function (l) {
    const e = emps[l.karyawan_id];
    if (!e) throw new ApiError_('VALIDATION', 'Karyawan tidak ditemukan: ' + l.karyawan_id);
    if (seen[e.id]) throw new ApiError_('VALIDATION', e.nama + ' tercantum dua kali.');
    seen[e.id] = true;
    return calcSlip_(e, l, periode, ytdOf_(e.id, periode, slips, runs));
  });
  const tot = { bruto: 0, pph21: 0, neto: 0, bpjs: 0, beban: 0, kasbon: 0 };
  out.forEach(function (s) {
    tot.bruto += s.bruto; tot.pph21 += s.pph21; tot.neto += s.neto; tot.kasbon += s.kasbon;
    tot.bpjs += s.bpjs_kes_p + s.bpjs_kes_k + s.jht_p + s.jht_k + s.jp_p + s.jp_k + s.jkk + s.jkm;
    tot.beban += s.gaji_pokok + s.tunjangan + s.lembur + s.bonus + s.thr - s.potongan_absen + s.bpjs_kes_p + s.jht_p + s.jp_p + s.jkk + s.jkm;
  });
  // peringatan: Desember / masa terakhir butuh semua bulan sebelumnya sudah diposting
  const warn = [];
  const draftsBefore = runs.filter(function (r) { return r.status === 'draft' && r.periode < periode && r.periode.slice(0, 4) === periode.slice(0, 4); });
  if (out.some(function (s) { return s.metode === 'tahunan'; }) && draftsBefore.length) warn.push('Penggajian ' + draftsBefore.map(function (r) { return r.periode; }).join(', ') + ' masih draft — PPh 21 tahunan hanya menghitung bulan yang sudah diposting.');
  return { lines: out, total: tot, warn: warn };
}

function emptyLines_(periode) {
  const end = monthEnd_(periode);
  return employeeRows_().filter(function (e) {
    return e.aktif && (!e.tgl_masuk || e.tgl_masuk <= end) && (!e.tgl_keluar || e.tgl_keluar >= periode + '-01');
  }).map(function (e) { return { karyawan_id: e.id, akhir: !!(e.tgl_keluar && e.tgl_keluar.slice(0, 7) === periode) }; });
}

function actionPayrollList_(p) {
  const y = String(p.tahun || todayYmd_().slice(0, 4));
  const runs = runRows_().filter(function (r) { return r.periode.slice(0, 4) === y && r.status !== 'batal'; });
  const byP = {};
  runs.forEach(function (r) { byP[r.periode] = r; });
  const out = [];
  for (var m = 1; m <= 12; m++) {
    const ym = y + '-' + ('0' + m).slice(-2);
    const r = byP[ym];
    out.push(r ? { periode: ym, id: r.id, no: r.no, status: r.status, karyawan: r.karyawan, bruto: r.total_bruto, pph21: r.total_pph21, neto: r.total_neto, bpjs: r.total_bpjs,
      beban: r.total_beban, dibayar: !!r.tgl_bayar, tgl_bayar: r.tgl_bayar } : { periode: ym, status: 'belum' });
  }
  return { tahun: y, bulan: out, karyawan_aktif: employeeRows_().filter(function (e) { return e.aktif; }).length,
    bpjs: { kes_batas: payrollSetting_('bpjs_kes_batas'), jp_batas: payrollSetting_('bpjs_jp_batas'), jkk_tarif: payrollSetting_('bpjs_jkk_tarif') } };
}

/** p: { periode } — penggajian bulan itu (atau usulan baru dari data karyawan). */
function actionPayrollGet_(p) {
  const periode = ym_(p.periode);
  const run = runRows_().filter(function (r) { return r.periode === periode && r.status !== 'batal'; })[0] || null;
  var calc, lines;
  if (run) {
    lines = slipRows_().filter(function (s) { return s.run_id === run.id; });
    if (run.status === 'draft') calc = computeRun_(periode, lines, run.id);
    else calc = { lines: lines, total: { bruto: run.total_bruto, pph21: run.total_pph21, neto: run.total_neto, bpjs: run.total_bpjs, beban: run.total_beban }, warn: [] };
  } else calc = computeRun_(periode, emptyLines_(periode), '');
  const heads = {};
  journalHeads_().forEach(function (h) { heads[h.id] = h; });
  const kb = run && run.kasbank_id ? kasbankRows_().filter(function (k) { return k.id === run.kasbank_id; })[0] : null;
  return {
    periode: periode, tgl: run && run.tgl ? run.tgl : monthEnd_(periode), run: run ? {
      id: run.id, no: run.no, status: run.status, catatan: run.catatan, tgl_bayar: run.tgl_bayar, kasbank: kb ? kb.nama : '',
      jurnal: run.jurnal_id && heads[run.jurnal_id] ? { id: run.jurnal_id, no: heads[run.jurnal_id].no } : null,
      jurnal_bayar: run.jurnal_bayar && heads[run.jurnal_bayar] ? { id: run.jurnal_bayar, no: heads[run.jurnal_bayar].no } : null,
      diposting_oleh: run.diposting_oleh, diposting_pada: run.diposting_pada,
    } : null,
    lines: calc.lines, total: calc.total, warn: calc.warn, karyawan: actionEmployeeList_().filter(function (e) { return e.aktif; }),
  };
}

/** Hitung tanpa menyimpan (pratinjau form). p: { periode, lines } */
function actionPayrollCalc_(p) {
  const periode = ym_(p.periode);
  const run = runRows_().filter(function (r) { return r.periode === periode && r.status === 'draft'; })[0];
  return computeRun_(periode, p.lines, run ? run.id : '');
}

/** p: { periode, tgl, catatan, lines, post } */
function actionPayrollSave_(p, ctx) {
  const periode = ym_(p.periode);
  const tgl = ymd_(p.tgl || monthEnd_(periode));
  if (tgl.slice(0, 7) !== periode) throw new ApiError_('VALIDATION', 'Tanggal penggajian harus di bulan ' + periode + '.');
  if (!(p.lines || []).length) throw new ApiError_('VALIDATION', 'Tidak ada karyawan dalam penggajian ini.');
  return withLock_(function () {
    const existing = runRows_().filter(function (r) { return r.periode === periode && r.status !== 'batal'; })[0];
    if (existing && existing.status === 'posted') throw new ApiError_('VALIDATION', 'Penggajian ' + periode + ' sudah diposting.');
    const calc = computeRun_(periode, p.lines, existing ? existing.id : '');
    const t = calc.total;
    const id = existing ? existing.id : newId_('GJI');
    var head = null;
    if (p.post) {
      assertOpen_(tgl);
      const by = {};
      const add = function (akun, v) { by[akun] = (by[akun] || 0) + v; };
      calc.lines.forEach(function (s) {
        add(AKUN_GAJI, s.gaji_pokok + s.tunjangan - s.potongan_absen);
        add(AKUN_LEMBUR, s.lembur);
        add(AKUN_THR, s.bonus + s.thr);
        add(AKUN_BPJS_BEBAN, s.bpjs_kes_p + s.jht_p + s.jp_p + s.jkk + s.jkm);
      });
      const jl = [];
      const ket = 'Penggajian ' + periode + ' (' + calc.lines.length + ' karyawan)';
      Object.keys(by).forEach(function (k) {
        const v = by[k];
        if (v > 0) jl.push({ akun_id: k, memo: ket, debit: v, kredit: 0 });
        else if (v < 0) jl.push({ akun_id: k, memo: ket, debit: 0, kredit: -v });
      });
      if (t.bpjs) jl.push({ akun_id: AKUN_UTANG_BPJS, memo: 'Iuran BPJS ' + periode, debit: 0, kredit: t.bpjs });
      if (t.pph21 > 0) jl.push({ akun_id: AKUN_UTANG_PPH21, memo: 'PPh 21 ' + periode, debit: 0, kredit: t.pph21 });
      if (t.pph21 < 0) jl.push({ akun_id: AKUN_UTANG_PPH21, memo: 'Kelebihan potong PPh 21 ' + periode, debit: -t.pph21, kredit: 0 });
      if (t.kasbon) jl.push({ akun_id: AKUN_PIUTANG_KARYAWAN, memo: 'Potongan kasbon ' + periode, debit: 0, kredit: t.kasbon });
      if (t.neto) jl.push({ akun_id: AKUN_UTANG_GAJI, memo: 'Gaji bersih ' + periode, debit: 0, kredit: t.neto });
      head = postJournal_(ctx, { tgl: tgl, jenis: 'GJ', keterangan: ket, referensi: 'GAJI-' + periode, ref_dok: id, lines: jl });
    }
    const runRow = {
      periode: asText_(periode), tgl: asText_(tgl), status: p.post ? 'posted' : 'draft', karyawan: calc.lines.length,
      total_bruto: t.bruto, total_pph21: t.pph21, total_neto: t.neto, total_bpjs: t.bpjs, total_beban: t.beban,
      catatan: asText_(String(p.catatan || '').trim()), no: head ? head.no : '', jurnal_id: head ? head.id : '',
      diposting_oleh: head ? ctx.session.username : '', diposting_pada: head ? new Date() : '',
    };
    if (existing) { updateWhere_('T_GajiRun', 'id', id, runRow); deleteWhere_('T_Payroll', 'run_id', id); }
    else { runRow.id = id; runRow.dibuat_oleh = ctx.session.username; runRow.dibuat_pada = new Date(); appendObjects_('T_GajiRun', [runRow]); }
    appendObjects_('T_Payroll', calc.lines.map(function (s) {
      const o = { run_id: id, periode: asText_(periode), karyawan_id: s.karyawan_id, status: p.post ? 'posted' : 'draft', jurnal_id: head ? head.id : '',
        komponen_json: '', kode: asText_(s.kode), nama: asText_(s.nama), jabatan: asText_(s.jabatan), ptkp: asText_(s.ptkp), ter_kategori: s.ter_kategori,
        metode: s.metode, akhir: s.akhir, catatan: asText_(s.catatan) };
      SLIP_NUM_.forEach(function (k) { o[k] = s[k]; });
      return o;
    }));
    audit_(ctx, p.post ? 'POSTING_GAJI' : 'DRAFT_GAJI', 'T_GajiRun', periode, null, { karyawan: calc.lines.length, bruto: t.bruto, pph21: t.pph21, neto: t.neto, jurnal: head ? head.no : '' }, '');
    return { id: id, status: runRow.status, no: runRow.no, total: t };
  });
}

/** Bayar gaji bersih sekaligus. p: { id, tgl, kasbank_id, metode } */
function actionPayrollPay_(p, ctx) {
  const tgl = ymd_(p.tgl);
  if (!tgl) throw new ApiError_('VALIDATION', 'Tanggal bayar wajib diisi.');
  return withLock_(function () {
    const run = runRows_().filter(function (r) { return r.id === p.id; })[0];
    if (!run || run.status !== 'posted') throw new ApiError_('VALIDATION', 'Penggajian harus sudah diposting sebelum dibayar.');
    if (run.tgl_bayar) throw new ApiError_('VALIDATION', 'Gaji ' + run.periode + ' sudah dibayar.');
    if (tgl < run.periode + '-01') throw new ApiError_('VALIDATION', 'Tanggal bayar tidak boleh sebelum bulan ' + run.periode + '.');
    const neto = cents_(run.total_neto);
    if (neto <= 0) throw new ApiError_('VALIDATION', 'Tidak ada gaji bersih yang perlu dibayar.');
    const kb = pickCash_(ctx, p.kasbank_id, neto);
    const ket = 'Pembayaran gaji ' + run.periode;
    const head = postJournal_(ctx, { tgl: tgl, jenis: 'KK', keterangan: ket, referensi: run.no, ref_dok: run.id + '-BAYAR', lines: [
      { akun_id: AKUN_UTANG_GAJI, memo: ket, debit: money_(neto), kredit: 0 },
      { akun_id: kb.akun_id, memo: ket, debit: 0, kredit: money_(neto) },
    ] });
    const trx = writeCashTrx_(ctx, { no: head.no, tgl: tgl, kb: kb, jenis: 'keluar', akun_lawan: AKUN_UTANG_GAJI, jumlah: neto, keterangan: ket, referensi: run.no, jurnal_id: head.id, sumber_dok: run.id, metode: p.metode, kontak_nama: run.karyawan + ' karyawan' });
    updateWhere_('T_GajiRun', 'id', run.id, { tgl_bayar: asText_(tgl), kasbank_id: kb.id, kasbank_trx: trx, jurnal_bayar: head.id });
    audit_(ctx, 'BAYAR_GAJI', 'T_GajiRun', run.periode, null, { jumlah: run.total_neto, rekening: kb.nama, jurnal: head.no }, '');
    return { no: head.no, jumlah: run.total_neto };
  });
}

function actionPayrollPayVoid_(p, ctx) {
  const alasan = String(p.alasan || '').trim();
  if (!alasan) throw new ApiError_('VALIDATION', 'Alasan pembatalan wajib diisi.');
  return withLock_(function () {
    const run = runRows_().filter(function (r) { return r.id === p.id; })[0];
    if (!run || !run.tgl_bayar) throw new ApiError_('VALIDATION', 'Gaji ini belum dibayar.');
    const rev = voidDocJournal_(ctx, run.jurnal_bayar, alasan, run.kasbank_trx);
    updateWhere_('T_GajiRun', 'id', run.id, { tgl_bayar: '', kasbank_id: '', kasbank_trx: '', jurnal_bayar: '' });
    audit_(ctx, 'BATAL_BAYAR_GAJI', 'T_GajiRun', run.periode, null, null, alasan);
    return { pembalik: rev ? rev.no : '' };
  });
}

/** Batalkan penggajian (draft dibuang; posted dibalik). */
function actionPayrollVoid_(p, ctx) {
  const alasan = String(p.alasan || '').trim();
  if (!alasan) throw new ApiError_('VALIDATION', 'Alasan pembatalan wajib diisi.');
  return withLock_(function () {
    const run = runRows_().filter(function (r) { return r.id === p.id; })[0];
    if (!run || run.status === 'batal') throw new ApiError_('VALIDATION', 'Penggajian tidak ditemukan atau sudah dibatalkan.');
    if (run.tgl_bayar) throw new ApiError_('VALIDATION', 'Gaji sudah dibayar. Batalkan pembayarannya dulu.');
    const later = runRows_().filter(function (r) { return r.status === 'posted' && r.periode > run.periode && r.periode.slice(0, 4) === run.periode.slice(0, 4); });
    if (run.status === 'posted' && later.length) throw new ApiError_('VALIDATION', 'Penggajian ' + later.map(function (r) { return r.periode; }).join(', ') + ' sudah diposting dan memakai data bulan ini untuk PPh 21. Batalkan yang terakhir dulu.');
    var rev = null;
    if (run.status === 'posted') rev = voidDocJournal_(ctx, run.jurnal_id, alasan, '');
    updateWhere_('T_GajiRun', 'id', run.id, { status: 'batal', alasan_batal: asText_(alasan) });
    audit_(ctx, run.status === 'posted' ? 'BATAL_GAJI' : 'BUANG_DRAFT_GAJI', 'T_GajiRun', run.periode, null, null, alasan);
    return { status: 'batal', pembalik: rev ? rev.no : '' };
  });
}

/** Rekap setahun per karyawan (bahan bukti potong 1721-A1). */
function actionPayrollAnnual_(p) {
  const y = String(p.tahun || todayYmd_().slice(0, 4));
  const posted = {};
  runRows_().forEach(function (r) { if (r.status === 'posted' && r.periode.slice(0, 4) === y) posted[r.id] = true; });
  const by = {};
  slipRows_().forEach(function (s) {
    if (!posted[s.run_id]) return;
    const o = by[s.karyawan_id] || (by[s.karyawan_id] = { karyawan_id: s.karyawan_id, kode: s.kode, nama: s.nama, ptkp: s.ptkp, bulan: 0, dari: s.periode, sampai: s.periode,
      gaji: 0, tunjangan: 0, lembur: 0, bonus_thr: 0, premi: 0, bruto: 0, iuran: 0, pph21: 0, neto_dibayar: 0, th_pph: null });
    o.bulan++;
    if (s.periode < o.dari) o.dari = s.periode;
    if (s.periode >= o.sampai) { o.sampai = s.periode; o.ptkp = s.ptkp; if (s.metode === 'tahunan') o.th_pph = s.th_pph; }
    o.gaji += s.gaji_pokok - s.potongan_absen; o.tunjangan += s.tunjangan; o.lembur += s.lembur; o.bonus_thr += s.bonus + s.thr;
    o.premi += s.jkk + s.jkm + s.bpjs_kes_p; o.bruto += s.bruto; o.iuran += s.jht_k + s.jp_k; o.pph21 += s.pph21; o.neto_dibayar += s.neto;
  });
  const rows = Object.keys(by).map(function (k) {
    const o = by[k];
    o.biaya_jabatan = Math.min(Math.floor(o.bruto * 0.05), 500000 * o.bulan);
    o.neto = o.bruto - o.biaya_jabatan - o.iuran;
    o.ptkp_rp = PTKP_[o.ptkp] || 0;
    o.pkp = Math.max(0, Math.floor((o.neto - o.ptkp_rp) / 1000) * 1000);
    o.pph_setahun = pasal17_(o.pkp);
    o.selisih = o.pph_setahun - o.pph21;
    return o;
  }).sort(function (a, b) { return a.nama.localeCompare(b.nama); });
  return { tahun: y, rows: rows };
}

/** p: { bpjs_kes_batas, bpjs_jp_batas, bpjs_jkk_tarif } */
function actionPayrollSettings_(p, ctx) {
  const keys = { bpjs_kes_batas: [1000000, 100000000], bpjs_jp_batas: [1000000, 100000000], bpjs_jkk_tarif: [0.1, 2] };
  return withLock_(function () {
    const out = {};
    Object.keys(keys).forEach(function (k) {
      if (p[k] === undefined) return;
      const v = Number(p[k]);
      if (!isFinite(v) || v < keys[k][0] || v > keys[k][1]) throw new ApiError_('VALIDATION', k + ' di luar batas wajar (' + keys[k][0] + '–' + keys[k][1] + ').');
      setSetting_(k, v);
      out[k] = v;
    });
    audit_(ctx, 'UBAH_SETTING', 'SYS_Setting', 'bpjs', null, out, '');
    return out;
  });
}
