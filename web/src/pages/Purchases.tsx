import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError, batch, call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { AccountPicker, useAccounts } from '../components/AccountPicker'
import type { Payment } from '../components/InvoiceDoc'
import { Banner, Modal, PageHead, Req, Spinner, fmtTime } from '../components/ui'
import { downloadXlsx } from '../lib/excel'
import { addDays, parseNum, rp, tglID, today } from '../lib/format'
import { BAYAR_PILL, METODE, STATUS_TABS, StatusPill } from './Sales'

type Supplier = { id: string; kode: string; nama: string; top_hari: number; aktif: boolean }
type Product = { id: string; sku: string; nama: string; tipe: string; satuan: string; harga_beli: number; lacak_stok: string; aktif: boolean }
type KB = { id: string; nama: string; jenis: string; akun_id: string; aktif: boolean; saldo: number }
type PLine = { produk_id: string; deskripsi: string; qty: number; satuan: string; harga: number; diskon: number; jumlah: number; nilai: number; akun_id: string; stok: boolean }
export type Purchase = {
  id: string; no: string; tgl: string; jatuh_tempo: string; pihak_id: string; pihak_nama: string; status: 'draft' | 'posted' | 'batal'
  bayar: 'draft' | 'batal' | 'lunas' | 'sebagian' | 'belum'; terlambat: number
  subtotal: number; diskon: number; diskon_nota: number; pajak: number; ppn_tarif: number; total: number; sisa: number
  referensi: string; catatan: string; saldo_awal: boolean; jurnal_id: string; alasan_batal: string; dibuat_oleh: string; dibuat_pada: string
  lines: PLine[]; pembayaran?: Payment[]
  supplier?: { id: string; kode: string; nama: string; npwp: string; alamat: string; telepon: string } | null
}
type ListRow = Omit<Purchase, 'lines'>
type Summary = { n: number; total: number; sisa: number; terlambat: number }

export function PurchasesPage() {
  const { can, boot } = useSession()
  const [sp, setSp] = useSearchParams()
  const [rows, setRows] = useState<ListRow[]>([])
  const [total, setTotal] = useState(0)
  const [sum, setSum] = useState<Summary | null>(null)
  const [offset, setOffset] = useState(0)
  const [filter, setFilter] = useState({ status: sp.get('status') ?? '', q: '', from: '', to: '' })
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const [form, setForm] = useState<{ draft?: Purchase } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    if (sp.get('baru') && can('pembelian.edit')) setForm({})
    if (sp.get('buka')) setOpenId(sp.get('buka'))
    if (sp.get('baru') || sp.get('buka') || sp.get('status')) setSp({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const d = await call<{ total: number; rows: ListRow[]; summary: Summary }>('purchase.list', { ...filter, limit: 50, offset })
      setRows(d.rows)
      setTotal(d.total)
      setSum(d.summary)
    } catch (e) {
      setErr(errorText(e))
    }
    setLoading(false)
  }, [filter, offset])
  useEffect(() => { load() }, [load])

  const done = (t: string, id?: string) => { setForm(null); setFlash(t); load(); if (id) setOpenId(id) }

  const exportXlsx = async () => {
    const all = await call<{ rows: ListRow[] }>('purchase.list', { ...filter, limit: 200, offset: 0 })
    downloadXlsx(`Pembelian-${today()}.xlsx`, [{
      name: 'Pembelian', title: [boot?.company.nama ?? '', 'Daftar tagihan pembelian', `Dicetak ${tglID(today())}`],
      columns: [
        { header: 'Tanggal', key: 'tgl', width: 12 }, { header: 'Nomor', key: 'no', width: 20 }, { header: 'No. tagihan supplier', key: 'referensi', width: 20 },
        { header: 'Supplier', key: 'pihak_nama', width: 28 }, { header: 'Jatuh tempo', key: 'jatuh_tempo', width: 12 },
        { header: 'Total', key: 'total', money: true, width: 16 }, { header: 'Sisa', key: 'sisa', money: true, width: 16 }, { header: 'Status', key: 'st', width: 18 },
      ],
      rows: all.rows.map((r) => ({ ...r, st: BAYAR_PILL[r.bayar]?.[1] + (r.terlambat ? ` (telat ${r.terlambat} hari)` : '') })),
    }])
  }

  return (
    <>
      <PageHead title="Pembelian" sub="Tagihan dari supplier. Posting tagihan otomatis mencatat utang, persediaan/biaya, dan PPN masukan.">
        <button className="btn" onClick={exportXlsx}>⤓ Excel</button>
        {can('pembelian.edit') && <button className="btn primary" onClick={() => { setFlash(''); setForm({}) }}>+ Tagihan pembelian</button>}
      </PageHead>
      {flash && <Banner kind="ok">{flash}</Banner>}
      <Banner kind="err">{err}</Banner>

      {sum && (
        <div className="kpis">
          <div className="card kpi"><span>Tagihan aktif</span><b>{sum.n}</b></div>
          <div className="card kpi"><span>Nilai pembelian</span><b>Rp {rp(sum.total)}</b></div>
          <div className="card kpi"><span>Belum dibayar</span><b>Rp {rp(sum.sisa)}</b></div>
          <div className="card kpi"><span>Lewat jatuh tempo</span><b className={sum.terlambat ? 'neg' : ''}>Rp {rp(sum.terlambat)}</b></div>
        </div>
      )}

      <div className="tabs">
        {STATUS_TABS.map(([k, l]) => <button key={k} className={filter.status === k ? 'on' : ''} onClick={() => { setOffset(0); setFilter({ ...filter, status: k }) }}>{l}</button>)}
      </div>
      <div className="filters">
        <input type="date" value={filter.from} onChange={(e) => { setOffset(0); setFilter({ ...filter, from: e.target.value }) }} title="Dari tanggal" />
        <input type="date" value={filter.to} onChange={(e) => { setOffset(0); setFilter({ ...filter, to: e.target.value }) }} title="Sampai tanggal" />
        <input className="grow" placeholder="Cari nomor, supplier, no. tagihan supplier…" value={filter.q} onChange={(e) => { setOffset(0); setFilter({ ...filter, q: e.target.value }) }} />
      </div>

      <div className="card flush">
        {loading ? <div className="pad"><Spinner /></div> : (
          <table className="tbl">
            <thead><tr><th>Tanggal</th><th>Nomor</th><th>Supplier</th><th>Jatuh tempo</th><th className="r">Total</th><th className="r">Sisa</th><th>Status</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="hint">ⓘ Belum ada tagihan pembelian pada filter ini.{can('pembelian.edit') && ' Klik "+ Tagihan pembelian" untuk mencatat.'}</td></tr>}
              {rows.map((r) => (
                <tr key={r.id} className={`click ${r.status === 'batal' ? 'off' : ''}`} onClick={() => setOpenId(r.id)}>
                  <td className="nowrap">{tglID(r.tgl)}</td>
                  <td className="nowrap"><span className="mono">{r.no || <span className="warn-text">draft</span>}</span>{r.saldo_awal && <span className="pill n">saldo awal</span>}
                    {r.referensi && !r.saldo_awal && <div className="small">{r.referensi}</div>}</td>
                  <td>{r.pihak_nama}</td>
                  <td className="nowrap">{r.status === 'posted' ? tglID(r.jatuh_tempo) : ''}</td>
                  <td className="r">{rp(r.total)}</td>
                  <td className="r">{r.status === 'posted' ? rp(r.sisa, true) : ''}</td>
                  <td className="nowrap"><StatusPill r={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="pager">
          <span className="muted small">{total ? `${offset + 1}–${Math.min(offset + 50, total)} dari ${total}` : ''}</span>
          <button className="btn" disabled={offset === 0} onClick={() => setOffset(offset - 50)}>‹</button>
          <button className="btn" disabled={offset + 50 >= total} onClick={() => setOffset(offset + 50)}>›</button>
        </div>
      </div>

      {form && <PurchaseForm draft={form.draft} onClose={() => setForm(null)} onSaved={done} />}
      {openId && !form && <PurchaseDetail id={openId} onClose={() => setOpenId(null)} onChanged={(t) => { setFlash(t); load() }}
        onEdit={(d) => { setOpenId(null); setForm({ draft: d }) }} />}
    </>
  )
}

// ---------------------------------------------------------------- form tagihan

type Line = { produk_id: string; deskripsi: string; qty: string; satuan: string; harga: string; diskon: string; akun_id: string }
const blank = (): Line => ({ produk_id: '', deskripsi: '', qty: '1', satuan: '', harga: '', diskon: '', akun_id: '' })
const filled = (l: Line) => !!(l.deskripsi.trim() || l.produk_id || l.harga)

function PurchaseForm({ draft, onClose, onSaved }: { draft?: Purchase; onClose: () => void; onSaved: (t: string, id?: string) => void }) {
  const { boot, modOn } = useSession()
  const accounts = useAccounts()
  const cashAccs = useMemo(() => (boot?.kasbank ?? []).map((k) => String(k.akun_id)), [boot])
  const [sups, setSups] = useState<Supplier[] | null>(null)
  const [prods, setProds] = useState<Product[]>([])
  const [sup, setSup] = useState(draft?.pihak_id ?? '')
  const [tgl, setTgl] = useState(draft?.tgl ?? today())
  const [jt, setJt] = useState(draft?.jatuh_tempo ?? '')
  const [jtTouched, setJtTouched] = useState(!!draft)
  const [ref, setRef] = useState(draft?.referensi ?? '')
  const [catatan, setCatatan] = useState(draft?.catatan ?? '')
  const [ppn, setPpn] = useState(!!draft?.ppn_tarif)
  const [tarif, setTarif] = useState(String(draft?.ppn_tarif || boot?.settings.ppn_tarif || 11))
  const [diskonNota, setDiskonNota] = useState(draft?.diskon_nota ? rp(draft.diskon_nota) : '')
  const [lines, setLines] = useState<Line[]>(draft?.lines.length
    ? [...draft.lines.map((l) => ({ produk_id: l.produk_id, deskripsi: l.deskripsi, qty: rp(l.qty), satuan: l.satuan, harga: rp(l.harga), diskon: l.diskon ? rp(l.diskon) : '', akun_id: l.stok ? '' : l.akun_id })), blank()]
    : [blank()])
  const [dupRef, setDupRef] = useState('')
  const [lewati, setLewati] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<'' | 'draft' | 'post'>('')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    batch([{ action: 'master.list', payload: { entity: 'supplier', aktif: true } }, { action: 'master.list', payload: { entity: 'produk', aktif: true } }])
      .then(([a, b]) => { setSups(a.ok ? a.data as Supplier[] : []); setProds(b.ok ? b.data as Product[] : []); if (!a.ok) setErr(a.error.message) })
      .catch((e) => { setSups([]); setErr(errorText(e)) })
  }, [])

  const supplier = sups?.find((s) => s.id === sup)
  const top = Number(supplier?.top_hari) || 0
  useEffect(() => { if (!jtTouched && tgl) setJt(addDays(tgl, top)) }, [tgl, top, jtTouched])
  useEffect(() => { setDupRef(''); setLewati(false) }, [ref, sup])

  const stockOn = modOn('persediaan')
  const prodOf = (l: Line) => prods.find((x) => x.id === l.produk_id)
  const tracked = (l: Line) => { const p = prodOf(l); return stockOn && p?.tipe === 'barang' && p?.lacak_stok === 'ya' }
  const akunOf = (l: Line) => (tracked(l) ? '1-1401' : l.akun_id || (prodOf(l)?.tipe === 'barang' ? '5-1101' : '6-1901'))

  const calc = useMemo(() => {
    const rows = lines.map((l) => {
      const qty = parseNum(l.qty)
      const harga = Math.round((parseNum(l.harga) || 0) * 100)
      const gross = isFinite(qty) ? Math.round(qty * harga) : 0
      const disc = Math.round((parseNum(l.diskon) || 0) * 100)
      return { qty, gross, disc, net: gross - disc }
    })
    const subtotal = rows.reduce((s, r, i) => s + (filled(lines[i]) ? r.gross : 0), 0)
    const discLines = rows.reduce((s, r, i) => s + (filled(lines[i]) ? r.disc : 0), 0)
    const dn = Math.round((parseNum(diskonNota) || 0) * 100)
    const dpp = subtotal - discLines - dn
    const t = ppn ? Number(String(tarif).replace(',', '.')) || 0 : 0
    const pajak = t ? Math.round(dpp * t / 100) : 0
    return { rows, subtotal, discLines, diskon: discLines + dn, dpp, pajak, tarif: t, total: dpp + pajak }
  }, [lines, diskonNota, ppn, tarif])

  const used = lines.filter(filled)
  const lineErr = (() => {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (!filled(l)) continue
      const r = calc.rows[i]
      if (!l.deskripsi.trim()) return `Baris ${i + 1}: isi deskripsi barang/jasa.`
      if (!(r.qty > 0)) return `Baris ${i + 1}: kuantitas harus lebih dari nol.`
      if (r.disc > r.gross) return `Baris ${i + 1}: diskon melebihi jumlah baris.`
      if (!tracked(l) && stockOn && akunOf(l) === '1-1401') return `Baris ${i + 1}: untuk menambah persediaan pilih produk yang dilacak stoknya.`
    }
    return ''
  })()
  const blocker = !sup ? 'Pilih supplier dulu.'
    : !used.length ? 'Isi minimal satu baris barang/jasa.'
    : lineErr ? lineErr
    : calc.dpp < 0 ? 'Diskon melebihi nilai pembelian.'
    : calc.total <= 0 ? 'Total tagihan masih nol.'
    : !jt || jt < tgl ? 'Jatuh tempo tidak boleh sebelum tanggal tagihan.'
    : ppn && !(calc.tarif > 0 && calc.tarif <= 100) ? 'Tarif PPN belum benar.'
    : dupRef && !lewati ? 'Centang konfirmasi nomor tagihan ganda, atau ubah nomornya.'
    : ''

  const setLine = (i: number, patch: Partial<Line>) => {
    setTouched(true)
    setLines((ls) => {
      const next = ls.map((l, j) => (j === i ? { ...l, ...patch } : l))
      if (i === next.length - 1 && filled(next[i])) next.push(blank())
      return next
    })
  }
  const pickProduct = (i: number, text: string) => {
    const p = prods.find((x) => x.nama === text)
    if (p) setLine(i, { produk_id: p.id, deskripsi: p.nama, satuan: p.satuan, harga: p.harga_beli ? rp(p.harga_beli) : lines[i].harga })
    else setLine(i, { deskripsi: text, produk_id: '' })
  }

  const save = async (post: boolean) => {
    setErr('')
    if (post && blocker) return setErr(blocker)
    if (!post && !sup) return setErr('Pilih supplier dulu.')
    setBusy(post ? 'post' : 'draft')
    try {
      const r = await call<{ id: string; no: string; total: number }>('purchase.save', {
        id: draft?.id, tgl, supplier_id: sup, jatuh_tempo: jt, referensi: ref, catatan, ppn_tarif: ppn ? calc.tarif : 0,
        diskon_nota: parseNum(diskonNota) || 0, post, lewatiDuplikat: lewati,
        lines: used.map((l) => ({ produk_id: l.produk_id, deskripsi: l.deskripsi, qty: parseNum(l.qty), satuan: l.satuan, harga: parseNum(l.harga) || 0,
          diskon: parseNum(l.diskon) || 0, akun_id: tracked(l) ? '' : akunOf(l) })),
      })
      onSaved(post ? `Tagihan ${r.no} sebesar Rp ${rp(r.total)} diposting — utang${used.some(tracked) ? ', persediaan' : ''} & biaya sudah dijurnal.` : 'Draft tagihan tersimpan. Belum tercatat sebagai utang sampai diposting.', post ? r.id : undefined)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DUPLICATE_REF') setDupRef(e.message)
      else setErr(errorText(e))
      setBusy('')
    }
  }
  const accName = (k: string) => accounts.find((a) => a.kode === k)?.nama ?? k

  return (
    <Modal size="xl" title={draft ? 'Lanjutkan draft tagihan pembelian' : 'Tagihan pembelian baru'} sub="Catat tagihan/nota dari supplier. Nomor internal dibuat otomatis saat diposting." onClose={onClose} dirty={!busy && touched}
      footer={<>
        {blocker ? <span className="warn-text">⚠ {blocker}</span> : <span className="ok-text">✓ Total Rp {rp(calc.total / 100)}</span>}
        <button className="btn" onClick={onClose}>Batal</button>
        <button className="btn" onClick={() => save(false)} disabled={!!busy}>{busy === 'draft' ? 'Menyimpan…' : 'Simpan draft'}</button>
        <button className={`btn primary ${blocker ? 'soft' : ''}`} onClick={() => save(true)} disabled={!!busy}>{busy === 'post' ? 'Memposting…' : 'Posting tagihan'}</button>
      </>}>
      {!sups ? <Spinner /> : (
        <>
          <div className="form-grid">
            <label className="field span2"><span>Supplier<Req /></span>
              <select value={sup} onChange={(e) => { setTouched(true); setSup(e.target.value) }}>
                <option value="">— pilih supplier —</option>
                {sups.map((s) => <option key={s.id} value={s.id}>{s.nama} ({s.kode})</option>)}
              </select>
              {sups.length === 0 && <small className="hint">ⓘ Belum ada supplier. Tambahkan dulu di <Link to="/master?tab=supplier">Master Data → Supplier</Link>.</small>}
            </label>
            <label className="field"><span>Tanggal tagihan<Req /></span><input type="date" value={tgl} onChange={(e) => { setTouched(true); setTgl(e.target.value) }} /></label>
            <label className="field"><span>Jatuh tempo<Req /></span><input type="date" value={jt} onChange={(e) => { setTouched(true); setJtTouched(true); setJt(e.target.value) }} />
              <small className="hint">ⓘ {jtTouched ? 'Diatur manual.' : top ? `Otomatis ${top} hari (termin supplier).` : 'Supplier tanpa termin → jatuh tempo hari itu.'}</small>
            </label>
            <label className="field"><span>No. tagihan / nota supplier</span><input value={ref} onChange={(e) => { setTouched(true); setRef(e.target.value) }} placeholder="nomor di nota supplier" /></label>
          </div>
          {dupRef && (
            <div className="banner warn">
              <div>⚠ {dupRef}</div>
              <label className="check"><input type="checkbox" checked={lewati} onChange={(e) => setLewati(e.target.checked)} /> Ini tagihan berbeda, tetap posting</label>
            </div>
          )}

          <div className="jf-box">
            <table className="tbl jf-lines inv-form">
              <thead><tr>
                <th className="n">#</th><th>Barang / jasa<Req /></th><th className="r w-qty">Qty<Req /></th><th className="w-sat">Satuan</th>
                <th className="r w-money">Harga (Rp)</th><th className="r w-money">Diskon (Rp)</th><th className="w-acc">Dicatat ke</th><th className="r w-money">Jumlah</th><th className="n"></th>
              </tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="n">{i + 1}</td>
                    <td><input list="beli-prod" value={l.deskripsi} onChange={(e) => pickProduct(i, e.target.value)} placeholder={i === 0 ? 'ketik nama produk/bahan atau deskripsi bebas' : ''} /></td>
                    <td className="num"><input inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                    <td><input value={l.satuan} onChange={(e) => setLine(i, { satuan: e.target.value })} /></td>
                    <td className="num"><input inputMode="decimal" value={l.harga} onChange={(e) => setLine(i, { harga: e.target.value })} onBlur={(e) => { const n = parseNum(e.target.value); if (n) setLine(i, { harga: rp(n) }) }} /></td>
                    <td className="num"><input inputMode="decimal" value={l.diskon} onChange={(e) => setLine(i, { diskon: e.target.value })} onBlur={(e) => { const n = parseNum(e.target.value); if (n) setLine(i, { diskon: rp(n) }) }} /></td>
                    <td className="acc">{filled(l) && (tracked(l)
                      ? <span className="pill g" title="Masuk kartu stok">Persediaan · stok +{l.qty}</span>
                      : <AccountPicker value={akunOf(l)} onChange={(k) => setLine(i, { akun_id: k })} exclude={[...cashAccs, '2-1101']} />)}</td>
                    <td className="r">{filled(l) ? rp(calc.rows[i].net / 100) : ''}</td>
                    <td className="n">{lines.length > 1 && <button className="x" onClick={() => { setTouched(true); setLines((ls) => ls.filter((_, j) => j !== i)) }}>×</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="beli-prod">{prods.map((p) => <option key={p.id} value={p.nama}>{p.sku} · {p.satuan}{p.harga_beli ? ` · Rp ${rp(p.harga_beli)}` : ''}{stockOn && p.tipe === 'barang' && p.lacak_stok === 'ya' ? ' · stok' : ''}</option>)}</datalist>
          </div>
          <div className="inv-form-bottom">
            <div className="stack">
              <label className="field"><span>Catatan</span><input value={catatan} onChange={(e) => { setTouched(true); setCatatan(e.target.value) }} placeholder="mis. kertas untuk order PT Sinar Abadi" /></label>
              <p className="hint">ⓘ Barang yang dilacak stoknya otomatis masuk {accName('1-1401')} dan kartu stok. Baris lain dicatat ke akun pilihan — default {accName('5-1101')} untuk barang, {accName('6-1901')} untuk jasa/biaya. Ongkos kirim bisa dicatat ke 5-1201 {accName('5-1201')}.</p>
              {!stockOn && <p className="hint">ⓘ Modul Persediaan belum aktif, jadi semua baris dicatat sebagai biaya/akun pilihan.</p>}
            </div>
            <table className="tbl kv inv-sum">
              <tbody>
                <tr><td>Subtotal</td><td className="r">{rp(calc.subtotal / 100)}</td></tr>
                <tr><td>Diskon per baris</td><td className="r">{calc.discLines ? `(${rp(calc.discLines / 100)})` : '—'}</td></tr>
                <tr><td>Diskon nota (Rp)</td><td className="num"><input inputMode="decimal" value={diskonNota} onChange={(e) => { setTouched(true); setDiskonNota(e.target.value) }} onBlur={(e) => { const n = parseNum(e.target.value); if (n) setDiskonNota(rp(n)) }} /></td></tr>
                <tr><td>DPP</td><td className="r">{rp(calc.dpp / 100)}</td></tr>
                <tr><td><label className="check"><input type="checkbox" checked={ppn} onChange={(e) => { setTouched(true); setPpn(e.target.checked) }} /> PPN masukan</label></td>
                  <td className="r">{ppn ? <span className="pair-r"><input className="num tarif" value={tarif} onChange={(e) => setTarif(e.target.value)} />% = {rp(calc.pajak / 100)}</span> : '—'}</td></tr>
                <tr className="grand"><td>Total utang</td><td className="r">Rp {rp(calc.total / 100)}</td></tr>
              </tbody>
            </table>
          </div>
          <Banner kind="err">{err}</Banner>
        </>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------- detail tagihan

export function PurchaseDetail({ id, onClose, onChanged, onEdit }: { id: string; onClose: () => void; onChanged: (t: string) => void; onEdit?: (d: Purchase) => void }) {
  const { can } = useSession()
  const accounts = useAccounts()
  const [doc, setDoc] = useState<Purchase | null>(null)
  const [kbs, setKbs] = useState<KB[]>([])
  const [err, setErr] = useState('')
  const [mode, setMode] = useState<'' | 'void' | 'pay'>('')
  const [voidPay, setVoidPay] = useState<Payment | null>(null)
  const [alasan, setAlasan] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setErr('')
    try {
      const calls: { action: string; payload?: Record<string, unknown> }[] = [{ action: 'purchase.get', payload: { id } }]
      if (can('kas.view')) calls.push({ action: 'kasbank.list' })
      const [a, b] = await batch(calls)
      if (a.ok) setDoc(a.data as Purchase); else setErr(a.error.message)
      if (b?.ok) setKbs(b.data as KB[])
    } catch (e) {
      setErr(errorText(e))
    }
  }, [id, can])
  useEffect(() => { load() }, [load])

  const kbName = (k: string) => kbs.find((x) => x.id === k)?.nama ?? (k ? 'rekening bank' : '—')
  const accName = (k: string) => accounts.find((a) => a.kode === k)?.nama ?? k
  const back = () => { setMode(''); setVoidPay(null); setAlasan(''); setErr('') }
  const after = async (t: string) => { setMsg(t); back(); onChanged(t); await load() }

  const doVoid = async () => {
    setBusy(true)
    setErr('')
    try {
      if (voidPay) {
        const r = await call<{ pembalik: string; sisa: number }>('ap.payVoid', { id: voidPay.id, alasan })
        await after(`Pembayaran ${voidPay.no} dibatalkan (pembalik ${r.pembalik}). Sisa utang Rp ${rp(r.sisa)}.`)
      } else {
        const r = await call<{ pembalik?: string }>('purchase.void', { id, alasan })
        await after(doc?.status === 'draft' ? 'Draft tagihan dibuang.' : `Tagihan ${doc?.no} dibatalkan${r.pembalik ? `. Jurnal pembalik: ${r.pembalik}` : ''}.`)
      }
    } catch (e) {
      setErr(errorText(e))
    }
    setBusy(false)
  }

  if (mode === 'pay' && doc) return <ApPaymentForm doc={doc} kbs={kbs.filter((k) => k.aktif)} onClose={back} onSaved={after} />

  const confirming = mode === 'void' || !!voidPay
  const title = !doc ? 'Tagihan pembelian' : confirming ? (voidPay ? `Batalkan pembayaran ${voidPay.no}?` : doc.status === 'draft' ? 'Buang draft tagihan?' : `Batalkan tagihan ${doc.no}?`)
    : `${doc.no || 'Draft tagihan'} · ${doc.pihak_nama}`
  const open = doc?.status === 'posted' && doc.sisa > 0
  const paidSum = (doc?.pembayaran ?? []).filter((p) => p.status !== 'batal').reduce((t, p) => t + p.jumlah + p.potongan, 0)

  return (
    <Modal size={confirming ? 'sm' : 'lg'} title={title} onClose={onClose} dirty={confirming && !!alasan.trim() && !busy}
      sub={!confirming && doc ? <StatusPill r={doc} /> : undefined}
      footer={confirming
        ? <><button className="btn" onClick={back}>Kembali</button><button className="btn danger" disabled={busy || !alasan.trim()} onClick={doVoid}>{busy ? 'Memproses…' : voidPay ? 'Batalkan pembayaran' : doc?.status === 'draft' ? 'Buang draft' : 'Batalkan tagihan'}</button></>
        : doc && <>
          {doc.jurnal_id && can('jurnal.view') && <Link className="btn" to={`/jurnal?open=${doc.jurnal_id}`}>Lihat jurnal</Link>}
          {doc.status !== 'batal' && can('pembelian.edit') && <button className="btn warn" onClick={() => setMode('void')}>{doc.status === 'draft' ? 'Buang draft' : 'Batalkan'}</button>}
          {doc.status === 'draft' && can('pembelian.edit') && onEdit && <button className="btn" onClick={() => onEdit(doc)}>Ubah & posting</button>}
          {open && can('kas.edit') ? <button className="btn primary" onClick={() => setMode('pay')}>Bayar tagihan</button> : <button className="btn primary" onClick={onClose}>Tutup</button>}
        </>}>
      {msg && !confirming && <Banner kind="ok">{msg}</Banner>}
      {!doc ? (err ? null : <Spinner />) : confirming ? (
        <>
          <label className="field"><span>Alasan<Req /></span><input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="tercatat di audit log" /></label>
          <p className="hint">ⓘ {voidPay ? 'Sistem membuat jurnal pembalik bertanggal sama; saldo rekening dan sisa utang kembali seperti sebelum pembayaran.'
            : doc.status === 'draft' ? 'Draft belum punya jurnal, jadi cukup ditandai batal.'
            : 'Tagihan tidak dihapus: jurnal pembalik dibuat dan barang yang masuk stok dikeluarkan lagi (ditolak bila barangnya sudah terjual/terpakai).'}</p>
        </>
      ) : (
        <div className="stack">
          <div className="grid2 top">
            <table className="tbl kv">
              <tbody>
                <tr><td>Supplier</td><td><b>{doc.supplier?.nama ?? doc.pihak_nama}</b>{doc.supplier?.telepon && <div className="small">{doc.supplier.telepon}</div>}</td></tr>
                {doc.referensi && <tr><td>No. tagihan supplier</td><td className="mono">{doc.referensi}</td></tr>}
                <tr><td>Tanggal</td><td>{tglID(doc.tgl)}</td></tr>
                <tr><td>Jatuh tempo</td><td>{tglID(doc.jatuh_tempo)}{doc.terlambat > 0 && <span className="err-text"> · lewat {doc.terlambat} hari</span>}</td></tr>
              </tbody>
            </table>
            <table className="tbl kv">
              <tbody>
                <tr><td>Total</td><td className="r">Rp {rp(doc.total)}</td></tr>
                {doc.status === 'posted' && <tr><td>Sudah dibayar</td><td className="r">Rp {rp(paidSum)}</td></tr>}
                {doc.status === 'posted' && <tr><td>Sisa utang</td><td className="r"><b className={doc.terlambat ? 'neg' : ''}>Rp {rp(doc.sisa)}</b></td></tr>}
              </tbody>
            </table>
          </div>
          <table className="tbl compact">
            <thead><tr><th>Barang / jasa</th><th className="r">Qty</th><th className="r">Harga</th><th className="r">Jumlah</th><th>Dicatat ke</th></tr></thead>
            <tbody>
              {doc.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.deskripsi}</td><td className="r nowrap">{rp(l.qty)} {l.satuan}</td><td className="r">{rp(l.harga)}{l.diskon ? <div className="small">diskon {rp(l.diskon)}</div> : null}</td>
                  <td className="r">{rp(l.jumlah)}</td>
                  <td>{doc.saldo_awal ? <span className="small">saldo awal</span> : l.stok ? <span className="pill g">stok +{rp(l.qty)}</span> : <span className="small"><span className="mono">{l.akun_id}</span> {accName(l.akun_id)}</span>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {doc.diskon > 0 && <tr><td colSpan={3}>Diskon</td><td className="r">({rp(doc.diskon)})</td><td /></tr>}
              {doc.pajak > 0 && <tr><td colSpan={3}>PPN masukan {doc.ppn_tarif}%</td><td className="r">{rp(doc.pajak)}</td><td /></tr>}
              <tr><td colSpan={3}>Total</td><td className="r tot">{rp(doc.total)}</td><td /></tr>
            </tfoot>
          </table>
          {doc.catatan && <p><span className="small muted">Catatan:</span> {doc.catatan}</p>}
          {doc.saldo_awal && <p className="hint">ⓘ Utang lama dari saldo awal — nilainya sudah ada di jurnal saldo awal, jadi tagihan ini tidak membuat jurnal pembelian.</p>}
          {doc.status === 'batal' && <p className="err-text">Dibatalkan: {doc.alasan_batal}</p>}
          {doc.status === 'draft' && <p className="warn-text">⚠ Masih draft: belum menjadi utang dan belum masuk laporan sampai diposting.</p>}
          {open && !can('kas.edit') && <p className="hint">ⓘ Pembayaran dicatat oleh peran yang punya izin Kas & Bank.</p>}

          {(doc.pembayaran?.length ?? 0) > 0 && (
            <div>
              <h3>Pembayaran</h3>
              {doc.pembayaran!.map((p) => (
                <div key={p.id} className={`pay-row ${p.status === 'batal' ? 'off' : ''}`}>
                  <div className="row between"><b>{tglID(p.tgl)} · <span className="mono">{p.no}</span></b><b>Rp {rp(p.jumlah + p.potongan)}</b></div>
                  {p.jumlah > 0 && <div className="small">Dibayar Rp {rp(p.jumlah)} dari {kbName(p.kasbank_id)}</div>}
                  {p.potongan > 0 && <div className="small">Potongan Rp {rp(p.potongan)} → {accName(p.akun_potongan)}</div>}
                  {p.status === 'batal' ? <div className="err-text small">Dibatalkan: {p.alasan_batal}</div>
                    : can('kas.edit') && <button className="link" onClick={() => setVoidPay(p)}>batalkan pembayaran</button>}
                </div>
              ))}
            </div>
          )}
          <p className="small muted">Dibuat {doc.dibuat_oleh} · {fmtTime(doc.dibuat_pada)}</p>
        </div>
      )}
      <Banner kind="err">{err}</Banner>
    </Modal>
  )
}

// ---------------------------------------------------------------- pembayaran utang

const POTONGAN = [
  ['2-1203', 'PPh 23 yang kita potong (wajib disetor)'],
  ['7-1101', 'Diskon pembayaran dari supplier'],
]

function ApPaymentForm({ doc, kbs, onClose, onSaved }: { doc: Purchase; kbs: KB[]; onClose: () => void; onSaved: (t: string) => Promise<void> }) {
  const [tgl, setTgl] = useState(today() < doc.tgl ? doc.tgl : today())
  const [kb, setKb] = useState(kbs.find((k) => k.jenis === 'bank')?.id ?? kbs[0]?.id ?? '')
  const [metode, setMetode] = useState('transfer')
  const [jumlah, setJumlah] = useState(rp(doc.sisa))
  const [pot, setPot] = useState(false)
  const [potongan, setPotongan] = useState('')
  const [akunPot, setAkunPot] = useState('2-1203')
  const [lain, setLain] = useState(false)
  const [ref, setRef] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const j = parseNum(jumlah) || 0
  const p = pot ? parseNum(potongan) || 0 : 0
  const total = Math.round((j + p) * 100) / 100
  const sisaAfter = Math.round((doc.sisa - total) * 100) / 100
  const src = kbs.find((k) => k.id === kb)
  const dpp = doc.subtotal - doc.diskon
  const blocker = !tgl ? 'Isi tanggal pembayaran.'
    : tgl < doc.tgl ? 'Tanggal bayar tidak boleh sebelum tanggal tagihan.'
    : j < 0 || p < 0 || isNaN(j) || isNaN(p) ? 'Jumlah tidak valid.'
    : total <= 0 ? 'Isi jumlah yang dibayar.'
    : total > doc.sisa + 0.001 ? `Melebihi sisa utang Rp ${rp(doc.sisa)}.`
    : j > 0 && !kb ? 'Pilih rekening pembayar.'
    : j > 0 && src && src.jenis !== 'bank' && j > src.saldo ? `Saldo ${src.nama} tidak cukup (Rp ${rp(src.saldo)}).`
    : p > 0 && !akunPot ? 'Pilih akun potongan.'
    : ''

  const save = async () => {
    setErr('')
    if (blocker) return setErr(blocker)
    setBusy(true)
    try {
      const r = await call<{ no: string; sisa: number; lunas: boolean }>('ap.pay', { dok_id: doc.id, tgl, kasbank_id: kb, metode, jumlah: j, potongan: p, akun_potongan: p ? akunPot : '', referensi: ref })
      await onSaved(`Pembayaran ${r.no} Rp ${rp(total)} tercatat. ${r.lunas ? 'Tagihan LUNAS.' : `Sisa utang Rp ${rp(r.sisa)}.`}`)
    } catch (e) {
      setErr(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Modal size="md" title={`Bayar tagihan · ${doc.no}`} sub={`${doc.pihak_nama} · sisa utang Rp ${rp(doc.sisa)}`} onClose={onClose}
      dirty={!busy && (parseNum(jumlah) !== doc.sisa || pot || !!ref)}
      footer={<>
        {blocker ? <span className="warn-text">⚠ {blocker}</span> : sisaAfter === 0 ? <span className="ok-text">✓ Tagihan akan lunas</span> : <span className="hint">ⓘ Sisa setelah ini Rp {rp(sisaAfter)}</span>}
        <button className="btn" onClick={onClose}>Batal</button>
        <button className={`btn primary ${blocker ? 'soft' : ''}`} onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan pembayaran'}</button>
      </>}>
      <div className="stack">
        {kbs.length === 0 && <p className="warn-text">⚠ Peran Anda tidak melihat rekening kas/bank mana pun. Hubungi owner.</p>}
        <div className="grid2">
          <label className="field"><span>Tanggal bayar<Req /></span><input type="date" value={tgl} onChange={(e) => setTgl(e.target.value)} /></label>
          <label className="field"><span>Metode</span><select value={metode} onChange={(e) => setMetode(e.target.value)}>{METODE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        </div>
        <div className="grid2">
          <label className="field"><span>Uang dibayarkan (Rp)<Req /></span>
            <input className="num" inputMode="decimal" value={jumlah} onChange={(e) => setJumlah(e.target.value)} onBlur={(e) => { const n = parseNum(e.target.value); if (!isNaN(n)) setJumlah(rp(n)) }} />
          </label>
          <label className="field"><span>Dari rekening{j > 0 && <Req />}</span>
            <select value={kb} onChange={(e) => setKb(e.target.value)}>{kbs.map((k) => <option key={k.id} value={k.id}>{k.nama} — saldo Rp {rp(k.saldo)}</option>)}</select>
          </label>
        </div>
        <label className="field"><span>Referensi</span><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="no. bukti transfer / bukti potong" /></label>
        <label className="check"><input type="checkbox" checked={pot} onChange={(e) => setPot(e.target.checked)} /> Ada potongan (PPh 23 yang kita potong, diskon pembayaran…)</label>
        {pot && (
          <div className="pot-box stack">
            <div className="grid2">
              <label className="field"><span>Potongan (Rp)<Req /></span>
                <input className="num" inputMode="decimal" value={potongan} onChange={(e) => setPotongan(e.target.value)} onBlur={(e) => { const n = parseNum(e.target.value); if (n) setPotongan(rp(n)) }} />
                {akunPot === '2-1203' && <small className="hint">ⓘ PPh 23 jasa 2% × DPP = <button className="link" onClick={() => { const v = Math.round(dpp * 0.02); setPotongan(rp(v)); setJumlah(rp(Math.max(0, doc.sisa - v))) }}>Rp {rp(Math.round(dpp * 0.02))}</button></small>}
              </label>
              <label className="field"><span>Dicatat ke<Req /></span>
                {lain ? <AccountPicker value={akunPot} onChange={setAkunPot} />
                  : <select value={akunPot} onChange={(e) => { if (e.target.value === '*') { setLain(true); setAkunPot('') } else setAkunPot(e.target.value) }}>
                    {POTONGAN.map(([k, l]) => <option key={k} value={k}>{l}</option>)}<option value="*">Akun lain…</option>
                  </select>}
              </label>
            </div>
            <p className="hint">ⓘ Total pelunasan = uang dibayarkan + potongan = Rp {rp(total)}. PPh 23 yang dipotong menjadi utang pajak yang wajib disetor & dilaporkan.</p>
          </div>
        )}
        <Banner kind="err">{err}</Banner>
      </div>
    </Modal>
  )
}
