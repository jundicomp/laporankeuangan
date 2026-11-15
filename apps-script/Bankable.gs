/**
 * Bankable — paket laporan keuangan untuk pengajuan kredit ke bank.
 *
 * Satu panggilan mengumpulkan semua bahan: laporan keuangan komparatif (posisi keuangan, laba rugi,
 * perubahan ekuitas, arus kas, CALK), analisis rasio, omzet & laba 24 bulan, saldo & mutasi rekening
 * 12 bulan, umur piutang/utang, daftar aset tetap, kepatuhan pajak, dan daftar periksa kesiapan.
 */

function shiftYear_(ymd, n) {
  const y = Number(ymd.slice(0, 4)) + n;
  var d = ymd.slice(5);
  if (d === '02-29') d = '02-28';
  return y + '-' + d;
}

/** Pendapatan & laba bersih per bulan (sen) untuk daftar bulan `months`. */
function monthlyPL_(months) {
  const eff = effectiveIds_();
  const accs = accountsMap_();
  const set = {};
  months.forEach(function (m) { set[m] = { pendapatan: 0, hpp: 0, beban: 0, laba: 0 }; });
  journalLines_().forEach(function (d) {
    if (!eff.ids[d.jurnal_id]) return;
    const h = eff.heads[d.jurnal_id];
    if (h.jenis === 'JT') return;
    const b = set[h.tgl.slice(0, 7)];
    const a = accs[d.akun_id];
    if (!b || !a || !PL_TYPES[a.tipe]) return;
    const c = cents_(d.debit) - cents_(d.kredit);
    b.laba -= c;
    if (a.tipe === 'pendapatan') b.pendapatan -= c;
    if (a.tipe === 'hpp') b.hpp += c;
    if (a.tipe === 'beban') b.beban += c;
  });
  return months.map(function (m) { const b = set[m]; return { bulan: m, pendapatan: money_(b.pendapatan), hpp: money_(b.hpp), beban: money_(b.beban), laba: money_(b.laba) }; });
}

/** Saldo akhir, mutasi masuk & keluar per rekening kas/bank per bulan. */
function cashMonthly_(months, ctx) {
  const kbs = kasbankRows_().filter(function (k) { return canSeeAccount_(ctx.session, k); });
  const byAcc = {};
  kbs.forEach(function (k) { byAcc[k.akun_id] = k; });
  const eff = effectiveIds_();
  const first = months[0] + '-01';
  const res = {};
  kbs.forEach(function (k) { res[k.id] = { awal: 0, m: {} }; months.forEach(function (m) { res[k.id].m[m] = { masuk: 0, keluar: 0 }; }); });
  journalLines_().forEach(function (d) {
    const k = byAcc[d.akun_id];
    if (!k || !eff.ids[d.jurnal_id]) return;
    const h = eff.heads[d.jurnal_id];
    const r = res[k.id];
    if (h.tgl < first) { r.awal += cents_(d.debit) - cents_(d.kredit); return; }
    const mm = r.m[h.tgl.slice(0, 7)];
    if (!mm) return;
    // jurnal yang dibatalkan dan pembaliknya tidak dihitung sebagai mutasi
    if (h.status === 'batal' || (h.jenis === 'JR' && h.jurnal_asal && eff.heads[h.jurnal_asal] && eff.heads[h.jurnal_asal].status === 'batal')) { mm.netral = (mm.netral || 0) + cents_(d.debit) - cents_(d.kredit); return; }
    mm.masuk += cents_(d.debit); mm.keluar += cents_(d.kredit);
  });
  return kbs.map(function (k) {
    var saldo = res[k.id].awal;
    const rows = months.map(function (m) {
      const x = res[k.id].m[m];
      saldo += x.masuk - x.keluar + (x.netral || 0);
      return { bulan: m, masuk: money_(x.masuk), keluar: money_(x.keluar), saldo: money_(saldo) };
    });
    const n = rows.length || 1;
    return { id: k.id, nama: k.nama, jenis: k.jenis, no_rek: k.no_rek, rows: rows,
      rata_saldo: money_(rows.reduce(function (t, r) { return t + cents_(r.saldo); }, 0) / n),
      rata_masuk: money_(rows.reduce(function (t, r) { return t + cents_(r.masuk); }, 0) / n) };
  });
}

/** Daftar periksa sebelum paket diserahkan ke bank. */
function readiness_(from, to, d, ctx) {
  const out = [];
  const add = function (level, text, link) { out.push({ level: level, text: text, link: link || '' }); };
  const comp = readTable_('M_Perusahaan')[0] || {};
  if (!comp.npwp || !comp.alamat) add('warn', 'Lengkapi NPWP dan alamat perusahaan (muncul di sampul & CALK).', '/pengaturan');
  else add('ok', 'Identitas perusahaan lengkap.');
  if (d.balance.seimbang[0]) add('ok', 'Laporan posisi keuangan seimbang.');
  else add('err', 'Laporan posisi keuangan TIDAK seimbang — periksa jurnal.', '/laporan?tab=posisi');
  if (d.cashflow.selisih === 0) add('ok', 'Arus kas cocok dengan saldo kas & bank.');
  else add('err', 'Arus kas selisih Rp ' + formatRp_(cents_(d.cashflow.selisih)) + ' dengan saldo kas.', '/laporan?tab=arus-kas');
  const drafts = journalHeads_().filter(function (h) { return (h.status === 'draft' || h.status === 'menunggu') && h.tgl >= from && h.tgl <= to; }).length;
  if (drafts) add('warn', drafts + ' jurnal masih draft/menunggu persetujuan dalam periode ini.', '/jurnal?status=draft');
  else add('ok', 'Tidak ada jurnal draft dalam periode.');
  // periode yang sudah lewat sebaiknya dikunci
  const open = [];
  for (var m = from.slice(0, 7); m <= to.slice(0, 7); m = ymAdd_(m, 1)) {
    if (monthEnd_(m) <= to && monthEnd_(m) < todayYmd_() && periodStatus_(m) === 'buka') open.push(m);
  }
  if (open.length) add('warn', 'Periode belum dikunci: ' + open.map(masaIndo_).join(', ') + '. Kunci supaya angka yang diserahkan ke bank tidak berubah.', '/tutup-buku');
  else add('ok', 'Semua bulan dalam periode sudah dikunci.');
  const fs = fiscalStart_(to);
  const pfs = shiftYear_(fs, -1);
  const hasPrev = journalHeads_().some(function (h) { return h.status === 'posted' && h.tgl < fs; });
  if (hasPrev && !closingJournal_(pfs)) add('warn', 'Tahun buku ' + pfs.slice(0, 4) + ' belum ditutup (jurnal penutup).', '/tutup-buku');
  if (d.piutang) {
    if (cents_(d.piutang.total) === cents_(d.piutang.gl)) add('ok', 'Daftar piutang cocok dengan buku besar.');
    else add('warn', 'Daftar piutang (Rp ' + formatRp_(cents_(d.piutang.total)) + ') berbeda dengan buku besar (Rp ' + formatRp_(cents_(d.piutang.gl)) + ').', '/piutang');
  }
  if (d.utang) {
    if (cents_(d.utang.total) === cents_(d.utang.gl)) add('ok', 'Daftar utang supplier cocok dengan buku besar.');
    else add('warn', 'Daftar utang (Rp ' + formatRp_(cents_(d.utang.total)) + ') berbeda dengan buku besar (Rp ' + formatRp_(cents_(d.utang.gl)) + ').', '/utang');
  }
  if (moduleActive_('persediaan')) {
    const st = actionStockList_({ per: to });
    if (cents_(st.total) === cents_(st.gl)) add('ok', 'Kartu stok cocok dengan buku besar persediaan.');
    else add('warn', 'Nilai kartu stok berbeda dengan buku besar persediaan.', '/persediaan');
  }
  if (d.aset) {
    const off = d.aset.gl.filter(function (g) { return g.selisih !== 0; });
    if (off.length) add('warn', 'Daftar aset tetap belum sama dengan buku besar (' + off.map(function (g) { return g.akun; }).join(', ') + ').', '/aset');
    else add('ok', 'Daftar aset tetap cocok dengan buku besar.');
    const lastMonth = monthEnd_(to.slice(0, 7)) === to ? to.slice(0, 7) : ymAdd_(to.slice(0, 7), -1);
    const plan = runPlan_('');
    if (plan.lines.length && plan.periode <= lastMonth) add('warn', 'Penyusutan ' + masaIndo_(plan.periode) + ' belum diproses.', '/aset?tab=penyusutan');
  }
  if (moduleActive_('rekonbank')) {
    const recs = reconRows_().filter(function (r) { return r.status === 'final'; });
    const banks = kasbankRows_().filter(function (k) { return k.aktif && k.jenis === 'bank' && canSeeAccount_(ctx.session, k); });
    const need = ymAdd_(to.slice(0, 7), monthEnd_(to.slice(0, 7)) === to ? 0 : -1);
    const late = banks.filter(function (k) { return !recs.some(function (r) { return r.kasbank_id === k.id && r.tgl.slice(0, 7) >= need; }); });
    if (late.length) add('warn', 'Rekonsiliasi bank s/d ' + masaIndo_(need) + ' belum final: ' + late.map(function (k) { return k.nama; }).join(', ') + '.', '/rekonsiliasi');
    else if (banks.length) add('ok', 'Semua rekening bank sudah direkonsiliasi s/d ' + masaIndo_(need) + '.');
  } else add('info', 'Rekonsiliasi bank belum dipakai — bank biasanya mencocokkan laporan dengan rekening koran.', '/pengaturan');
  if (d.pajak) {
    const late = [];
    d.pajak.masa.forEach(function (m) { Object.keys(m.items).forEach(function (j) { if (m.items[j].status === 'terlambat') late.push(m.masa + ' ' + j); }); });
    if (late.length) add('warn', late.length + ' kewajiban setor pajak belum tercatat lewat jatuh tempo.', '/pajak');
    else add('ok', 'Tidak ada setoran pajak yang terlambat.');
  }
  return out;
}

/** p: { to, from?, sections? } */
function actionBankableGet_(p, ctx) {
  const to = ymd_(p.to || todayYmd_());
  const from = p.from ? ymd_(p.from) : fiscalStart_(to);
  if (from > to) throw new ApiError_('VALIDATION', 'Tanggal awal setelah tanggal akhir.');
  const pfrom = shiftYear_(from, -1), pto = shiftYear_(to, -1);
  const comp = readTable_('M_Perusahaan')[0] || {};
  const months24 = [];
  for (var i = 23; i >= 0; i--) months24.push(ymAdd_(to.slice(0, 7), -i));
  const d = {
    from: from, to: to, lalu: { from: pfrom, to: pto },
    perusahaan: { nama: comp.nama, alamat: comp.alamat, npwp: comp.npwp, telepon: comp.telepon, email: comp.email, logo_url: comp.logo_url },
    kerangka: getSetting_('kerangka_sak') || 'SAK EP',
    ttd: { nama: getSetting_('invoice_ttd_nama') || '', jabatan: getSetting_('invoice_ttd_jabatan') || 'Direktur' },
    income: actionReportIncome_({ ranges: [{ from: from, to: to }, { from: pfrom, to: pto }] }),
    balance: actionReportBalance_({ dates: [to, pto] }),
    equity: actionReportEquity_({ from: from, to: to }),
    cashflow: actionReportCashflow_({ from: from, to: to }),
    calk: actionCalkGet_({ tanggal: to }),
    rasio: actionRatioGet_({ from: from, to: to }),
    omzet: monthlyPL_(months24),
    rekening: cashMonthly_(months24.slice(12), ctx),
    piutang: moduleActive_('piutang') && hasPerm_(ctx.session, 'penjualan.view') ? actionArAging_({ per: to }) : null,
    utang: moduleActive_('utang') && hasPerm_(ctx.session, 'pembelian.view') ? actionApAging_({ per: to }) : null,
    aset: moduleActive_('aset') && hasPerm_(ctx.session, 'aset.view') ? actionAssetList_({ per: to }) : null,
    pajak: moduleActive_('pajak') && hasPerm_(ctx.session, 'pajak.view') ? actionTaxSummary_({ tahun: to.slice(0, 4) }) : null,
  };
  // pajak: cukup ringkasan per masa sampai bulan `to`
  if (d.pajak) d.pajak = { jenis: d.pajak.jenis, masa: d.pajak.masa.filter(function (m) { return m.masa <= to.slice(0, 7); }) };
  d.kesiapan = readiness_(from, to, d, ctx);
  return d;
}
