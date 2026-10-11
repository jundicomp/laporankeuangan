/**
 * Master — pelanggan, supplier, produk/jasa.
 * Tidak ada hapus: data yang tidak dipakai lagi dinonaktifkan.
 */

const MASTER = {
  pelanggan: {
    sheet: 'M_Pelanggan', prefix: 'C', codeField: 'kode', label: 'Pelanggan',
    fields: ['kode', 'nama', 'npwp', 'telepon', 'email', 'alamat', 'batas_kredit', 'top_hari', 'akun_piutang'],
    required: ['nama'], numeric: ['batas_kredit', 'top_hari'], text: ['kode', 'npwp', 'telepon', 'akun_piutang'],
  },
  supplier: {
    sheet: 'M_Supplier', prefix: 'S', codeField: 'kode', label: 'Supplier',
    fields: ['kode', 'nama', 'npwp', 'telepon', 'email', 'alamat', 'top_hari', 'akun_utang'],
    required: ['nama'], numeric: ['top_hari'], text: ['kode', 'npwp', 'telepon', 'akun_utang'],
  },
  produk: {
    sheet: 'M_Produk', prefix: 'P', codeField: 'sku', label: 'Produk/jasa',
    fields: ['sku', 'barcode', 'nama', 'tipe', 'satuan', 'harga_beli', 'harga_jual', 'stok_min', 'stok_max', 'akun_penjualan', 'akun_persediaan', 'akun_hpp'],
    required: ['nama', 'tipe', 'satuan'], numeric: ['harga_beli', 'harga_jual', 'stok_min', 'stok_max'],
    text: ['sku', 'barcode', 'akun_penjualan', 'akun_persediaan', 'akun_hpp'],
  },
};

function masterDef_(entity) {
  const d = MASTER[entity];
  if (!d) throw new ApiError_('VALIDATION', 'Jenis master tidak dikenal: ' + entity);
  return d;
}

function masterRows_(d) {
  return readTable_(d.sheet).map(function (r) {
    d.text.forEach(function (f) { r[f] = r[f] === undefined || r[f] === null ? '' : String(r[f]); });
    r.aktif = r.aktif === '' ? true : bool_(r.aktif);
    return r;
  });
}

function actionMasterList_(p) {
  const d = masterDef_(p.entity);
  var rows = masterRows_(d);
  if (p.aktif === true) rows = rows.filter(function (r) { return r.aktif; });
  if (p.q) {
    const q = String(p.q).toLowerCase();
    rows = rows.filter(function (r) { return (r[d.codeField] + ' ' + r.nama + ' ' + (r.telepon || '') + ' ' + (r.email || '')).toLowerCase().indexOf(q) >= 0; });
  }
  rows.sort(function (a, b) { return String(a.nama).localeCompare(String(b.nama)); });
  return rows;
}

/** Validasi & normalkan satu baris. Mengembalikan objek siap tulis (tanpa id). */
function cleanMaster_(d, p, accs) {
  const o = {};
  d.fields.forEach(function (f) {
    var v = p[f] === undefined || p[f] === null ? '' : String(p[f]).trim();
    if (d.numeric.indexOf(f) >= 0) {
      if (typeof p[f] === 'number') {
        if (!isFinite(p[f]) || p[f] < 0) throw new ApiError_('VALIDATION', f + ' harus angka ≥ 0: ' + p[f]);
        v = p[f];
      } else if (v === '') v = 0;
      else {
        const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
        if (!isFinite(n) || n < 0) throw new ApiError_('VALIDATION', f + ' harus angka ≥ 0: ' + v);
        v = n;
      }
    }
    o[f] = v;
  });
  d.required.forEach(function (f) { if (o[f] === '') throw new ApiError_('VALIDATION', f + ' wajib diisi.'); });
  if (o.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email)) throw new ApiError_('VALIDATION', 'Format email tidak valid: ' + o.email);
  if (d.sheet === 'M_Produk' && ['barang', 'jasa'].indexOf(o.tipe) < 0) throw new ApiError_('VALIDATION', 'Tipe produk harus "barang" atau "jasa".');
  ['akun_piutang', 'akun_utang', 'akun_penjualan', 'akun_persediaan', 'akun_hpp'].forEach(function (f) {
    if (o[f] && (!accs[o[f]] || bool_(accs[o[f]].is_header))) throw new ApiError_('VALIDATION', 'Akun ' + o[f] + ' tidak ada atau berupa header.');
  });
  return o;
}

function nextMasterCode_(d, rows) {
  var max = 0;
  const re = new RegExp('^' + d.prefix + '-(\\d+)$');
  rows.forEach(function (r) { const m = String(r[d.codeField]).match(re); if (m) max = Math.max(max, Number(m[1])); });
  return d.prefix + '-' + ('0000' + (max + 1)).slice(-4);
}

function toSheet_(d, o) {
  const w = {};
  Object.keys(o).forEach(function (k) { w[k] = d.text.indexOf(k) >= 0 || ['nama', 'alamat', 'email', 'satuan'].indexOf(k) >= 0 ? asText_(o[k]) : o[k]; });
  return w;
}

function actionMasterSave_(p, ctx) {
  const d = masterDef_(p.entity);
  return withLock_(function () {
    const rows = masterRows_(d);
    const o = cleanMaster_(d, p, accountsMap_());
    const code = o[d.codeField];
    const dupCode = code && rows.some(function (r) { return String(r[d.codeField]).toLowerCase() === code.toLowerCase() && r.id !== p.id; });
    if (dupCode) throw new ApiError_('VALIDATION', 'Kode ' + code + ' sudah dipakai.');
    const dupName = rows.filter(function (r) { return r.nama.toLowerCase() === o.nama.toLowerCase() && r.id !== p.id; })[0];
    if (dupName && !p.allowDuplicateName) throw new ApiError_('DUPLICATE_NAME', d.label + ' dengan nama "' + o.nama + '" sudah ada (' + dupName[d.codeField] + ').');
    if (p.id) {
      const old = rows.filter(function (r) { return r.id === p.id; })[0];
      if (!old) throw new ApiError_('NOT_FOUND', 'Data tidak ditemukan.');
      if (!o[d.codeField]) o[d.codeField] = old[d.codeField];
      o.aktif = p.aktif !== false;
      const r = updateWhere_(d.sheet, 'id', p.id, toSheet_(d, o));
      audit_(ctx, 'UBAH', d.sheet, o[d.codeField], r.before, r.after, '');
      o.id = p.id;
    } else {
      if (!o[d.codeField]) o[d.codeField] = nextMasterCode_(d, rows);
      o.id = newId_(d.prefix);
      o.aktif = true;
      appendObjects_(d.sheet, [toSheet_(d, o)]);
      audit_(ctx, 'BUAT', d.sheet, o[d.codeField], null, o, '');
    }
    return o;
  });
}

/** Impor banyak baris. dryRun=true hanya memeriksa. Baris bermasalah dilaporkan per nomor baris. */
function actionMasterImport_(p, ctx) {
  const d = masterDef_(p.entity);
  const input = p.rows || [];
  if (!input.length) throw new ApiError_('VALIDATION', 'File tidak berisi data.');
  if (input.length > 2000) throw new ApiError_('VALIDATION', 'Maksimal 2.000 baris per impor.');
  return withLock_(function () {
    const rows = masterRows_(d);
    const accs = accountsMap_();
    const names = {};
    const codes = {};
    rows.forEach(function (r) { names[r.nama.toLowerCase()] = true; codes[String(r[d.codeField]).toLowerCase()] = true; });
    const ok = [];
    const errors = [];
    var skipped = 0;
    input.forEach(function (raw, i) {
      try {
        const o = cleanMaster_(d, raw, accs);
        const key = o.nama.toLowerCase();
        if (names[key]) { skipped++; return; }
        if (o[d.codeField] && codes[o[d.codeField].toLowerCase()]) throw new ApiError_('VALIDATION', 'kode ' + o[d.codeField] + ' sudah dipakai');
        names[key] = true;
        ok.push(o);
        if (o[d.codeField]) codes[o[d.codeField].toLowerCase()] = true;
      } catch (e) {
        errors.push({ baris: i + 2, pesan: e.message });
      }
    });
    if (p.dryRun || errors.length) return { siap: ok.length, dilewati: skipped, errors: errors, diimpor: 0 };
    var all = rows.slice();
    const out = ok.map(function (o) {
      if (!o[d.codeField]) o[d.codeField] = nextMasterCode_(d, all);
      o.id = newId_(d.prefix);
      o.aktif = true;
      all.push(o);
      return toSheet_(d, o);
    });
    appendObjects_(d.sheet, out);
    audit_(ctx, 'IMPOR', d.sheet, out.length + ' baris', null, null, '');
    return { siap: ok.length, dilewati: skipped, errors: [], diimpor: out.length };
  });
}
