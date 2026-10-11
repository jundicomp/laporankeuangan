/**
 * Report — Laporan Laba Rugi dan Laporan Posisi Keuangan (format SAK EP).
 * Angka dihitung langsung dari jurnal (posted + batal bernomor yang dinetralkan pembaliknya).
 * Setiap laporan bisa membandingkan beberapa kolom periode sekaligus.
 */

function netByAccount_(from, to) {
  const eff = effectiveIds_();
  const m = {};
  journalLines_().forEach(function (d) {
    if (!eff.ids[d.jurnal_id]) return;
    const t = eff.heads[d.jurnal_id].tgl;
    if (t < from || t > to) return;
    m[d.akun_id] = (m[d.akun_id] || 0) + cents_(d.debit) - cents_(d.kredit);
  });
  return m;
}

function fiscalStart_(ymd) {
  const startMonth = Number(getSetting_('awal_tahun_buku') || (readTable_('M_Perusahaan')[0] || {}).awal_tahun_buku || 1) || 1;
  var y = Number(ymd.slice(0, 4));
  if (Number(ymd.slice(5, 7)) < startMonth) y--;
  return y + '-' + ('0' + startMonth).slice(-2) + '-01';
}

function dayBefore_(ymd) {
  const d = new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Kelompok tingkat-2 (anak langsung header akar) untuk tiap akun, mis. 1-1 Aset lancar. */
function groupOf_(acc, map) {
  var cur = acc;
  var guard = 0;
  while (cur.parent && map[cur.parent] && map[cur.parent].parent && guard < 10) { cur = map[cur.parent]; guard++; }
  return cur !== acc && bool_(cur.is_header) ? cur : null;
}

const INCOME_SECTIONS = [
  { key: 'pendapatan', title: 'Pendapatan', tipe: 'pendapatan', sign: -1 },
  { key: 'hpp', title: 'Beban pokok penjualan', tipe: 'hpp', sign: 1 },
  { key: 'beban', title: 'Beban usaha', tipe: 'beban', sign: 1 },
  { key: 'lain', title: 'Pendapatan (beban) lain-lain', tipe: 'lain', sign: -1 },
  { key: 'pajak', title: 'Beban pajak penghasilan', tipe: 'pajak', sign: 1 },
];

function incomeColumns_(ranges, includeZero) {
  const accs = readTable_('M_Akun').map(function (a) { a.kode = String(a.kode); return a; })
    .filter(function (a) { return !bool_(a.is_header); })
    .sort(function (a, b) { return a.kode.localeCompare(b.kode, undefined, { numeric: true }); });
  const nets = ranges.map(function (r) { return netByAccount_(r.from, r.to); });
  const sections = {};
  INCOME_SECTIONS.forEach(function (s) {
    const rows = accs.filter(function (a) { return a.tipe === s.tipe; }).map(function (a) {
      return { kode: a.kode, nama: a.nama, amounts: nets.map(function (n) { return money_((n[a.kode] || 0) * s.sign); }) };
    }).filter(function (r) { return includeZero || r.amounts.some(function (x) { return x !== 0; }); });
    const totals = nets.map(function (n) {
      return money_(accs.filter(function (a) { return a.tipe === s.tipe; }).reduce(function (t, a) { return t + (n[a.kode] || 0) * s.sign; }, 0));
    });
    sections[s.key] = { title: s.title, rows: rows, total: totals };
  });
  const col = function (i, k) { return cents_(sections[k].total[i]); };
  const sum = function (fn) { return ranges.map(function (_, i) { return money_(fn(i)); }); };
  return {
    sections: sections,
    labaBruto: sum(function (i) { return col(i, 'pendapatan') - col(i, 'hpp'); }),
    labaUsaha: sum(function (i) { return col(i, 'pendapatan') - col(i, 'hpp') - col(i, 'beban'); }),
    labaSebelumPajak: sum(function (i) { return col(i, 'pendapatan') - col(i, 'hpp') - col(i, 'beban') + col(i, 'lain'); }),
    labaBersih: sum(function (i) { return col(i, 'pendapatan') - col(i, 'hpp') - col(i, 'beban') + col(i, 'lain') - col(i, 'pajak'); }),
  };
}

function actionReportIncome_(p) {
  const ranges = (p.ranges || []).map(function (r) { return { from: ymd_(r.from), to: ymd_(r.to), label: r.label || '' }; });
  if (!ranges.length || ranges.length > 4) throw new ApiError_('VALIDATION', 'Pilih 1–4 kolom periode.');
  ranges.forEach(function (r) { if (r.from > r.to) throw new ApiError_('VALIDATION', 'Tanggal awal setelah tanggal akhir.'); });
  const out = incomeColumns_(ranges, !!p.includeZero);
  out.ranges = ranges;
  out.kerangka = getSetting_('kerangka_sak') || 'SAK EP';
  return out;
}

function actionReportBalance_(p) {
  const dates = (p.dates || []).map(ymd_);
  if (!dates.length || dates.length > 4) throw new ApiError_('VALIDATION', 'Pilih 1–4 tanggal.');
  const map = {};
  readTable_('M_Akun').forEach(function (a) { a.kode = String(a.kode); a.parent = String(a.parent || ''); map[a.kode] = a; });
  const leaves = Object.keys(map).map(function (k) { return map[k]; }).filter(function (a) { return !bool_(a.is_header); })
    .sort(function (a, b) { return a.kode.localeCompare(b.kode, undefined, { numeric: true }); });
  const nets = dates.map(function (d) { return netByAccount_('0000-00-00', d); });

  // laba berjalan & laba tahun-tahun lalu yang belum ditutup ke saldo laba
  const earnings = dates.map(function (d) {
    const fs = fiscalStart_(d);
    const cur = incomeColumns_([{ from: fs, to: d }], false).labaBersih[0];
    const prior = incomeColumns_([{ from: '0000-00-00', to: dayBefore_(fs) }], false).labaBersih[0];
    return { current: cur, prior: prior };
  });

  const build = function (tipe, sign) {
    const groups = {};
    const order = [];
    leaves.filter(function (a) { return a.tipe === tipe; }).forEach(function (a) {
      const g = groupOf_(a, map);
      const key = g ? g.kode : '_';
      if (!groups[key]) { groups[key] = { kode: key, title: g ? g.nama : '', rows: [] }; order.push(key); }
      const amounts = nets.map(function (n) { return money_((n[a.kode] || 0) * sign); });
      if (p.includeZero || amounts.some(function (x) { return x !== 0; })) groups[key].rows.push({ kode: a.kode, nama: a.nama, amounts: amounts });
    });
    const list = order.map(function (k) {
      const g = groups[k];
      g.total = dates.map(function (_, i) { return money_(g.rows.reduce(function (t, r) { return t + cents_(r.amounts[i]); }, 0)); });
      return g;
    }).filter(function (g) { return g.rows.length; });
    const total = dates.map(function (_, i) { return money_(list.reduce(function (t, g) { return t + cents_(g.total[i]); }, 0)); });
    return { groups: list, total: total };
  };

  const aset = build('aset', 1);
  const liab = build('liabilitas', -1);
  const ekuitas = build('ekuitas', -1);
  // tambahkan baris laba ke ekuitas
  const extra = [];
  if (earnings.some(function (e) { return e.prior !== 0; })) extra.push({ kode: '', nama: 'Laba tahun-tahun lalu (belum ditutup)', amounts: earnings.map(function (e) { return e.prior; }), computed: true });
  extra.push({ kode: '', nama: 'Laba tahun berjalan', amounts: earnings.map(function (e) { return e.current; }), computed: true });
  if (!ekuitas.groups.length) ekuitas.groups.push({ kode: '_', title: '', rows: [], total: dates.map(function () { return 0; }) });
  const eg = ekuitas.groups[ekuitas.groups.length - 1];
  eg.rows = eg.rows.concat(extra);
  eg.total = dates.map(function (_, i) { return money_(eg.rows.reduce(function (t, r) { return t + cents_(r.amounts[i]); }, 0)); });
  ekuitas.total = dates.map(function (_, i) { return money_(ekuitas.groups.reduce(function (t, g) { return t + cents_(g.total[i]); }, 0)); });

  const totalPasiva = dates.map(function (_, i) { return money_(cents_(liab.total[i]) + cents_(ekuitas.total[i])); });
  return {
    dates: dates, aset: aset, liabilitas: liab, ekuitas: ekuitas, totalPasiva: totalPasiva,
    seimbang: dates.map(function (_, i) { return cents_(aset.total[i]) === cents_(totalPasiva[i]); }),
    kerangka: getSetting_('kerangka_sak') || 'SAK EP',
  };
}
