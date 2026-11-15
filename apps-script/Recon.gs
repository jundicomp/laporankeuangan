/**
 * Recon — rekonsiliasi bank: cocokkan mutasi buku (baris jurnal ke akun rekening) dengan rekening koran.
 *
 * Tiap baris jurnal yang sudah muncul di rekening koran ditandai (kolom `rekon` di T_JurnalDetail = id rekonsiliasi).
 * Saldo bank menurut perhitungan = saldo buku − setoran dalam perjalanan (debit belum muncul) + pengeluaran beredar
 * (kredit belum muncul). Final hanya boleh bila hasilnya sama persis dengan saldo rekening koran.
 */

function reconRows_() {
  return readTable_('T_Rekon').map(function (r) {
    r.tgl = ymd_(r.tgl);
    ['saldo_koran', 'saldo_buku', 'transit', 'beredar', 'selisih'].forEach(function (k) { r[k] = Number(r[k]) || 0; });
    return r;
  });
}

function reconAccount_(ctx, id) {
  const kb = kasbankRows_().filter(function (k) { return k.id === id; })[0];
  if (!kb) throw new ApiError_('NOT_FOUND', 'Rekening tidak ditemukan.');
  if (!canSeeAccount_(ctx.session, kb)) throw new ApiError_('FORBIDDEN', 'Peran Anda tidak punya akses ke rekening bank ini.');
  return kb;
}

/** Baris jurnal ke akun rekening s/d tgl, tanpa transaksi yang dibatalkan (dan pembaliknya). */
function reconLines_(akun, tgl) {
  const heads = {};
  journalHeads_().forEach(function (h) { heads[h.id] = h; });
  const voided = {};
  Object.keys(heads).forEach(function (k) { if (heads[k].status === 'batal') voided[k] = true; });
  const out = [];
  journalLines_().forEach(function (d) {
    const h = heads[d.jurnal_id];
    if (!h || d.akun_id !== akun || h.tgl > tgl) return;
    if (h.status !== 'posted' || voided[h.id]) return;
    if (h.jenis === 'JR' && h.jurnal_asal && voided[h.jurnal_asal]) return; // pembalik pembatalan
    out.push({ key: d.jurnal_id + ':' + d.baris, jurnal_id: d.jurnal_id, jenis: h.jenis, tgl: h.tgl, no: String(h.no), keterangan: d.memo && d.memo !== h.keterangan ? h.keterangan + ' — ' + d.memo : h.keterangan,
      masuk: d.debit, keluar: d.kredit, rekon: String(d.rekon || '') });
  });
  return out.sort(function (a, b) { return a.tgl < b.tgl ? -1 : a.tgl > b.tgl ? 1 : a.no.localeCompare(b.no); });
}

function actionReconGet_(p, ctx) {
  const kb = reconAccount_(ctx, p.kasbank_id);
  const hist = reconRows_().filter(function (r) { return r.kasbank_id === kb.id; }).sort(function (a, b) { return a.tgl < b.tgl ? 1 : -1; });
  const draft = hist.filter(function (r) { return r.status === 'draft'; })[0] || null;
  const lastFinal = hist.filter(function (r) { return r.status === 'final'; })[0] || null;
  const tgl = p.tgl ? ymd_(p.tgl) : (draft ? draft.tgl : todayYmd_());
  const items = reconLines_(kb.akun_id, tgl).filter(function (l) { return !l.rekon || (draft && l.rekon === draft.id); })
    // saldo awal (SA) otomatis dianggap sudah cocok dengan koran pada rekonsiliasi pertama
    .map(function (l) { l.cleared = !!l.rekon || (!draft && l.jenis === 'SA'); return l; });
  return {
    rekening: { id: kb.id, nama: kb.nama, jenis: kb.jenis, akun_id: kb.akun_id, no_rek: kb.no_rek },
    tgl: tgl, saldo_buku: money_(balanceAt_(kb.akun_id, tgl)), items: items,
    draft: draft, terakhir: lastFinal, riwayat: hist.slice(0, 24),
  };
}

/** Tulis kolom `rekon` T_JurnalDetail sekaligus. set: { 'jurnal_id:baris': nilai } */
function setLineRecon_(set) {
  const sh = getSheet_('T_JurnalDetail');
  const values = sh.getDataRange().getValues();
  const head = values[0].map(String);
  const cj = head.indexOf('jurnal_id'), cb = head.indexOf('baris'), cr = head.indexOf('rekon');
  if (cr < 0) throw new ApiError_('SCHEMA', 'Kolom rekon belum ada di T_JurnalDetail. Jalankan upgradeSchema.');
  var changed = false;
  const col = values.slice(1).map(function (r) {
    const k = r[cj] + ':' + Number(r[cb]);
    if (k in set && String(r[cr] || '') !== set[k]) { changed = true; return [set[k]]; }
    return [r[cr]];
  });
  if (changed && col.length) { sh.getRange(2, cr + 1, col.length, 1).setValues(col); invalidate_('T_JurnalDetail'); }
}

/** p: { kasbank_id, tgl, saldo_koran, cleared: [key], final, catatan } */
function actionReconSave_(p, ctx) {
  const tgl = ymd_(p.tgl);
  if (!tgl) throw new ApiError_('VALIDATION', 'Isi tanggal rekening koran.');
  if (p.saldo_koran === undefined || p.saldo_koran === '' || !isFinite(Number(p.saldo_koran))) throw new ApiError_('VALIDATION', 'Isi saldo akhir menurut rekening koran.');
  return withLock_(function () {
    const kb = reconAccount_(ctx, p.kasbank_id);
    const hist = reconRows_().filter(function (r) { return r.kasbank_id === kb.id; });
    const lastFinal = hist.filter(function (r) { return r.status === 'final'; }).sort(function (a, b) { return a.tgl < b.tgl ? 1 : -1; })[0];
    if (lastFinal && tgl <= lastFinal.tgl) throw new ApiError_('VALIDATION', 'Sudah ada rekonsiliasi final s/d ' + lastFinal.tgl + '. Pilih tanggal sesudahnya.');
    var draft = hist.filter(function (r) { return r.status === 'draft'; })[0];
    const id = draft ? draft.id : newId_('REK');
    const lines = reconLines_(kb.akun_id, tgl);
    const allowed = {};
    lines.forEach(function (l) { if (!l.rekon || l.rekon === id) allowed[l.key] = l; });
    const want = {};
    (p.cleared || []).forEach(function (k) { if (allowed[k]) want[k] = true; });
    // tandai yang dicentang, lepas yang tadinya milik rekonsiliasi ini (termasuk baris sesudah tgl baru)
    const set = {};
    Object.keys(allowed).forEach(function (k) { set[k] = want[k] ? id : ''; });
    reconLines_(kb.akun_id, '9999-12-31').forEach(function (l) { if (l.rekon === id && !want[l.key]) set[l.key] = ''; });
    setLineRecon_(set);
    var transit = 0, beredar = 0;
    Object.keys(allowed).forEach(function (k) {
      if (want[k]) return;
      transit += cents_(allowed[k].masuk);
      beredar += cents_(allowed[k].keluar);
    });
    const buku = balanceAt_(kb.akun_id, tgl);
    const koran = cents_(Number(p.saldo_koran));
    const hitung = buku - transit + beredar;
    const selisih = koran - hitung;
    const final = !!p.final;
    if (final && selisih !== 0) throw new ApiError_('NOT_BALANCED', 'Masih ada selisih Rp ' + formatRp_(Math.abs(selisih)) + '. Final hanya bila saldo hitungan sama dengan rekening koran.');
    const row = {
      kasbank_id: kb.id, tgl: asText_(tgl), saldo_koran: money_(koran), saldo_buku: money_(buku), transit: money_(transit), beredar: money_(beredar),
      selisih: money_(selisih), status: final ? 'final' : 'draft', catatan: asText_(String(p.catatan || '').trim()),
      diubah_oleh: ctx.session.username, diubah_pada: new Date(),
    };
    if (draft) updateWhere_('T_Rekon', 'id', id, row);
    else { row.id = id; row.dibuat_oleh = ctx.session.username; row.dibuat_pada = new Date(); appendObjects_('T_Rekon', [row]); }
    if (final) {
      // transaksi kas & bank yang sudah cocok tidak boleh dibatalkan lagi
      const cleared = {};
      Object.keys(want).forEach(function (k) { cleared[allowed[k].jurnal_id] = true; });
      cashRows_().forEach(function (t) { if (cleared[t.jurnal_id] && !bool_(t.rekon)) updateWhere_('T_KasBank', 'id', t.id, { rekon: true }); });
      audit_(ctx, 'REKONSILIASI', 'T_Rekon', kb.nama + ' ' + tgl, null, { saldo_koran: row.saldo_koran, baris: Object.keys(want).length }, '');
    }
    return { id: id, status: row.status, saldo_buku: row.saldo_buku, transit: row.transit, beredar: row.beredar, hitung: money_(hitung), saldo_koran: row.saldo_koran, selisih: row.selisih };
  });
}

/** Buka kembali rekonsiliasi final terakhir (mis. salah centang). */
function actionReconReopen_(p, ctx) {
  const alasan = String(p.alasan || '').trim();
  if (!alasan) throw new ApiError_('VALIDATION', 'Alasan wajib diisi.');
  return withLock_(function () {
    const r = reconRows_().filter(function (x) { return x.id === p.id; })[0];
    if (!r) throw new ApiError_('NOT_FOUND', 'Rekonsiliasi tidak ditemukan.');
    const kb = reconAccount_(ctx, r.kasbank_id);
    const all = reconRows_().filter(function (x) { return x.kasbank_id === kb.id; });
    if (all.some(function (x) { return x.status === 'draft'; })) throw new ApiError_('VALIDATION', 'Selesaikan atau hapus draft rekonsiliasi yang ada dulu.');
    const latest = all.filter(function (x) { return x.status === 'final'; }).sort(function (a, b) { return a.tgl < b.tgl ? 1 : -1; })[0];
    if (!latest || latest.id !== r.id) throw new ApiError_('VALIDATION', 'Hanya rekonsiliasi final terakhir yang bisa dibuka kembali.');
    updateWhere_('T_Rekon', 'id', r.id, { status: 'draft', catatan: asText_((r.catatan ? r.catatan + ' · ' : '') + 'dibuka: ' + alasan) });
    const jids = {};
    reconLines_(kb.akun_id, '9999-12-31').forEach(function (l) { if (l.rekon === r.id) jids[l.jurnal_id] = true; });
    cashRows_().forEach(function (t) { if (jids[t.jurnal_id] && bool_(t.rekon)) updateWhere_('T_KasBank', 'id', t.id, { rekon: false }); });
    audit_(ctx, 'BUKA_REKONSILIASI', 'T_Rekon', kb.nama + ' ' + r.tgl, null, null, alasan);
    return { id: r.id, status: 'draft' };
  });
}
