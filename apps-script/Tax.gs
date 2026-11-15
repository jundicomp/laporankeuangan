/**
 * Tax — rekap pajak per masa, setor pajak, kalender jatuh tempo.
 *
 * Batas waktu (PMK 81/2024, berlaku sejak 2025):
 *   setor PPh & PPN masa  : tanggal 15 bulan berikutnya
 *   lapor SPT Masa PPh    : tanggal 20 bulan berikutnya
 *   lapor SPT Masa PPN    : akhir bulan berikutnya
 *   SPT Tahunan           : orang pribadi akhir Maret, badan akhir April
 * Bila jatuh pada Sabtu/Minggu digeser ke hari kerja berikutnya (hari libur nasional belum dihitung).
 *
 * Terutang per masa dihitung dari mutasi akun pajak di buku besar (di luar jurnal setor pajak itu sendiri).
 * Setor PPN = kompensasi: Dr PPN keluaran, Cr PPN masukan, Cr kas (kurang bayar). Lebih bayar tetap di PPN masukan.
 */

const AKUN_PPN_MASUKAN_ = '1-1601';
const AKUN_PAJAK_DIMUKA = '1-1602';
const AKUN_BEBAN_PAJAK = '8-1101';

const PAJAK_JENIS = {
  ppn: { nama: 'PPN', akun: AKUN_PPN_KELUARAN, lapor: 'akhir' },
  pph21: { nama: 'PPh 21', akun: '2-1202', lapor: 20 },
  pph23: { nama: 'PPh 23', akun: '2-1203', lapor: 20 },
  pph42: { nama: 'PPh 4 ayat (2)', akun: '2-1204', lapor: 20 },
  pph25: { nama: 'PPh 25 (angsuran)', akun: AKUN_PAJAK_DIMUKA, lapor: 20 },
  final: { nama: 'PPh final UMKM 0,5%', akun: AKUN_BEBAN_PAJAK, lapor: '' },
};

function taxSettings_() {
  return {
    pkp: (getSetting_('pajak_pkp') || 'ya') === 'ya',
    final_umkm: getSetting_('pajak_final_umkm') === 'ya',
    pph25: Number(getSetting_('pajak_pph25')) || 0,
    bentuk: getSetting_('pajak_bentuk') === 'orang_pribadi' ? 'orang_pribadi' : 'badan',
  };
}

/** Geser ke Senin bila jatuh Sabtu/Minggu. */
function workday_(ymd) {
  const d = new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))));
  const dow = d.getUTCDay();
  return dow === 6 ? addDays_(ymd, 2) : dow === 0 ? addDays_(ymd, 1) : ymd;
}

function dueDates_(masa, jenis) {
  const next = ymAdd_(masa, 1);
  const lapor = PAJAK_JENIS[jenis].lapor;
  return {
    setor: workday_(next + '-15'),
    lapor: lapor === 'akhir' ? workday_(monthEnd_(next)) : lapor ? workday_(next + '-' + lapor) : '',
  };
}

function setorRows_() {
  return readTable_('T_SetorPajak').map(function (r) {
    r.masa = ym_(r.masa);
    r.tgl = ymd_(r.tgl);
    r.jumlah = Number(r.jumlah) || 0;
    r.kompensasi = Number(r.kompensasi) || 0;
    r.ntpn = String(r.ntpn || '');
    return r;
  });
}

/** Mutasi per bulan per akun (sen, debit +) tahun y, tanpa jurnal setor pajak & pembaliknya. */
function taxMovements_(y, setor) {
  const skip = {};
  setor.forEach(function (s) { if (s.jurnal_id) skip[s.jurnal_id] = true; });
  const eff = effectiveIds_();
  const accs = accountsMap_();
  const m = {};
  journalLines_().forEach(function (d) {
    if (!eff.ids[d.jurnal_id]) return;
    const h = eff.heads[d.jurnal_id];
    if (h.tgl.slice(0, 4) !== y || h.jenis === 'JT') return;
    if (skip[h.id] || (h.jurnal_asal && skip[h.jurnal_asal])) return;
    const ym = h.tgl.slice(0, 7);
    const b = m[ym] || (m[ym] = { _omzet: 0 });
    const c = cents_(d.debit) - cents_(d.kredit);
    b[d.akun_id] = (b[d.akun_id] || 0) + c;
    const a = accs[d.akun_id];
    if (a && a.tipe === 'pendapatan') b._omzet -= c;
  });
  return m;
}

function actionTaxSummary_(p) {
  const y = String(p.tahun || todayYmd_().slice(0, 4));
  const st = taxSettings_();
  const setor = setorRows_();
  const mov = taxMovements_(y, setor);
  const today = todayYmd_();
  const aktif = setor.filter(function (s) { return s.status === 'aktif'; });
  const jenisOn = Object.keys(PAJAK_JENIS).filter(function (j) {
    if (j === 'ppn') return st.pkp || Object.keys(mov).some(function (k) { return mov[k][AKUN_PPN_KELUARAN] || mov[k][AKUN_PPN_MASUKAN_]; });
    if (j === 'final') return st.final_umkm;
    if (j === 'pph25') return st.pph25 > 0 || aktif.some(function (s) { return s.jenis === 'pph25'; });
    return true;
  });
  const masa = [];
  for (var mm = 1; mm <= 12; mm++) {
    const ym = y + '-' + ('0' + mm).slice(-2);
    const b = mov[ym] || { _omzet: 0 };
    const items = {};
    jenisOn.forEach(function (j) {
      const it = { terutang: 0 };
      if (j === 'ppn') {
        it.keluaran = money_(-(b[AKUN_PPN_KELUARAN] || 0));
        it.masukan = money_(b[AKUN_PPN_MASUKAN_] || 0);
        it.terutang = money_(cents_(it.keluaran) - cents_(it.masukan));
      } else if (j === 'final') {
        it.omzet = money_(Math.max(0, b._omzet));
        it.terutang = Math.round(money_(Math.max(0, b._omzet)) * 0.005);
      } else if (j === 'pph25') {
        it.terutang = st.pph25;
      } else {
        it.terutang = money_(-(b[PAJAK_JENIS[j].akun] || 0));
      }
      const paid = aktif.filter(function (s) { return s.jenis === j && s.masa === ym; });
      it.disetor = money_(paid.reduce(function (t, s) { return t + cents_(s.jumlah); }, 0));
      it.setor = paid.map(function (s) { return { id: s.id, tgl: s.tgl, jumlah: s.jumlah, kompensasi: s.kompensasi, ntpn: s.ntpn }; });
      const due = dueDates_(ym, j);
      it.jatuh_tempo = due.setor;
      it.lapor = due.lapor;
      const ended = ymAdd_(ym, 1) + '-01' <= today;
      it.status = paid.length ? 'disetor' : (cents_(it.terutang) <= 0 ? (ended ? 'nihil' : 'berjalan') : !ended ? 'berjalan' : today > due.setor ? 'terlambat' : 'belum');
      if (j === 'ppn' && !paid.length && cents_(it.terutang) < 0 && ended) it.status = 'lebih_bayar';
      items[j] = it;
    });
    masa.push({ masa: ym, items: items });
  }
  const saldo = Object.keys(PAJAK_JENIS).filter(function (j) { return ['final'].indexOf(j) < 0; }).map(function (j) {
    const akun = PAJAK_JENIS[j].akun;
    const c = balanceAt_(akun, '9999-12-31');
    return { jenis: j, akun: akun, saldo: money_(j === 'pph25' ? c : -c) };
  });
  saldo.push({ jenis: 'ppn_masukan', akun: AKUN_PPN_MASUKAN_, saldo: money_(balanceAt_(AKUN_PPN_MASUKAN_, '9999-12-31')) });
  return { tahun: y, settings: st, jenis: jenisOn.map(function (j) { return { kode: j, nama: PAJAK_JENIS[j].nama, akun: PAJAK_JENIS[j].akun }; }),
    masa: masa, saldo: saldo, kalender: taxCalendar_(st, today) };
}

/** Jatuh tempo 3 bulan terakhir + 2 bulan ke depan, plus SPT tahunan. */
function taxCalendar_(st, today) {
  const cur = today.slice(0, 7);
  const out = [];
  const years = {};
  for (var i = -3; i <= 0; i++) years[ymAdd_(cur, i).slice(0, 4)] = true;
  const sums = {};
  Object.keys(years).forEach(function (y) {
    const s = actionTaxSummaryLite_(y, st);
    s.forEach(function (m) { sums[m.masa] = m.items; });
  });
  for (var k = -3; k <= -1; k++) {
    const ym = ymAdd_(cur, k);
    const items = sums[ym] || {};
    Object.keys(items).forEach(function (j) {
      const it = items[j];
      out.push({ tgl: it.jatuh_tempo, jenis: j, nama: 'Setor ' + PAJAK_JENIS[j].nama, masa: ym, jumlah: it.terutang, status: it.status });
      if (it.lapor) out.push({ tgl: it.lapor, jenis: j, nama: 'Lapor SPT Masa ' + PAJAK_JENIS[j].nama, masa: ym, jumlah: null, status: it.status === 'nihil' ? 'nihil' : 'lapor' });
    });
  }
  const prevY = String(Number(cur.slice(0, 4)) - 1);
  out.push({ tgl: workday_(cur.slice(0, 4) + (st.bentuk === 'badan' ? '-04-30' : '-03-31')), jenis: 'tahunan', nama: 'Lapor SPT Tahunan ' + (st.bentuk === 'badan' ? 'badan' : 'orang pribadi') + ' ' + prevY, masa: prevY, jumlah: null, status: 'lapor' });
  // yang sudah lewat hanya ditampilkan bila setorannya belum dicatat (terlambat)
  return out.filter(function (x) { return x.tgl <= addDays_(today, 75) && (x.tgl >= today || x.status === 'terlambat'); }).sort(function (a, b) { return a.tgl < b.tgl ? -1 : 1; });
}

/** Versi ringkas summary untuk kalender (tanpa saldo/kalender, menghindari rekursi). */
function actionTaxSummaryLite_(y, st) {
  const setor = setorRows_();
  const mov = taxMovements_(y, setor);
  const aktif = setor.filter(function (s) { return s.status === 'aktif'; });
  const today = todayYmd_();
  const out = [];
  for (var mm = 1; mm <= 12; mm++) {
    const ym = y + '-' + ('0' + mm).slice(-2);
    const b = mov[ym] || { _omzet: 0 };
    const items = {};
    Object.keys(PAJAK_JENIS).forEach(function (j) {
      var t;
      if (j === 'ppn') { if (!st.pkp) return; t = -(b[AKUN_PPN_KELUARAN] || 0) - (b[AKUN_PPN_MASUKAN_] || 0); }
      else if (j === 'final') { if (!st.final_umkm) return; t = Math.round(Math.max(0, b._omzet) * 0.005); }
      else if (j === 'pph25') { if (!st.pph25) return; t = st.pph25 * 100; }
      else t = -(b[PAJAK_JENIS[j].akun] || 0);
      if (j !== 'ppn' && j !== 'pph21' && t <= 0) return; // PPh 23/4(2) tanpa transaksi tidak perlu diingatkan
      const paid = aktif.some(function (s) { return s.jenis === j && s.masa === ym; });
      const due = dueDates_(ym, j);
      items[j] = { terutang: money_(t), jatuh_tempo: due.setor, lapor: due.lapor,
        status: paid ? 'disetor' : t <= 0 ? 'nihil' : today > due.setor ? 'terlambat' : 'belum' };
    });
    out.push({ masa: ym, items: items });
  }
  return out;
}

/** p: { jenis, masa, tgl, kasbank_id, jumlah, ntpn, keterangan } */
function actionTaxPay_(p, ctx) {
  const jenis = String(p.jenis || '');
  const def = PAJAK_JENIS[jenis];
  if (!def) throw new ApiError_('VALIDATION', 'Jenis pajak tidak dikenal.');
  const masa = ym_(p.masa);
  if (!isYm_(masa)) throw new ApiError_('VALIDATION', 'Masa pajak tidak valid.');
  const tgl = ymd_(p.tgl);
  if (!tgl) throw new ApiError_('VALIDATION', 'Tanggal setor wajib diisi.');
  if (tgl < masa + '-01') throw new ApiError_('VALIDATION', 'Tanggal setor tidak boleh sebelum masa pajak ' + masa + '.');
  const ntpn = String(p.ntpn || '').trim().toUpperCase();
  if (ntpn && !/^[0-9A-Z]{16}$/.test(ntpn)) throw new ApiError_('VALIDATION', 'NTPN terdiri dari 16 huruf/angka.');
  return withLock_(function () {
    const setor = setorRows_();
    if (setor.some(function (s) { return s.status === 'aktif' && s.jenis === jenis && s.masa === masa; })) throw new ApiError_('VALIDATION', def.nama + ' masa ' + masa + ' sudah dicatat disetor. Batalkan catatan lama dulu bila ingin mengganti.');
    const end = monthEnd_(masa);
    const id = newId_('PJK');
    const ket = String(p.keterangan || '').trim() || ('Setor ' + def.nama + ' masa ' + masa + (ntpn ? ' · NTPN ' + ntpn : ''));
    const lines = [];
    var kas = 0, komp = 0;
    if (jenis === 'ppn') {
      const k = -balanceAt_(AKUN_PPN_KELUARAN, end);
      const mIn = balanceAt_(AKUN_PPN_MASUKAN_, end);
      if (k <= 0) throw new ApiError_('VALIDATION', 'Tidak ada PPN keluaran yang belum dikompensasi s/d ' + masa + '. Bila masa ini nihil, cukup lapor SPT Masa PPN nihil.');
      komp = Math.min(k, Math.max(0, mIn));
      kas = k - komp;
      lines.push({ akun_id: AKUN_PPN_KELUARAN, memo: ket, debit: money_(k), kredit: 0 });
      if (komp) lines.push({ akun_id: AKUN_PPN_MASUKAN_, memo: 'Kompensasi PPN masukan ' + masa, debit: 0, kredit: money_(komp) });
    } else {
      kas = cents_(p.jumlah || 0);
      if (kas <= 0) throw new ApiError_('VALIDATION', 'Isi jumlah yang disetor.');
      if (['pph21', 'pph23', 'pph42'].indexOf(jenis) >= 0) {
        const outstanding = -balanceAt_(def.akun, '9999-12-31');
        if (kas > outstanding) throw new ApiError_('VALIDATION', 'Jumlah setor Rp ' + formatRp_(kas) + ' melebihi saldo utang ' + def.nama + ' Rp ' + formatRp_(Math.max(0, outstanding)) + '.');
      }
      lines.push({ akun_id: def.akun, memo: ket, debit: money_(kas), kredit: 0 });
    }
    var kb = null, head, trx = '';
    if (kas > 0) {
      kb = pickCash_(ctx, p.kasbank_id, kas);
      lines.push({ akun_id: kb.akun_id, memo: ket, debit: 0, kredit: money_(kas) });
      head = postJournal_(ctx, { tgl: tgl, jenis: 'KK', keterangan: ket, referensi: ntpn || (jenis.toUpperCase() + '-' + masa), ref_dok: id, lines: lines });
      trx = writeCashTrx_(ctx, { no: head.no, tgl: tgl, kb: kb, jenis: 'keluar', akun_lawan: jenis === 'ppn' ? AKUN_PPN_KELUARAN : def.akun, jumlah: kas, keterangan: ket, referensi: ntpn, jurnal_id: head.id, sumber_dok: id, kontak_nama: 'Kas negara' });
    } else {
      head = postJournal_(ctx, { tgl: tgl, jenis: 'JU', keterangan: ket + ' (kompensasi, tanpa setoran)', referensi: jenis.toUpperCase() + '-' + masa, ref_dok: id, lines: lines });
    }
    appendObjects_('T_SetorPajak', [{
      id: id, jenis: jenis, masa: asText_(masa), tgl: asText_(tgl), jumlah: money_(kas), kompensasi: money_(komp), ntpn: asText_(ntpn), kasbank_id: kb ? kb.id : '',
      jurnal_id: head.id, kasbank_trx: trx, status: 'aktif', keterangan: asText_(ket), dibuat_oleh: ctx.session.username, dibuat_pada: new Date(),
    }]);
    audit_(ctx, 'SETOR_PAJAK', 'T_SetorPajak', def.nama + ' ' + masa, null, { jumlah: money_(kas), kompensasi: money_(komp), ntpn: ntpn, jurnal: head.no }, '');
    return { id: id, no: head.no, jumlah: money_(kas), kompensasi: money_(komp) };
  });
}

function actionTaxPayVoid_(p, ctx) {
  const alasan = String(p.alasan || '').trim();
  if (!alasan) throw new ApiError_('VALIDATION', 'Alasan pembatalan wajib diisi.');
  return withLock_(function () {
    const s = setorRows_().filter(function (r) { return r.id === p.id; })[0];
    if (!s || s.status !== 'aktif') throw new ApiError_('VALIDATION', 'Catatan setor tidak ditemukan atau sudah dibatalkan.');
    const rev = voidDocJournal_(ctx, s.jurnal_id, alasan, s.kasbank_trx);
    updateWhere_('T_SetorPajak', 'id', s.id, { status: 'batal', alasan_batal: asText_(alasan) });
    audit_(ctx, 'BATAL_SETOR_PAJAK', 'T_SetorPajak', s.jenis + ' ' + s.masa, null, null, alasan);
    return { pembalik: rev ? rev.no : '' };
  });
}

function actionTaxHistory_(p) {
  const y = String(p.tahun || todayYmd_().slice(0, 4));
  const heads = {};
  journalHeads_().forEach(function (h) { heads[h.id] = h; });
  const kbs = {};
  kasbankRows_().forEach(function (k) { kbs[k.id] = k.nama; });
  return setorRows_().filter(function (s) { return s.masa.slice(0, 4) === y || s.tgl.slice(0, 4) === y; }).map(function (s) {
    return { id: s.id, jenis: s.jenis, nama: (PAJAK_JENIS[s.jenis] || {}).nama || s.jenis, masa: s.masa, tgl: s.tgl, jumlah: s.jumlah, kompensasi: s.kompensasi, ntpn: s.ntpn,
      rekening: kbs[s.kasbank_id] || '', status: s.status, alasan_batal: s.alasan_batal || '', jurnal_id: s.jurnal_id, no: (heads[s.jurnal_id] || {}).no || '' };
  }).sort(function (a, b) { return a.tgl < b.tgl ? 1 : -1; });
}

/** p: { pkp: bool, final_umkm: bool, pph25: number, bentuk } */
function actionTaxSettings_(p, ctx) {
  return withLock_(function () {
    if (p.pkp !== undefined) setSetting_('pajak_pkp', p.pkp ? 'ya' : 'tidak');
    if (p.final_umkm !== undefined) setSetting_('pajak_final_umkm', p.final_umkm ? 'ya' : 'tidak');
    if (p.pph25 !== undefined) {
      const v = Number(p.pph25);
      if (!isFinite(v) || v < 0) throw new ApiError_('VALIDATION', 'Angsuran PPh 25 harus angka ≥ 0.');
      setSetting_('pajak_pph25', Math.round(v));
    }
    if (p.bentuk !== undefined) setSetting_('pajak_bentuk', p.bentuk === 'orang_pribadi' ? 'orang_pribadi' : 'badan');
    const st = taxSettings_();
    audit_(ctx, 'UBAH_SETTING', 'SYS_Setting', 'pajak', null, st, '');
    return st;
  });
}

/** Peringatan dashboard: jatuh tempo pajak ≤ 7 hari atau sudah lewat. */
function taxWarnings_(today) {
  const st = taxSettings_();
  const out = [];
  taxCalendar_(st, today).forEach(function (c) {
    if (c.jenis === 'tahunan' || c.status !== 'belum' && c.status !== 'terlambat') return;
    if (c.nama.indexOf('Setor') !== 0) return;
    if (c.tgl < today) out.push({ level: 'err', text: c.nama + ' masa ' + masaIndo_(c.masa) + ' lewat jatuh tempo (' + tglIndo_(c.tgl) + ').' });
    else if (c.tgl <= addDays_(today, 7)) out.push({ level: 'warn', text: c.nama + ' masa ' + masaIndo_(c.masa) + ' jatuh tempo ' + tglIndo_(c.tgl) + ' (Rp ' + formatRp_(cents_(c.jumlah)) + ').' });
  });
  return out;
}

function masaIndo_(ym) { return BULAN_ID_[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4); }
