import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { Banner, Modal, PageHead, Req, Spinner } from '../components/ui'
import { downloadXlsx, readXlsx } from '../lib/excel'
import { parseNum, rp } from '../lib/format'

type FieldDef = { key: string; label: string; required?: boolean; kind?: 'text' | 'num' | 'email' | 'select'; options?: string[]; hint?: string; wide?: boolean; list?: boolean; money?: boolean }
type Entity = 'pelanggan' | 'supplier' | 'produk'
type Row = Record<string, string | number | boolean>

export const ENTITIES: Record<Entity, { label: string; codeField: string; fields: FieldDef[] }> = {
  pelanggan: {
    label: 'Pelanggan', codeField: 'kode',
    fields: [
      { key: 'kode', label: 'Kode', hint: 'kosongkan → dibuat otomatis (C-0001)', list: true },
      { key: 'nama', label: 'Nama', required: true, wide: true, list: true },
      { key: 'telepon', label: 'Telepon', list: true },
      { key: 'email', label: 'Email', kind: 'email' },
      { key: 'npwp', label: 'NPWP' },
      { key: 'alamat', label: 'Alamat', wide: true },
      { key: 'batas_kredit', label: 'Batas kredit (Rp)', kind: 'num', money: true, list: true, hint: '0 = tanpa batas' },
      { key: 'top_hari', label: 'Termin bayar (hari)', kind: 'num', list: true },
    ],
  },
  supplier: {
    label: 'Supplier', codeField: 'kode',
    fields: [
      { key: 'kode', label: 'Kode', hint: 'kosongkan → dibuat otomatis (S-0001)', list: true },
      { key: 'nama', label: 'Nama', required: true, wide: true, list: true },
      { key: 'telepon', label: 'Telepon', list: true },
      { key: 'email', label: 'Email', kind: 'email' },
      { key: 'npwp', label: 'NPWP' },
      { key: 'alamat', label: 'Alamat', wide: true },
      { key: 'top_hari', label: 'Termin bayar (hari)', kind: 'num', list: true },
    ],
  },
  produk: {
    label: 'Produk & jasa', codeField: 'sku',
    fields: [
      { key: 'sku', label: 'Kode / SKU', hint: 'kosongkan → dibuat otomatis (P-0001)', list: true },
      { key: 'nama', label: 'Nama', required: true, wide: true, list: true },
      { key: 'tipe', label: 'Tipe', required: true, kind: 'select', options: ['barang', 'jasa'], list: true },
      { key: 'satuan', label: 'Satuan', required: true, hint: 'pcs, rim, lembar, jam, paket…', list: true },
      { key: 'harga_jual', label: 'Harga jual (Rp)', kind: 'num', money: true, list: true },
      { key: 'harga_beli', label: 'Harga beli (Rp)', kind: 'num', money: true, list: true },
      { key: 'barcode', label: 'Barcode' },
      { key: 'stok_min', label: 'Stok minimum', kind: 'num' },
      { key: 'stok_max', label: 'Stok maksimum', kind: 'num' },
    ],
  },
}

export function MasterPage() {
  const [sp, setSp] = useSearchParams()
  const entity = (sp.get('tab') as Entity) || 'pelanggan'
  const def = ENTITIES[entity] ?? ENTITIES.pelanggan
  const { can } = useSession()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [q, setQ] = useState('')
  const [showOff, setShowOff] = useState(false)
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const [edit, setEdit] = useState<Row | 'new' | null>(null)
  const [importing, setImporting] = useState(false)

  const load = useCallback(() => {
    setRows(null)
    setErr('')
    call<Row[]>('master.list', { entity }).then(setRows).catch((e) => setErr(errorText(e)))
  }, [entity])
  useEffect(() => { load() }, [load])

  const shown = (rows ?? []).filter((r) => (showOff || r.aktif) && (!q || `${r[def.codeField]} ${r.nama} ${r.telepon ?? ''} ${r.email ?? ''}`.toLowerCase().includes(q.toLowerCase())))
  const cols = def.fields.filter((f) => f.list)
  const editable = can('master.edit')

  return (
    <>
      <PageHead title="Master Data" sub="Data pelanggan, supplier, serta produk & jasa yang dipakai di transaksi.">
        {editable && <button className="btn" onClick={() => { setFlash(''); setImporting(true) }}>⇣ Impor Excel</button>}
        {editable && <button className="btn primary" onClick={() => { setFlash(''); setEdit('new') }}>+ {def.label}</button>}
      </PageHead>
      <div className="tabs">
        {(Object.keys(ENTITIES) as Entity[]).map((k) => (
          <button key={k} className={entity === k ? 'on' : ''} onClick={() => { setFlash(''); setSp({ tab: k }) }}>{ENTITIES[k].label}</button>
        ))}
      </div>
      {flash && <Banner kind="ok">{flash}</Banner>}
      <Banner kind="err">{err}</Banner>
      <div className="filters">
        <input className="grow" placeholder={`Cari ${def.label.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check"><input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} /> Tampilkan yang nonaktif</label>
      </div>
      <div className="card flush">
        {!rows ? <div className="pad"><Spinner /></div> : (
          <table className="tbl">
            <thead><tr>{cols.map((c) => <th key={c.key} className={c.kind === 'num' ? 'r' : ''}>{c.label.replace(' (Rp)', '')}</th>)}<th>Status</th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={cols.length + 1} className="hint">ⓘ Belum ada data. Tambah satu per satu atau impor dari Excel.</td></tr>}
              {shown.map((r) => (
                <tr key={String(r.id)} className={editable ? 'click' : ''} onClick={() => editable && (setFlash(''), setEdit(r))}>
                  {cols.map((c) => (
                    <td key={c.key} className={`${c.kind === 'num' ? 'r' : ''} ${c.key === def.codeField ? 'mono' : ''}`}>
                      {c.money ? rp(Number(r[c.key]), true) : String(r[c.key] ?? '')}
                    </td>
                  ))}
                  <td>{r.aktif ? <span className="pill g">Aktif</span> : <span className="pill n">Nonaktif</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {rows && <p className="hint">ⓘ {shown.length} dari {rows.length} {def.label.toLowerCase()}. Data tidak bisa dihapus — nonaktifkan bila tidak dipakai lagi supaya transaksi lama tetap utuh.</p>}
      {edit && (
        <MasterForm
          key={edit === 'new' ? 'new' : String(edit.id)}
          entity={entity}
          row={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={(t) => { setEdit(null); setFlash(t); load() }}
        />
      )}
      {importing && <ImportMaster entity={entity} onClose={() => setImporting(false)} onDone={(t) => { setImporting(false); setFlash(t); load() }} />}
    </>
  )
}

function MasterForm({ entity, row, onClose, onSaved }: { entity: Entity; row: Row | null; onClose: () => void; onSaved: (t: string) => void }) {
  const def = ENTITIES[entity]
  const start: Record<string, string> = {}
  def.fields.forEach((f) => {
    const v = row?.[f.key]
    start[f.key] = v === undefined || v === null ? (f.key === 'tipe' ? 'barang' : '') : f.money && v ? rp(Number(v)) : String(v)
  })
  const [f, setF] = useState(start)
  const [aktif, setAktif] = useState(row ? !!row.aktif : true)
  const [err, setErr] = useState('')
  const [dup, setDup] = useState(false)
  const [busy, setBusy] = useState(false)
  const dirty = !busy && (JSON.stringify(f) !== JSON.stringify(start) || aktif !== (row ? !!row.aktif : true))

  const save = async (e?: FormEvent, allowDuplicateName = false) => {
    e?.preventDefault()
    setErr('')
    const missing = def.fields.filter((d) => d.required && !f[d.key]?.trim()).map((d) => d.label)
    if (missing.length) return setErr(`Wajib diisi: ${missing.join(', ')}.`)
    const payload: Record<string, unknown> = { entity, id: row?.id, aktif, allowDuplicateName }
    for (const d of def.fields) {
      if (d.kind === 'num') {
        const n = parseNum(f[d.key])
        if (isNaN(n)) return setErr(`${d.label} harus angka.`)
        payload[d.key] = n
      } else payload[d.key] = f[d.key]
    }
    setBusy(true)
    try {
      const r = await call<Row>('master.save', payload)
      onSaved(`${def.label} ${r.nama} (${r[def.codeField]}) ${row ? 'disimpan' : 'ditambahkan'}.`)
    } catch (e2) {
      setErr(errorText(e2))
      setDup(String((e2 as { code?: string }).code) === 'DUPLICATE_NAME')
      setBusy(false)
    }
  }

  return (
    <Modal
      title={row ? `Edit ${def.label.toLowerCase()} · ${row.nama}` : `${def.label} baru`}
      onClose={onClose}
      dirty={dirty}
      footer={<><button className="btn" onClick={onClose}>Batal</button><button type="submit" form="master-form" className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button></>}
    >
      <form id="master-form" className="form-grid" onSubmit={save}>
        {def.fields.map((d) => (
          <label key={d.key} className={`field ${d.wide ? 'span2' : ''}`}>
            <span>{d.label}{d.required && <Req />}</span>
            {d.kind === 'select'
              ? <select value={f[d.key]} onChange={(e) => setF({ ...f, [d.key]: e.target.value })}>{d.options!.map((o) => <option key={o} value={o}>{o}</option>)}</select>
              : <input value={f[d.key]} type={d.kind === 'email' ? 'email' : 'text'} inputMode={d.kind === 'num' ? 'decimal' : undefined}
                  className={d.kind === 'num' ? 'num' : ''} disabled={!!row && d.key === def.codeField}
                  onChange={(e) => setF({ ...f, [d.key]: e.target.value })}
                  onBlur={(e) => { if (d.money) { const n = parseNum(e.target.value); if (n) setF({ ...f, [d.key]: rp(n) }) } }} />}
            {d.hint && !(row && d.key === def.codeField) && <small className="hint">{d.hint}</small>}
          </label>
        ))}
        {row && <label className="check span2"><input type="checkbox" checked={aktif} onChange={(e) => setAktif(e.target.checked)} /> Aktif (nonaktif = disembunyikan dari pilihan transaksi baru)</label>}
      </form>
      <Banner kind="err">{err}</Banner>
      {dup && <div className="row"><span className="warn-text">⚠ Tetap simpan dengan nama yang sama?</span><button className="btn" disabled={busy} onClick={() => save(undefined, true)}>Ya, tetap simpan</button></div>}
    </Modal>
  )
}

type ImportResult = { siap: number; dilewati: number; diimpor: number; errors: { baris: number; pesan: string }[] }

function ImportMaster({ entity, onClose, onDone }: { entity: Entity; onClose: () => void; onDone: (t: string) => void }) {
  const def = ENTITIES[entity]
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [check, setCheck] = useState<ImportResult | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const template = () => downloadXlsx(`template-${entity}.xlsx`, [{
    name: def.label,
    title: [`Template impor ${def.label}`, 'Isi mulai baris di bawah judul kolom. Kolom bertanda * wajib. Hapus baris contoh sebelum impor.'],
    columns: def.fields.map((d) => ({ header: d.label.replace(' (Rp)', '') + (d.required ? ' *' : ''), key: d.key, width: d.wide ? 32 : 18 })),
    rows: [Object.fromEntries(def.fields.map((d) => [d.key, d.key === 'nama' ? `Contoh ${def.label.toLowerCase()}` : d.key === 'tipe' ? 'barang' : d.key === 'satuan' ? 'pcs' : '']))],
  }])

  const headerMap: Record<string, string> = Object.fromEntries(def.fields.map((d) => [d.label.replace(' (Rp)', '').toLowerCase().replace(/\s+/g, '_').replace(/[()]/g, ''), d.key]))

  const pick = async (file: File) => {
    setErr('')
    setCheck(null)
    setFileName(file.name)
    try {
      const raw = await readXlsx(file, Object.keys(headerMap))
      const mapped = raw.map((r) => {
        const o: Record<string, unknown> = { _baris: r._baris }
        Object.entries(r).forEach(([k, v]) => { const key = headerMap[k.replace(/[()]/g, '')]; if (key) o[key] = v })
        return o
      }).filter((o) => !String(o.nama ?? '').startsWith('Contoh '))
      setRows(mapped)
      setBusy(true)
      setCheck(await call<ImportResult>('master.import', { entity, rows: mapped, dryRun: true }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : errorText(e))
    }
    setBusy(false)
  }

  const run = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await call<ImportResult>('master.import', { entity, rows })
      if (r.errors.length) { setCheck(r); setBusy(false); return }
      onDone(`${r.diimpor} ${def.label.toLowerCase()} diimpor${r.dilewati ? `, ${r.dilewati} dilewati karena namanya sudah ada` : ''}.`)
    } catch (e) {
      setErr(errorText(e))
      setBusy(false)
    }
  }

  const realRow = (b: number) => Number(rows?.[b - 2]?._baris ?? b)

  return (
    <Modal title={`Impor ${def.label} dari Excel`} onClose={onClose} dirty={!!rows && !busy}
      footer={<><button className="btn" onClick={onClose}>Batal</button><button className="btn primary" disabled={busy || !check || check.errors.length > 0 || check.siap === 0} onClick={run}>{busy ? 'Memproses…' : `Impor ${check?.siap ?? ''} data`}</button></>}>
      <ol className="steps-list">
        <li>Unduh template, isi di Excel atau Google Sheets (simpan sebagai .xlsx). <button className="link" onClick={template}>⇣ Unduh template</button></li>
        <li>Pilih file yang sudah diisi. Sistem memeriksa dulu sebelum menyimpan.</li>
      </ol>
      <label className="file-drop">
        <input type="file" accept=".xlsx" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pick(f) }} />
        <span>{fileName || 'Klik untuk memilih file .xlsx'}</span>
      </label>
      {busy && <Spinner label="Memeriksa…" />}
      <Banner kind="err">{err}</Banner>
      {check && (
        <div className="stack">
          <div className="row">
            <span className="pill g">{check.siap} siap diimpor</span>
            {check.dilewati > 0 && <span className="pill o">{check.dilewati} dilewati (nama sudah ada)</span>}
            {check.errors.length > 0 && <span className="pill r">{check.errors.length} baris bermasalah</span>}
          </div>
          {check.errors.length > 0 && (
            <div className="card flush">
              <table className="tbl compact">
                <thead><tr><th>Baris Excel</th><th>Masalah</th></tr></thead>
                <tbody>{check.errors.slice(0, 50).map((e) => <tr key={e.baris}><td>{realRow(e.baris)}</td><td className="err-text">{e.pesan}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {check.errors.length > 0 && <p className="warn-text">⚠ Perbaiki baris di atas di file Excel, lalu pilih file lagi. Tidak ada data yang disimpan sebelum semua baris valid.</p>}
        </div>
      )}
    </Modal>
  )
}
