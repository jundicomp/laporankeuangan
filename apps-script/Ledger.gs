/**
 * Ledger — inti akuntansi double-entry.
 *
 * postJournal_() adalah SATU-SATUNYA pintu menulis jurnal berstatus posted.
 * Modul lain (kas, penjualan, payroll, penyusutan …) nanti memanggil fungsi ini,
 * jadi aturan seimbang, akun valid, dan periode terbuka berlaku di mana-mana.
 *
 * Status jurnal: draft → (menunggu) → posted → batal
 * Jenis: JU umum · JP penyesuaian · SA saldo awal · JR pembalik · JT penutup (sistem)
 */

const JOURNAL_TYPES = {
  JU: 'Jurnal umum', JP: 'Jurnal penyesuaian', SA: 'Saldo awal', JR: 'Jurnal pembalik', JT: 'Jurnal penutup',
  KM: 'Kas masuk', KK: 'Kas keluar', TR: 'Transfer kas/bank', PJ: 'Penjualan',
};
const MANUAL_TYPES = ['JU', 'JP', 'SA'];
const ACCOUNT_TYPES = ['aset', 'liabilitas', 'ekuitas', 'pendapatan', 'hpp', 'beban', 'lain', 'pajak'];

// ---------------------------------------------------------------- tanggal & angka

var TZ_ = null;
function tz_() {
  if (!TZ_) TZ_ = getSetting_('zona_waktu') || 'Asia/Jakarta';
  return TZ_;
}

/** Normalkan nilai tanggal apa pun (Date, ISO, "2026-10-12") ke "yyyy-MM-dd" zona lokal. */
function ymd_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) throw new ApiError_('VALIDATION', 'Tanggal tidak valid: ' + s);
  return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
}

/** "yyyy-MM" dari nilai periode yang mungkin sudah diubah Sheets menjadi tanggal. */
function ym_(v) {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  return ymd_(v).slice(0, 7);
}

function cents_(v) {
  const n = Number(String(v === undefined || v === null ? '' : v).replace(/,/g, '.'));
  if (!isFinite(n)) throw new ApiError_('VALIDATION', 'Angka tidak valid: ' + v);
  return Math.round(n * 100);
}

function money_(c) {
  return c / 100;
}

// ---------------------------------------------------------------- periode

function periodRows_() {
  return readTable_('SYS_Periode').map(function (r) {
    return { periode: ym_(r.periode), status: r.status || 'buka', diubah_oleh: r.diubah_oleh, diubah_pada: r.diubah_pada, alasan: r.alasan };
  });
}

function periodStatus_(ym) {
  const r = periodRows_().filter(function (p) { return p.periode === ym; })[0];
  return r ? r.status : 'buka';
}

function assertOpen_(tgl) {
  const ym = tgl.slice(0, 7);
  const st = periodStatus_(ym);
  if (st !== 'buka') {
    throw new ApiError_('PERIOD_LOCKED', 'Periode ' + ym + ' sudah ' + (st === 'tutup' ? 'ditutup' : 'dikunci') + '. Pilih tanggal lain atau minta owner membuka periode.');
  }
}

function actionPeriodList_(p) {
  const year = String(p.tahun || new Date().getFullYear());
  const rows = periodRows_();
  const heads = readTable_('T_Jurnal');
  const out = [];
  for (var m = 1; m <= 12; m++) {
    const ym = year + '-' + ('0' + m).slice(-2);
    const r = rows.filter(function (x) { return x.periode === ym; })[0] || { periode: ym, status: 'buka' };
    const inMonth = heads.filter(function (h) { return ymd_(h.tgl).slice(0, 7) === ym; });
    r.posted = inMonth.filter(function (h) { return h.status === 'posted'; }).length;
    r.draft = inMonth.filter(function (h) { return h.status === 'draft' || h.status === 'menunggu'; }).length;
    out.push(r);
  }
  return out;
}

function actionPeriodSet_(p, ctx) {
  const ym = ym_(p.periode);
  const status = String(p.status);
  if (['buka', 'kunci'].indexOf(status) < 0) throw new ApiError_('VALIDATION', 'Status periode tidak dikenal.');
  const current = periodStatus_(ym);
  if (current === status) return { periode: ym, status: status };
  if (status === 'buka') {
    if (!hasPerm_(ctx.session, 'periode.reopen')) throw new ApiError_('FORBIDDEN', 'Hanya owner yang bisa membuka kembali periode.');
    if (!String(p.alasan || '').trim()) throw new ApiError_('VALIDATION', 'Alasan membuka kembali periode wajib diisi.');
  }
  return withLock_(function () {
    const patch = { status: status, diubah_oleh: ctx.session.username, diubah_pada: new Date(), alasan: p.alasan || '' };
    var r;
    const sh = getSheet_('SYS_Periode');
    const values = sh.getDataRange().getValues();
    var row = -1;
    for (var i = 1; i < values.length; i++) if (ym_(values[i][0] instanceof Date ? values[i][0] : values[i][0]) === ym) row = i;
    if (row < 0) {
      appendObjects_('SYS_Periode', [{ periode: asText_(ym), status: status, diubah_oleh: patch.diubah_oleh, diubah_pada: patch.diubah_pada, alasan: patch.alasan }]);
      r = { before: { periode: ym, status: 'buka' }, after: patch };
    } else {
      const head = values[0].map(String);
      const before = rowToObj_(head, values[row]);
      const newRow = values[row].slice();
      newRow[0] = asText_(ym);
      Object.keys(patch).forEach(function (k) { const j = head.indexOf(k); if (j >= 0) newRow[j] = patch[k]; });
      sh.getRange(row + 1, 1, 1, head.length).setValues([newRow]);
      invalidate_('SYS_Periode');
      r = { before: before, after: patch };
    }
    audit_(ctx, status === 'kunci' ? 'KUNCI_PERIODE' : 'BUKA_PERIODE', 'SYS_Periode', ym, r.before, r.after, p.alasan || '');
    return { periode: ym, status: status };
  });
}

// ---------------------------------------------------------------- COA

function accountsMap_() {
  const m = {};
  readTable_('M_Akun').forEach(function (a) { m[String(a.kode)] = a; });
  return m;
}

function actionCoaSave_(p, ctx) {
  const kode = String(p.kode || '').trim();
  if (!/^[0-9][0-9.\-]{0,19}$/.test(kode)) throw new ApiError_('VALIDATION', 'Kode akun diawali angka, boleh titik/minus, maks 20 karakter.');
  const nama = String(p.nama || '').trim();
  if (!nama) throw new ApiError_('VALIDATION', 'Nama akun wajib diisi.');
  if (ACCOUNT_TYPES.indexOf(p.tipe) < 0) throw new ApiError_('VALIDATION', 'Tipe akun tidak dikenal.');
  if (['D', 'K'].indexOf(p.saldo_normal) < 0) throw new ApiError_('VALIDATION', 'Saldo normal harus D atau K.');
  return withLock_(function () {
    const map = accountsMap_();
    const parent = String(p.parent || '');
    if (parent && (!map[parent] || !bool_(map[parent].is_header))) throw new ApiError_('VALIDATION', 'Induk harus akun header yang ada.');
    const used = usedAccounts_();
    const obj = { kode: asText_(kode), nama: nama, tipe: p.tipe, saldo_normal: p.saldo_normal, parent: parent ? asText_(parent) : '', is_header: !!p.is_header, aktif: p.aktif !== false };
    if (p.isNew) {
      if (map[kode]) throw new ApiError_('VALIDATION', 'Kode akun ' + kode + ' sudah ada.');
      appendObjects_('M_Akun', [obj]);
      audit_(ctx, 'BUAT', 'M_Akun', kode, null, obj, '');
    } else {
      const old = map[kode];
      if (!old) throw new ApiError_('NOT_FOUND', 'Akun tidak ditemukan.');
      if (used[kode] && (obj.is_header || old.saldo_normal !== obj.saldo_normal)) {
        throw new ApiError_('VALIDATION', 'Akun sudah dipakai di jurnal: tidak bisa dijadikan header atau diubah saldo normalnya.');
      }
      if (bool_(old.is_header) && !obj.is_header && readTable_('M_Akun').some(function (a) { return String(a.parent) === kode; })) {
        throw new ApiError_('VALIDATION', 'Akun ini masih punya sub-akun.');
      }
      if (!obj.aktif && used[kode] && balanceOf_(kode) !== 0) throw new ApiError_('VALIDATION', 'Akun masih bersaldo, tidak bisa dinonaktifkan.');
      const r = updateWhere_('M_Akun', 'kode', kode, obj);
      audit_(ctx, 'UBAH', 'M_Akun', kode, r.before, r.after, '');
    }
    return readTable_('M_Akun');
  });
}

// ---------------------------------------------------------------- baca jurnal

function journalHeads_() {
  return readTable_('T_Jurnal').map(function (h) {
    h.tgl = ymd_(h.tgl);
    h.total = Number(h.total) || 0;
    h.balik_otomatis = bool_(h.balik_otomatis);
    return h;
  });
}

function journalLines_() {
  return readTable_('T_JurnalDetail').map(function (d) {
    d.akun_id = String(d.akun_id);
    d.debit = Number(d.debit) || 0;
    d.kredit = Number(d.kredit) || 0;
    d.baris = Number(d.baris) || 0;
    return d;
  });
}

function usedAccounts_() {
  const used = {};
  journalLines_().forEach(function (d) { used[d.akun_id] = true; });
  return used;
}

/** Saldo (dalam sen, arah saldo normal) semua jurnal posted. */
function balanceOf_(kode) {
  const acc = accountsMap_()[kode];
  const posted = {};
  journalHeads_().forEach(function (h) { if (h.status === 'posted') posted[h.id] = true; });
  var c = 0;
  journalLines_().forEach(function (d) {
    if (posted[d.jurnal_id] && d.akun_id === kode) c += cents_(d.debit) - cents_(d.kredit);
  });
  return acc && acc.saldo_normal === 'K' ? -c : c;
}

function actionJournalList_(p) {
  var heads = journalHeads_();
  if (p.from) heads = heads.filter(function (h) { return h.tgl >= p.from; });
  if (p.to) heads = heads.filter(function (h) { return h.tgl <= p.to; });
  if (p.status) heads = heads.filter(function (h) { return h.status === p.status; });
  if (p.jenis) heads = heads.filter(function (h) { return h.jenis === p.jenis; });
  if (p.q) {
    const q = String(p.q).toLowerCase();
    heads = heads.filter(function (h) { return (h.no + ' ' + h.keterangan + ' ' + h.referensi).toLowerCase().indexOf(q) >= 0; });
  }
  heads.sort(function (a, b) { return a.tgl < b.tgl ? 1 : a.tgl > b.tgl ? -1 : String(b.dibuat_pada).localeCompare(String(a.dibuat_pada)); });
  const limit = Math.min(Number(p.limit) || 50, 200);
  const offset = Number(p.offset) || 0;
  return { total: heads.length, rows: heads.slice(offset, offset + limit) };
}

function actionJournalGet_(p) {
  const h = journalHeads_().filter(function (x) { return x.id === p.id; })[0];
  if (!h) throw new ApiError_('NOT_FOUND', 'Jurnal tidak ditemukan.');
  const accs = accountsMap_();
  h.lines = journalLines_().filter(function (d) { return d.jurnal_id === h.id; })
    .sort(function (a, b) { return a.baris - b.baris; })
    .map(function (d) { d.akun_nama = (accs[d.akun_id] || {}).nama || '?'; return d; });
  return h;
}

// ---------------------------------------------------------------- validasi & tulis

/** Bersihkan & validasi baris. strict=true untuk posting. Mengembalikan baris dalam sen. */
function cleanLines_(lines, strict) {
  const accs = accountsMap_();
  const out = [];
  (lines || []).forEach(function (l) {
    const akun = String(l.akun_id || '').trim();
    const d = cents_(l.debit || 0);
    const k = cents_(l.kredit || 0);
    if (!akun && !d && !k && !l.memo) return;
    if (!akun) throw new ApiError_('VALIDATION', 'Baris ' + (out.length + 1) + ': akun belum dipilih.');
    const a = accs[akun];
    if (!a) throw new ApiError_('VALIDATION', 'Akun ' + akun + ' tidak ada di COA.');
    if (bool_(a.is_header)) throw new ApiError_('VALIDATION', 'Akun ' + akun + ' adalah akun header, pilih sub-akunnya.');
    if (strict && !bool_(a.aktif)) throw new ApiError_('VALIDATION', 'Akun ' + akun + ' nonaktif.');
    if (d < 0 || k < 0) throw new ApiError_('VALIDATION', 'Baris ' + (out.length + 1) + ': nominal tidak boleh negatif.');
    if (d && k) throw new ApiError_('VALIDATION', 'Baris ' + (out.length + 1) + ': isi debit ATAU kredit, bukan keduanya.');
    if (strict && !d && !k) throw new ApiError_('VALIDATION', 'Baris ' + (out.length + 1) + ': nominal masih kosong.');
    out.push({ akun_id: akun, memo: String(l.memo || '').slice(0, 200), divisi: l.divisi || '', proyek: l.proyek || '', debit: d, kredit: k });
  });
  if (strict) {
    if (out.length < 2) throw new ApiError_('VALIDATION', 'Jurnal minimal 2 baris.');
    const td = out.reduce(function (s, l) { return s + l.debit; }, 0);
    const tk = out.reduce(function (s, l) { return s + l.kredit; }, 0);
    if (td !== tk) throw new ApiError_('UNBALANCED', 'Debit (' + money_(td) + ') dan kredit (' + money_(tk) + ') belum seimbang. Selisih ' + money_(Math.abs(td - tk)) + '.');
    if (td === 0) throw new ApiError_('VALIDATION', 'Total jurnal tidak boleh nol.');
  }
  return out;
}

function writeLines_(jurnalId, lines) {
  appendObjects_('T_JurnalDetail', lines.map(function (l, i) {
    return { jurnal_id: jurnalId, baris: i + 1, akun_id: asText_(l.akun_id), memo: asText_(l.memo), divisi: l.divisi, proyek: l.proyek, debit: money_(l.debit), kredit: money_(l.kredit) };
  }));
}

function deleteLines_(jurnalId) {
  const sh = getSheet_('T_JurnalDetail');
  const values = sh.getDataRange().getValues();
  for (var i = values.length - 1; i >= 1; i--) {
    if (values[i][0] === jurnalId) sh.deleteRow(i + 1);
  }
  invalidate_('T_JurnalDetail');
}

function journalNumber_(jenis, tgl) {
  const year = Number(tgl.slice(0, 4));
  const n = nextNumber_(jenis, 'PST', year);
  const fmt = getSetting_('format_nomor_jurnal') || '{JENIS}/{YYYY}/{MM}/{####}';
  return formatNumber_(fmt.replace('{JENIS}', jenis).replace('{MM}', tgl.slice(5, 7)), 'PST', year, n);
}

/**
 * SATU-SATUNYA pintu jurnal posted. Wajib di dalam withLock_.
 * j: { tgl, jenis, keterangan, referensi, ref_dok, lines, balik_otomatis, jurnal_asal, id? (draft yang diposting) }
 */
function postJournal_(ctx, j) {
  const tgl = ymd_(j.tgl);
  assertOpen_(tgl);
  const lines = cleanLines_(j.lines, true);
  const total = lines.reduce(function (s, l) { return s + l.debit; }, 0);
  const now = new Date();
  var head;
  if (j.id) {
    const old = journalHeads_().filter(function (h) { return h.id === j.id; })[0];
    deleteLines_(j.id);
    head = {
      no: old.no || journalNumber_(j.jenis, tgl), tgl: asText_(tgl), jenis: j.jenis, keterangan: asText_(j.keterangan), referensi: asText_(j.referensi),
      status: 'posted', balik_otomatis: !!j.balik_otomatis, total: money_(total), diposting_oleh: ctx.session.username, diposting_pada: now,
    };
    updateWhere_('T_Jurnal', 'id', j.id, head);
    head.id = j.id;
  } else {
    head = {
      id: newId_('JRN'), no: journalNumber_(j.jenis, tgl), tgl: asText_(tgl), jenis: j.jenis, ref_dok: j.ref_dok || '', cabang_id: j.cabang_id || '',
      keterangan: asText_(j.keterangan), referensi: asText_(j.referensi), status: 'posted', balik_otomatis: !!j.balik_otomatis,
      dibuat_oleh: ctx.session.username, dibuat_pada: now, diposting_oleh: ctx.session.username, diposting_pada: now,
      total: money_(total), jurnal_asal: j.jurnal_asal || '',
    };
    appendObjects_('T_Jurnal', [head]);
  }
  writeLines_(head.id, lines);
  head.tgl = tgl;
  head.keterangan = j.keterangan || '';
  head.referensi = j.referensi || '';
  audit_(ctx, 'POSTING', 'T_Jurnal', head.no, null, { no: head.no, tgl: tgl, jenis: j.jenis, total: head.total, keterangan: head.keterangan }, '');
  if (j.balik_otomatis && j.jenis !== 'JR') reverseJournal_(ctx, head, lines, firstOfNextMonth_(tgl), 'Pembalik otomatis ' + head.no, false);
  return head;
}

function firstOfNextMonth_(tgl) {
  var y = Number(tgl.slice(0, 4));
  var m = Number(tgl.slice(5, 7)) + 1;
  if (m > 12) { m = 1; y++; }
  return y + '-' + ('0' + m).slice(-2) + '-01';
}

/** Buat jurnal kebalikan (debit↔kredit). */
function reverseJournal_(ctx, head, linesCents, tgl, ket, isVoid) {
  return postJournal_(ctx, {
    tgl: tgl, jenis: 'JR', keterangan: ket, referensi: head.no, jurnal_asal: head.id,
    lines: linesCents.map(function (l) { return { akun_id: l.akun_id, memo: l.memo, debit: money_(l.kredit), kredit: money_(l.debit) }; }),
  });
}

// ---------------------------------------------------------------- aksi jurnal

function actionJournalSave_(p, ctx) {
  const jenis = String(p.jenis || 'JU');
  if (MANUAL_TYPES.indexOf(jenis) < 0) throw new ApiError_('VALIDATION', 'Jenis jurnal ' + jenis + ' tidak bisa dibuat manual.');
  const tgl = ymd_(p.tgl);
  if (!tgl) throw new ApiError_('VALIDATION', 'Tanggal wajib diisi.');
  if (!String(p.keterangan || '').trim()) throw new ApiError_('VALIDATION', 'Keterangan wajib diisi.');
  return withLock_(function () {
    var existing = null;
    if (p.id) {
      existing = journalHeads_().filter(function (h) { return h.id === p.id; })[0];
      if (!existing) throw new ApiError_('NOT_FOUND', 'Jurnal tidak ditemukan.');
      if (existing.status !== 'draft') throw new ApiError_('VALIDATION', 'Hanya draft yang bisa diubah. Jurnal posted dikoreksi dengan jurnal baru atau dibatalkan.');
    }
    const j = { id: p.id, tgl: tgl, jenis: jenis, keterangan: String(p.keterangan).trim(), referensi: String(p.referensi || '').trim(), lines: p.lines, balik_otomatis: !!p.balik_otomatis };
    if (p.submit) {
      const needApproval = moduleActive_('approval') && !hasPerm_(ctx.session, 'jurnal.approve');
      if (!needApproval) return postJournal_(ctx, j);
      assertOpen_(tgl);
      cleanLines_(p.lines, true);
      const saved = saveDraft_(ctx, j, existing, 'menunggu');
      audit_(ctx, 'AJUKAN', 'T_Jurnal', saved.no || saved.id, null, null, '');
      return saved;
    }
    return saveDraft_(ctx, j, existing, 'draft');
  });
}

function saveDraft_(ctx, j, existing, status) {
  const lines = cleanLines_(j.lines, false);
  const total = lines.reduce(function (s, l) { return s + l.debit; }, 0);
  const fields = { tgl: asText_(j.tgl), jenis: j.jenis, keterangan: asText_(j.keterangan), referensi: asText_(j.referensi), status: status, balik_otomatis: j.balik_otomatis, total: money_(total) };
  var id;
  if (existing) {
    id = existing.id;
    deleteLines_(id);
    updateWhere_('T_Jurnal', 'id', id, fields);
  } else {
    id = newId_('JRN');
    fields.id = id;
    fields.no = '';
    fields.dibuat_oleh = ctx.session.username;
    fields.dibuat_pada = new Date();
    appendObjects_('T_Jurnal', [fields]);
  }
  writeLines_(id, lines);
  fields.id = id;
  fields.tgl = j.tgl;
  fields.keterangan = j.keterangan;
  fields.referensi = j.referensi;
  return fields;
}

function actionJournalApprove_(p, ctx) {
  return withLock_(function () {
    const h = actionJournalGet_(p);
    if (h.status !== 'menunggu') throw new ApiError_('VALIDATION', 'Jurnal tidak sedang menunggu persetujuan.');
    if (h.dibuat_oleh === ctx.session.username) throw new ApiError_('VALIDATION', 'Pembuat jurnal tidak boleh menyetujui jurnalnya sendiri.');
    audit_(ctx, 'SETUJUI', 'T_Jurnal', h.id, null, null, '');
    return postJournal_(ctx, { id: h.id, tgl: h.tgl, jenis: h.jenis, keterangan: h.keterangan, referensi: h.referensi, lines: h.lines, balik_otomatis: h.balik_otomatis });
  });
}

function actionJournalReject_(p, ctx) {
  const alasan = String(p.alasan || '').trim();
  if (!alasan) throw new ApiError_('VALIDATION', 'Alasan penolakan wajib diisi.');
  return withLock_(function () {
    const h = actionJournalGet_(p);
    if (h.status !== 'menunggu') throw new ApiError_('VALIDATION', 'Jurnal tidak sedang menunggu persetujuan.');
    const r = updateWhere_('T_Jurnal', 'id', h.id, { status: 'draft', alasan_batal: 'Ditolak: ' + alasan });
    audit_(ctx, 'TOLAK', 'T_Jurnal', h.id, r.before, r.after, alasan);
    return { id: h.id, status: 'draft' };
  });
}

function actionJournalVoid_(p, ctx) {
  const alasan = String(p.alasan || '').trim();
  if (!alasan) throw new ApiError_('VALIDATION', 'Alasan pembatalan wajib diisi.');
  return withLock_(function () {
    const h = actionJournalGet_(p);
    const now = new Date();
    if (h.status === 'draft' || h.status === 'menunggu') {
      const r = updateWhere_('T_Jurnal', 'id', h.id, { status: 'batal', alasan_batal: alasan, dibatalkan_oleh: ctx.session.username, dibatalkan_pada: now });
      audit_(ctx, 'BUANG_DRAFT', 'T_Jurnal', h.id, r.before, r.after, alasan);
      return { id: h.id, status: 'batal' };
    }
    if (h.status !== 'posted') throw new ApiError_('VALIDATION', 'Jurnal ini sudah dibatalkan.');
    if (h.jenis === 'JT') throw new ApiError_('VALIDATION', 'Jurnal penutup hanya bisa dibatalkan lewat pembukaan kembali tutup buku.');
    if (h.ref_dok) throw new ApiError_('VALIDATION', 'Jurnal ini dibuat otomatis dari dokumen ' + h.ref_dok + '. Batalkan dokumennya.');
    assertOpen_(h.tgl);
    const linesC = h.lines.map(function (l) { return { akun_id: l.akun_id, memo: l.memo, debit: cents_(l.debit), kredit: cents_(l.kredit) }; });
    const rev = reverseJournal_(ctx, h, linesC, h.tgl, 'Pembatalan ' + h.no + ': ' + alasan, true);
    const r = updateWhere_('T_Jurnal', 'id', h.id, { status: 'batal', alasan_batal: alasan, dibatalkan_oleh: ctx.session.username, dibatalkan_pada: now });
    audit_(ctx, 'BATAL', 'T_Jurnal', h.no, r.before, r.after, alasan);
    return { id: h.id, status: 'batal', pembalik: rev.no };
  });
}

// ---------------------------------------------------------------- buku besar & neraca saldo

/**
 * Jurnal yang dihitung di saldo: posted, plus jurnal batal (karena pembaliknya posted).
 * Dengan begitu jejak pembatalan tetap terlihat dan saldo tetap benar.
 */
function effectiveIds_() {
  const ids = {};
  const heads = {};
  journalHeads_().forEach(function (h) {
    if (h.status === 'posted' || (h.status === 'batal' && h.no)) { ids[h.id] = true; heads[h.id] = h; }
  });
  return { ids: ids, heads: heads };
}

function actionLedgerAccount_(p) {
  const kode = String(p.akun_id || '');
  const acc = accountsMap_()[kode];
  if (!acc) throw new ApiError_('NOT_FOUND', 'Akun tidak ditemukan.');
  const sign = acc.saldo_normal === 'K' ? -1 : 1;
  const from = p.from ? ymd_(p.from) : '0000-00-00';
  const to = p.to ? ymd_(p.to) : '9999-12-31';
  const eff = effectiveIds_();
  var opening = 0;
  const rows = [];
  journalLines_().forEach(function (d) {
    if (!eff.ids[d.jurnal_id] || d.akun_id !== kode) return;
    const h = eff.heads[d.jurnal_id];
    const net = cents_(d.debit) - cents_(d.kredit);
    if (h.tgl < from) opening += net;
    else if (h.tgl <= to) rows.push({ tgl: h.tgl, no: h.no, jurnal_id: h.id, jenis: h.jenis, keterangan: d.memo || h.keterangan, debit: d.debit, kredit: d.kredit, _net: net, _t: String(h.diposting_pada) });
  });
  rows.sort(function (a, b) { return a.tgl < b.tgl ? -1 : a.tgl > b.tgl ? 1 : a._t.localeCompare(b._t); });
  var run = opening;
  var td = 0;
  var tk = 0;
  rows.forEach(function (r) {
    run += r._net;
    td += cents_(r.debit);
    tk += cents_(r.kredit);
    r.saldo = money_(run * sign);
    delete r._net; delete r._t;
  });
  return {
    akun: { kode: kode, nama: acc.nama, saldo_normal: acc.saldo_normal, tipe: acc.tipe },
    from: p.from || '', to: p.to || '',
    saldo_awal: money_(opening * sign), total_debit: money_(td), total_kredit: money_(tk), saldo_akhir: money_(run * sign), rows: rows,
  };
}

function actionLedgerTrial_(p) {
  const to = p.to ? ymd_(p.to) : '9999-12-31';
  const eff = effectiveIds_();
  const sums = {};
  journalLines_().forEach(function (d) {
    if (!eff.ids[d.jurnal_id] || eff.heads[d.jurnal_id].tgl > to) return;
    sums[d.akun_id] = (sums[d.akun_id] || 0) + cents_(d.debit) - cents_(d.kredit);
  });
  var td = 0;
  var tk = 0;
  const rows = readTable_('M_Akun').filter(function (a) { return !bool_(a.is_header); }).map(function (a) {
    const net = sums[String(a.kode)] || 0;
    if (net > 0) td += net; else tk -= net;
    return { kode: String(a.kode), nama: a.nama, tipe: a.tipe, saldo_normal: a.saldo_normal, debit: net > 0 ? money_(net) : 0, kredit: net < 0 ? money_(-net) : 0 };
  }).filter(function (r) { return p.includeZero || r.debit || r.kredit; });
  return { to: p.to || '', rows: rows, total_debit: money_(td), total_kredit: money_(tk), seimbang: td === tk };
}
