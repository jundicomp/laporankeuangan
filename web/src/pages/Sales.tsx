import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError, batch, call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { AccountPicker, useAccounts } from '../components/AccountPicker'
import { InvoiceDoc, usePrintDoc, type Invoice, type Payment } from '../components/InvoiceDoc'
import { Banner, Modal, PageHead, Req, Spinner, fmtTime } from '../components/ui'
import { downloadXlsx } from '../lib/excel'
import { addDays, parseNum, rp, tglID, today } from '../lib/format'

type Customer = { id: string; kode: string; nama: string; batas_kredit: number; top_hari: number; aktif: boolean }
type Product = { id: string; sku: string; nama: string; tipe: string; satuan: string; harga_jual: number; akun_penjualan: string; aktif: boolean }
type KB = { id: string; nama: string; jenis: string; akun_id: string; aktif: boolean; saldo: number }
type ListRow = Omit<Invoice, 'lines'>
type Summary = { n: number; total: number; sisa: number; terlambat: number }

export const BAYAR_PILL: Record<string, [string, string]> = {
  draft: ['o', 'Draft'], batal: ['r', 'Dibatalkan'], lunas: ['g', 'Lunas'], sebagian: ['b', 'Dibayar sebagian'], belum: ['n', 'Belum dibayar'],
}
export function StatusPill({ r }: { r: Pick<Invoice, 'bayar' | 'terlambat'> }) {
  const [c, l] = BAYAR_PILL[r.bayar] ?? ['n', r.bayar]
  return (
    <span className="pills">
      <span className={`pill ${c}`}>{l}</span>
      {r.terlambat > 0 && <span className="pill r">Telat {r.terlambat} hari</span>}
    </span>
  )
}

const STATUS_TABS = [
  ['', 'Semua'], ['terbuka', 'Belum lunas'], ['terlambat', 'Lewat jatuh tempo'], ['lunas', 'Lunas'], ['draft', 'Draft'], ['batal', 'Dibatalkan'],
]

export function SalesPage() {
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
  const [form, setForm] = useState<{ draft?: Invoice } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    // tautan dari dashboard/piutang: ?baru=1 membuka form, ?buka=ID membuka invoice
    if (sp.get('baru') && can('penjualan.edit')) setForm({})
    if (sp.get('buka')) setOpenId(sp.get('buka'))
    if (sp.get('baru') || sp.get('buka') || sp.get('status')) setSp({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const d = await call<{ total: number; rows: ListRow[]; summary: Summary }>('sales.list', { ...filter, limit: 50, offset })
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
    const all = await call<{ rows: ListRow[] }>('sales.list', { ...filter, limit: 200, offset: 0 })
    downloadXlsx(`Penjualan-${today()}.xlsx`, [{
      name: 'Invoice', title: [boot?.company.nama ?? '', 'Daftar invoice penjualan', `Dicetak ${tglID(today())}`],
      columns: [
        { header: 'Tanggal', key: 'tgl', width: 12 }, { header: 'Nomor', key: 'no', width: 22 }, { header: 'Pelanggan', key: 'pihak_nama', width: 30 },
        { header: 'Jatuh tempo', key: 'jatuh_tempo', width: 12 }, { header: 'Total', key: 'total', money: true, width: 16 },
        { header: 'Sisa', key: 'sisa', money: true, width: 16 }, { header: 'Status', key: 'st', width: 18 },
      ],
      rows: all.rows.map((r) => ({ ...r, st: BAYAR_PILL[r.bayar]?.[1] + (r.terlambat ? ` (telat ${r.terlambat} hari)` : '') })),
    }])
  }

  return (
    <>
      <PageHead title="Penjualan" sub="Invoice ke pelanggan. Posting invoice otomatis mencatat piutang, pendapatan, dan PPN keluaran.">
        <button className="btn" onClick={exportXlsx}>⤓ Excel</button>
        {can('penjualan.edit') && <button className="btn primary" onClick={() => { setFlash(''); setForm({}) }}>+ Invoice baru</button>}
      </PageHead>
      {flash && <Banner kind="ok">{flash}</Banner>}
      <Banner kind="err">{err}</Banner>

      {sum && (
        <div className="kpis">
          <div className="card kpi"><span>Invoice aktif</span><b>{sum.n}</b></div>
          <div className="card kpi"><span>Nilai penjualan</span><b>Rp {rp(sum.total)}</b></div>
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
        <input className="grow" placeholder="Cari nomor, pelanggan, referensi…" value={filter.q} onChange={(e) => { setOffset(0); setFilter({ ...filter, q: e.target.value }) }} />
      </div>

      <div className="card flush">
        {loading ? <div className="pad"><Spinner /></div> : (
          <table className="tbl">
            <thead><tr><th>Tanggal</th><th>Nomor</th><th>Pelanggan</th><th>Jatuh tempo</th><th className="r">Total</th><th className="r">Sisa</th><th>Status</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="hint">ⓘ Belum ada invoice pada filter ini.{can('penjualan.edit') && ' Klik "+ Invoice baru" untuk membuat.'}</td></tr>}
              {rows.map((r) => (
                <tr key={r.id} className={`click ${r.status === 'batal' ? 'off' : ''}`} onClick={() => setOpenId(r.id)}>
                  <td className="nowrap">{tglID(r.tgl)}</td>
                  <td className="nowrap mono">{r.no || <span className="warn-text">draft</span>}{r.saldo_awal && <span className="pill n">saldo awal</span>}</td>
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

      {form && <InvoiceForm draft={form.draft} onClose={() => setForm(null)} onSaved={done} />}
      {openId && !form && <InvoiceDetail id={openId} onClose={() => setOpenId(null)} onChanged={(t) => { setFlash(t); load() }}
        onEdit={(inv) => { setOpenId(null); setForm({ draft: inv }) }} />}
    </>
  )
}

// ---------------------------------------------------------------- form invoice

type Line = { produk_id: string; deskripsi: string; qty: string; satuan: string; harga: string; diskon: string; akun_id: string }
const blank = (): Line => ({ produk_id: '', deskripsi: '', qty: '1', satuan: '', harga: '', diskon: '', akun_id: '' })
const filled = (l: Line) => !!(l.deskripsi.trim() || l.produk_id || l.harga)
type CustInfo = { batas_kredit: number; top_hari: number; piutang: number; terlambat: number; n_terlambat: number }

function InvoiceForm({ draft, onClose, onSaved }: { draft?: Invoice; onClose: () => void; onSaved: (t: string, id?: string) => void }) {
  const { boot } = useSession()
  const accounts = useAccounts()
  const topDefault = Number(boot?.settings.top_default ?? 0) || 0
  const [custs, setCusts] = useState<Customer[] | null>(null)
  const [prods, setProds] = useState<Product[]>([])
  const [pel, setPel] = useState(draft?.pihak_id ?? '')
  const [info, setInfo] = useState<CustInfo | null>(null)
  const [tgl, setTgl] = useState(draft?.tgl ?? today())
  const [jt, setJt] = useState(draft?.jatuh_tempo ?? '')
  const [jtTouched, setJtTouched] = useState(!!draft)
  const [ref, setRef] = useState(draft?.referensi ?? '')
  const [catatan, setCatatan] = useState(draft?.catatan ?? '')
  const [ppn, setPpn] = useState(!!draft?.ppn_tarif)
  const [tarif, setTarif] = useState(String(draft?.ppn_tarif || boot?.settings.ppn_tarif || 11))
  const [diskonNota, setDiskonNota] = useState(draft?.diskon_nota ? rp(draft.diskon_nota) : '')
  const [lines, setLines] = useState<Line[]>(draft?.lines.length
    ? [...draft.lines.map((l) => ({ produk_id: l.produk_id, deskripsi: l.deskripsi, qty: rp(l.qty), satuan: l.satuan, harga: rp(l.harga), diskon: l.diskon ? rp(l.diskon) : '', akun_id: l.akun_id })), blank()]
    : [blank()])
  const [showAkun, setShowAkun] = useState(false)
  const [overLimit, setOverLimit] = useState('')
  const [lewati, setLewati] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<'' | 'draft' | 'post'>('')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    batch([{ action: 'master.list', payload: { entity: 'pelanggan', aktif: true } }, { action: 'master.list', payload: { entity: 'produk', aktif: true } }])
      .then(([a, b]) => { setCusts(a.ok ? a.data as Customer[] : []); setProds(b.ok ? b.data as Product[] : []); if (!a.ok) setErr(a.error.message) })
      .catch((e) => { setCusts([]); setErr(errorText(e)) })
  }, [])

  const cust = custs?.find((c) => c.id === pel)
  useEffect(() => {
    setInfo(null)
    setOverLimit('')
    setLewati(false)
    if (!pel) return
    call<CustInfo>('ar.customer', { pelanggan_id: pel }).then(setInfo).catch(() => { /* info tambahan saja */ })
  }, [pel])
  // jatuh tempo mengikuti TOP pelanggan sampai diubah manual
  const top = cust ? (Number(cust.top_hari) || topDefault) : topDefault
  useEffect(() => { if (!jtTouched && tgl) setJt(addDays(tgl, top)) }, [tgl, top, jtTouched])

  const defaultAkun = (l: Line) => {
    const p = prods.find((x) => x.id === l.produk_id)
    return l.akun_id || p?.akun_penjualan || (p?.tipe === 'barang' ? '4-1101' : '4-1201')
  }
  const calc = useMemo(() => {
    const rows = lines.map((l) => {
      const qty = parseNum(l.qty)
      const harga = Math.round((parseNum(l.harga) || 0) * 100)
      const gross = isFinite(qty) ? Math.round(qty * harga) : 0
      const disc = Math.round((parseNum(l.diskon) || 0) * 100)
      return { qty, harga, gross, disc, net: gross - disc }
    })
    const subtotal = rows.reduce((s, r, i) => s + (filled(lines[i]) ? r.gross : 0), 0)
    const discLines = rows.reduce((s, r, i) => s + (filled(lines[i]) ? r.disc : 0), 0)
    const dn = Math.round((parseNum(diskonNota) || 0) * 100)
    const dpp = subtotal - discLines - dn
    const t = ppn ? Number(String(tarif).replace(',', '.')) || 0 : 0
    const pajak = t ? Math.round(dpp * t / 100) : 0
    return { rows, subtotal, diskon: discLines + dn, dpp, pajak, tarif: t, total: dpp + pajak }
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
    }
    return ''
  })()
  const blocker = !pel ? 'Pilih pelanggan dulu.'
    : !used.length ? 'Isi minimal satu baris barang/jasa.'
    : lineErr ? lineErr
    : calc.dpp < 0 ? 'Diskon melebihi nilai penjualan.'
    : calc.total <= 0 ? 'Total invoice masih nol.'
    : !jt || jt < tgl ? 'Jatuh tempo tidak boleh sebelum tanggal invoice.'
    : ppn && !(calc.tarif > 0 && calc.tarif <= 100) ? 'Tarif PPN belum benar.'
    : overLimit && !lewati ? 'Centang konfirmasi batas kredit, atau ubah nilainya.'
    : ''
  const dirty = !busy && touched

  const setLine = (i: number, patch: Partial<Line>) => {
    setTouched(true)
    setLines((ls) => {
      const next = ls.map((l, j) => (j === i ? { ...l, ...patch } : l))
      if (i === next.length - 1 && filled(next[i])) next.push(blank())
      return next
    })
  }
  const pickProduct = (i: number, text: string) => {
    const p = prods.find((x) => x.nama === text || `${x.sku} · ${x.nama}` === text)
    if (p) setLine(i, { produk_id: p.id, deskripsi: p.nama, satuan: p.satuan, harga: p.harga_jual ? rp(p.harga_jual) : lines[i].harga })
    else setLine(i, { deskripsi: text, produk_id: lines[i].produk_id && prods.find((x) => x.id === lines[i].produk_id)?.nama === text ? lines[i].produk_id : '' })
  }

  const save = async (post: boolean) => {
    setErr('')
    if (post && blocker) return setErr(blocker)
    if (!post && !pel) return setErr('Pilih pelanggan dulu.')
    setBusy(post ? 'post' : 'draft')
    try {
      const r = await call<{ id: string; no: string; total: number }>('sales.save', {
        id: draft?.id, tgl, pelanggan_id: pel, jatuh_tempo: jt, referensi: ref, catatan, ppn_tarif: ppn ? calc.tarif : 0,
        diskon_nota: parseNum(diskonNota) || 0, post, lewatiBatas: lewati,
        lines: used.map((l) => ({ produk_id: l.produk_id, deskripsi: l.deskripsi, qty: parseNum(l.qty), satuan: l.satuan, harga: parseNum(l.harga) || 0,
          diskon: parseNum(l.diskon) || 0, akun_id: showAkun ? defaultAkun(l) : l.akun_id })),
      })
      onSaved(post ? `Invoice ${r.no} sebesar Rp ${rp(r.total)} diposting — piutang & pendapatan sudah dijurnal.` : 'Draft invoice tersimpan. Belum tercatat sebagai penjualan sampai diposting.', post ? r.id : undefined)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CREDIT_LIMIT') setOverLimit(e.message)
      else setErr(errorText(e))
      setBusy('')
    }
  }

  const overNow = info && info.batas_kredit > 0 && info.piutang + calc.total / 100 > info.batas_kredit
  const accName = (k: string) => accounts.find((a) => a.kode === k)?.nama ?? k

  return (
    <Modal size="xl" title={draft ? 'Lanjutkan draft invoice' : 'Invoice baru'} sub="Nomor invoice dibuat otomatis saat diposting." onClose={onClose} dirty={dirty}
      footer={<>
        {blocker ? <span className="warn-text">⚠ {blocker}</span> : <span className="ok-text">✓ Total Rp {rp(calc.total / 100)}</span>}
        <button className="btn" onClick={onClose}>Batal</button>
        <button className="btn" onClick={() => save(false)} disabled={!!busy}>{busy === 'draft' ? 'Menyimpan…' : 'Simpan draft'}</button>
        <button className={`btn primary ${blocker ? 'soft' : ''}`} onClick={() => save(true)} disabled={!!busy}>{busy === 'post' ? 'Memposting…' : 'Posting invoice'}</button>
      </>}>
      {!custs ? <Spinner /> : (
        <>
          <div className="form-grid">
            <label className="field span2"><span>Pelanggan<Req /></span>
              <select value={pel} onChange={(e) => { setTouched(true); setPel(e.target.value) }}>
                <option value="">— pilih pelanggan —</option>
                {custs.map((c) => <option key={c.id} value={c.id}>{c.nama} ({c.kode})</option>)}
              </select>
              {custs.length === 0 && <small className="hint">ⓘ Belum ada pelanggan. Tambahkan dulu di <Link to="/master?tab=pelanggan">Master Data → Pelanggan</Link>.</small>}
            </label>
            <label className="field"><span>Tanggal invoice<Req /></span><input type="date" value={tgl} onChange={(e) => { setTouched(true); setTgl(e.target.value) }} /></label>
            <label className="field"><span>Jatuh tempo<Req /></span><input type="date" value={jt} onChange={(e) => { setTouched(true); setJtTouched(true); setJt(e.target.value) }} />
              <small className="hint">ⓘ {jtTouched ? 'Diatur manual.' : `Otomatis ${top} hari${cust && Number(cust.top_hari) ? ' (TOP pelanggan)' : ''}.`}</small>
            </label>
            <label className="field"><span>Referensi</span><input value={ref} onChange={(e) => { setTouched(true); setRef(e.target.value) }} placeholder="no. PO / SPK pelanggan" /></label>
          </div>
          {info && (info.n_terlambat > 0 || overNow) && (
            <div className="banner warn">
              {info.n_terlambat > 0 && <div>⚠ Pelanggan ini punya {info.n_terlambat} invoice lewat jatuh tempo (Rp {rp(info.terlambat)}).</div>}
              {overNow && <div>⚠ Piutang berjalan Rp {rp(info.piutang)} + invoice ini melewati batas kredit Rp {rp(info.batas_kredit)}.</div>}
            </div>
          )}
          {info && !info.n_terlambat && !overNow && info.piutang > 0 && <p className="hint">ⓘ Piutang berjalan pelanggan ini Rp {rp(info.piutang)}{info.batas_kredit ? ` dari batas kredit Rp ${rp(info.batas_kredit)}` : ''}.</p>}

          <div className="jf-box">
            <table className="tbl jf-lines inv-form">
              <thead><tr>
                <th className="n">#</th><th>Barang / jasa<Req /></th><th className="r w-qty">Qty<Req /></th><th className="w-sat">Satuan</th>
                <th className="r w-money">Harga (Rp)</th><th className="r w-money">Diskon (Rp)</th>
                {showAkun && <th>Akun pendapatan</th>}<th className="r w-money">Jumlah</th><th className="n"></th>
              </tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="n">{i + 1}</td>
                    <td><input list="inv-prod" value={l.deskripsi} onChange={(e) => pickProduct(i, e.target.value)} placeholder={i === 0 ? 'ketik nama produk/jasa atau deskripsi bebas' : ''} /></td>
                    <td className="num"><input inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                    <td><input value={l.satuan} onChange={(e) => setLine(i, { satuan: e.target.value })} /></td>
                    <td className="num"><input inputMode="decimal" value={l.harga} onChange={(e) => setLine(i, { harga: e.target.value })} onBlur={(e) => { const n = parseNum(e.target.value); if (n) setLine(i, { harga: rp(n) }) }} /></td>
                    <td className="num"><input inputMode="decimal" value={l.diskon} onChange={(e) => setLine(i, { diskon: e.target.value })} onBlur={(e) => { const n = parseNum(e.target.value); if (n) setLine(i, { diskon: rp(n) }) }} /></td>
                    {showAkun && <td className="acc">{filled(l) && <AccountPicker value={defaultAkun(l)} onChange={(k) => setLine(i, { akun_id: k })} types={['pendapatan']} />}</td>}
                    <td className="r">{filled(l) ? rp(calc.rows[i].net / 100) : ''}</td>
                    <td className="n">{lines.length > 1 && <button className="x" onClick={() => { setTouched(true); setLines((ls) => ls.filter((_, j) => j !== i)) }}>×</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="inv-prod">{prods.map((p) => <option key={p.id} value={p.nama}>{p.sku} · {p.satuan} · Rp {rp(p.harga_jual)}</option>)}</datalist>
          </div>
          <div className="inv-form-bottom">
            <div className="stack">
              <label className="field"><span>Catatan di invoice</span><input value={catatan} onChange={(e) => { setTouched(true); setCatatan(e.target.value) }} placeholder="mis. Pembayaran DP 50% sudah diterima" /></label>
              <label className="check"><input type="checkbox" checked={showAkun} onChange={(e) => setShowAkun(e.target.checked)} /> Atur akun pendapatan per baris</label>
              {!showAkun && <p className="hint">ⓘ Akun otomatis: produk tipe barang → 4-1101 {accName('4-1101')}, jasa / deskripsi bebas → 4-1201 {accName('4-1201')} (atau akun yang diatur di master produk).</p>}
              {overLimit && (
                <div className="banner warn">
                  <div>⚠ {overLimit}</div>
                  <label className="check"><input type="checkbox" checked={lewati} onChange={(e) => setLewati(e.target.checked)} /> Saya tetap ingin memposting invoice ini (tercatat di audit log)</label>
                </div>
              )}
            </div>
            <table className="tbl kv inv-sum">
              <tbody>
                <tr><td>Subtotal</td><td className="r">{rp(calc.subtotal / 100)}</td></tr>
                <tr><td>Diskon per baris</td><td className="r">{calc.diskon - Math.round((parseNum(diskonNota) || 0) * 100) ? `(${rp((calc.diskon - Math.round((parseNum(diskonNota) || 0) * 100)) / 100)})` : '—'}</td></tr>
                <tr><td>Diskon nota (Rp)</td><td className="num"><input inputMode="decimal" value={diskonNota} onChange={(e) => { setTouched(true); setDiskonNota(e.target.value) }} onBlur={(e) => { const n = parseNum(e.target.value); if (n) setDiskonNota(rp(n)) }} /></td></tr>
                <tr><td>DPP</td><td className="r">{rp(calc.dpp / 100)}</td></tr>
                <tr><td><label className="check"><input type="checkbox" checked={ppn} onChange={(e) => { setTouched(true); setPpn(e.target.checked) }} /> PPN</label></td>
                  <td className="r">{ppn ? <span className="pair-r"><input className="num tarif" value={tarif} onChange={(e) => setTarif(e.target.value)} />% = {rp(calc.pajak / 100)}</span> : '—'}</td></tr>
                <tr className="grand"><td>Total</td><td className="r">Rp {rp(calc.total / 100)}</td></tr>
              </tbody>
            </table>
          </div>
          <Banner kind="err">{err}</Banner>
        </>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------- detail invoice

export function InvoiceDetail({ id, onClose, onChanged, onEdit }: { id: string; onClose: () => void; onChanged: (t: string) => void; onEdit?: (inv: Invoice) => void }) {
  const { can, modOn } = useSession()
  const accounts = useAccounts()
  const [inv, setInv] = useState<Invoice | null>(null)
  const [kbs, setKbs] = useState<KB[]>([])
  const [err, setErr] = useState('')
  const [mode, setMode] = useState<'' | 'void' | 'pay' | 'note'>('')
  const [voidPay, setVoidPay] = useState<Payment | null>(null)
  const [alasan, setAlasan] = useState('')
  const [note, setNote] = useState({ via: 'whatsapp', catatan: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const { print, portal } = usePrintDoc()

  const load = useCallback(async () => {
    setErr('')
    try {
      const calls: { action: string; payload?: Record<string, unknown> }[] = [{ action: 'sales.get', payload: { id } }]
      if (can('kas.view')) calls.push({ action: 'kasbank.list' })
      const [a, b] = await batch(calls)
      if (a.ok) setInv(a.data as Invoice); else setErr(a.error.message)
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
        const r = await call<{ pembalik: string; sisa: number }>('ar.payVoid', { id: voidPay.id, alasan })
        await after(`Pembayaran ${voidPay.no} dibatalkan (pembalik ${r.pembalik}). Sisa tagihan Rp ${rp(r.sisa)}.`)
      } else {
        const r = await call<{ pembalik?: string }>('sales.void', { id, alasan })
        await after(inv?.status === 'draft' ? 'Draft invoice dibuang.' : `Invoice ${inv?.no} dibatalkan${r.pembalik ? `. Jurnal pembalik: ${r.pembalik}` : ''}.`)
      }
    } catch (e) {
      setErr(errorText(e))
    }
    setBusy(false)
  }
  const addNote = async () => {
    setBusy(true)
    setErr('')
    try {
      await call('ar.followup', { dok_id: id, ...note })
      setNote({ via: note.via, catatan: '' })
      setMode('')
      await load()
    } catch (e) {
      setErr(errorText(e))
    }
    setBusy(false)
  }

  if (mode === 'pay' && inv) {
    return <PaymentForm inv={inv} kbs={kbs.filter((k) => k.aktif)} onClose={back} onSaved={after} />
  }

  const confirming = mode === 'void' || !!voidPay
  const title = !inv ? 'Invoice' : confirming ? (voidPay ? `Batalkan pembayaran ${voidPay.no}?` : inv.status === 'draft' ? 'Buang draft invoice?' : `Batalkan invoice ${inv.no}?`)
    : `${inv.no || 'Draft invoice'} · ${inv.pihak_nama}`
  const open = inv?.status === 'posted' && inv.sisa > 0
  const docTitle = inv ? `${inv.no || 'Draft'} ${inv.pihak_nama}` : ''

  return (
    <Modal size={confirming ? 'sm' : 'xl'} title={title} onClose={onClose} dirty={(confirming && !!alasan.trim() && !busy) || (mode === 'note' && !!note.catatan.trim())}
      sub={!confirming && inv ? <StatusPill r={inv} /> : undefined}
      footer={confirming
        ? <><button className="btn" onClick={back}>Kembali</button><button className="btn danger" disabled={busy || !alasan.trim()} onClick={doVoid}>{busy ? 'Memproses…' : voidPay ? 'Batalkan pembayaran' : inv?.status === 'draft' ? 'Buang draft' : 'Batalkan invoice'}</button></>
        : inv && <>
          {inv.jurnal_id && can('jurnal.view') && <Link className="btn" to={`/jurnal?open=${inv.jurnal_id}`}>Lihat jurnal</Link>}
          {inv.status !== 'batal' && can('penjualan.edit') && <button className="btn warn" onClick={() => setMode('void')}>{inv.status === 'draft' ? 'Buang draft' : 'Batalkan'}</button>}
          {inv.status === 'draft' && can('penjualan.edit') && onEdit && <button className="btn" onClick={() => onEdit(inv)}>Ubah & posting</button>}
          <button className="btn" onClick={() => print(<InvoiceDoc inv={inv} />, docTitle)}>⎙ Cetak / PDF</button>
          {open && can('kas.edit') && <button className="btn primary" onClick={() => setMode('pay')}>Terima pembayaran</button>}
          {!(open && can('kas.edit')) && <button className="btn primary" onClick={onClose}>Tutup</button>}
        </>}>
      {portal}
      {msg && !confirming && <Banner kind="ok">{msg}</Banner>}
      {!inv ? (err ? null : <Spinner />) : confirming ? (
        <>
          <label className="field"><span>Alasan<Req /></span><input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="tercatat di audit log" /></label>
          <p className="hint">ⓘ {voidPay ? 'Sistem membuat jurnal pembalik bertanggal sama; saldo rekening dan sisa tagihan kembali seperti sebelum pembayaran.'
            : inv.status === 'draft' ? 'Draft belum punya jurnal, jadi cukup ditandai batal.'
            : 'Invoice tidak dihapus: sistem membuat jurnal pembalik bertanggal sama dan nomornya tetap tercatat sebagai dibatalkan.'}</p>
        </>
      ) : (
        <div className="inv-detail">
          <div className="paper"><InvoiceDoc inv={inv} /></div>
          <div className="inv-side stack">
            {inv.status === 'posted' && (
              <table className="tbl kv">
                <tbody>
                  <tr><td>Total</td><td className="r">Rp {rp(inv.total)}</td></tr>
                  <tr><td>Sisa tagihan</td><td className="r"><b className={inv.terlambat ? 'neg' : ''}>Rp {rp(inv.sisa)}</b></td></tr>
                  <tr><td>Jatuh tempo</td><td className="r">{tglID(inv.jatuh_tempo)}{inv.terlambat > 0 && <div className="err-text">lewat {inv.terlambat} hari</div>}</td></tr>
                </tbody>
              </table>
            )}
            {inv.status === 'posted' && open && !can('kas.edit') && <p className="hint">ⓘ Penerimaan pembayaran dicatat oleh peran yang punya izin Kas & Bank.</p>}
            {inv.saldo_awal && <p className="hint">ⓘ Piutang lama dari saldo awal — nilainya sudah ada di jurnal saldo awal, jadi invoice ini tidak membuat jurnal penjualan.</p>}
            {inv.status === 'batal' && <p className="err-text">Dibatalkan: {inv.alasan_batal}</p>}
            {inv.status === 'draft' && <p className="warn-text">⚠ Masih draft: belum menjadi piutang dan belum masuk laporan sampai diposting.</p>}

            {(inv.pembayaran?.length ?? 0) > 0 && (
              <div>
                <h3>Pembayaran</h3>
                {inv.pembayaran!.map((p) => (
                  <div key={p.id} className={`pay-row ${p.status === 'batal' ? 'off' : ''}`}>
                    <div className="row between"><b>{tglID(p.tgl)}</b><b>Rp {rp(p.jumlah + p.potongan)}</b></div>
                    <div className="row between">
                      <span className="mono small">{p.no}</span>
                      {p.status !== 'batal' && can('kas.edit') && <button className="link" onClick={() => setVoidPay(p)}>batalkan</button>}
                    </div>
                    {p.jumlah > 0 && <div className="small">Diterima Rp {rp(p.jumlah)} di {kbName(p.kasbank_id)}</div>}
                    {p.potongan > 0 && <div className="small">Potongan Rp {rp(p.potongan)} → {accName(p.akun_potongan)}</div>}
                    {p.status === 'batal' && <div className="err-text small">Dibatalkan: {p.alasan_batal}</div>}
                  </div>
                ))}
              </div>
            )}

            {inv.status === 'posted' && modOn('piutang') && (
              <div>
                <div className="row between"><h3>Catatan penagihan</h3>{mode !== 'note' && open && <button className="link" onClick={() => setMode('note')}>+ catat</button>}</div>
                {mode === 'note' && (
                  <div className="stack note-form">
                    <div className="pair">
                      <select value={note.via} onChange={(e) => setNote({ ...note, via: e.target.value })}>
                        <option value="whatsapp">WhatsApp</option><option value="telepon">Telepon</option><option value="email">Email</option><option value="kunjungan">Kunjungan</option>
                      </select>
                      <input value={note.catatan} onChange={(e) => setNote({ ...note, catatan: e.target.value })} placeholder="mis. janji bayar Jumat" />
                    </div>
                    <div className="row end"><button className="btn" onClick={() => setMode('')}>Batal</button><button className="btn primary" disabled={busy || !note.catatan.trim()} onClick={addNote}>Simpan catatan</button></div>
                  </div>
                )}
                {(inv.penagihan?.length ?? 0) === 0 && mode !== 'note' && <p className="hint">ⓘ Belum ada catatan penagihan.</p>}
                {inv.penagihan?.map((n, i) => <div key={i} className="note-row"><b>{tglID(n.tgl)}</b> · {n.via} · {n.catatan} <span className="small">— {n.oleh}</span></div>)}
              </div>
            )}
            <p className="small muted">Dibuat {inv.dibuat_oleh} · {fmtTime(inv.dibuat_pada)}</p>
          </div>
        </div>
      )}
      <Banner kind="err">{err}</Banner>
    </Modal>
  )
}

// ---------------------------------------------------------------- pembayaran

const POTONGAN = [
  ['1-1602', 'PPh 23 dipotong pelanggan (bukti potong)'],
  ['7-2102', 'Biaya administrasi / transfer bank'],
  ['4-1902', 'Potongan / diskon pelunasan'],
  ['6-1601', 'Dihapuskan (kerugian piutang)'],
]
const METODE = [['transfer', 'Transfer bank'], ['tunai', 'Tunai'], ['qris', 'QRIS'], ['kartu', 'Kartu debit/kredit'], ['cek/giro', 'Cek / giro'], ['lainnya', 'Lainnya']]

function PaymentForm({ inv, kbs, onClose, onSaved }: { inv: Invoice; kbs: KB[]; onClose: () => void; onSaved: (t: string) => Promise<void> }) {
  const [tgl, setTgl] = useState(today() < inv.tgl ? inv.tgl : today())
  const [kb, setKb] = useState(kbs.find((k) => k.jenis === 'bank')?.id ?? kbs[0]?.id ?? '')
  const [metode, setMetode] = useState('transfer')
  const [jumlah, setJumlah] = useState(rp(inv.sisa))
  const [pot, setPot] = useState(false)
  const [potongan, setPotongan] = useState('')
  const [akunPot, setAkunPot] = useState('1-1602')
  const [lain, setLain] = useState(false)
  const [ref, setRef] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const j = parseNum(jumlah) || 0
  const p = pot ? parseNum(potongan) || 0 : 0
  const total = Math.round((j + p) * 100) / 100
  const sisaAfter = Math.round((inv.sisa - total) * 100) / 100
  const dpp = inv.subtotal - inv.diskon
  const blocker = !tgl ? 'Isi tanggal pembayaran.'
    : tgl < inv.tgl ? 'Tanggal bayar tidak boleh sebelum tanggal invoice.'
    : j < 0 || p < 0 || isNaN(j) || isNaN(p) ? 'Jumlah tidak valid.'
    : total <= 0 ? 'Isi jumlah yang diterima.'
    : total > inv.sisa + 0.001 ? `Melebihi sisa tagihan Rp ${rp(inv.sisa)}.`
    : j > 0 && !kb ? 'Pilih rekening penerima.'
    : p > 0 && !akunPot ? 'Pilih akun potongan.'
    : ''

  const save = async () => {
    setErr('')
    if (blocker) return setErr(blocker)
    setBusy(true)
    try {
      const r = await call<{ no: string; sisa: number; lunas: boolean }>('ar.pay', {
        dok_id: inv.id, tgl, kasbank_id: kb, metode, jumlah: j, potongan: p, akun_potongan: p ? akunPot : '', referensi: ref,
      })
      await onSaved(`Pembayaran ${r.no} Rp ${rp(total)} tercatat. ${r.lunas ? 'Invoice LUNAS.' : `Sisa tagihan Rp ${rp(r.sisa)}.`}`)
    } catch (e) {
      setErr(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Modal size="md" title={`Terima pembayaran · ${inv.no}`} sub={`${inv.pihak_nama} · sisa tagihan Rp ${rp(inv.sisa)}`} onClose={onClose}
      dirty={!busy && (parseNum(jumlah) !== inv.sisa || pot || !!ref)}
      footer={<>
        {blocker ? <span className="warn-text">⚠ {blocker}</span> : sisaAfter === 0 ? <span className="ok-text">✓ Invoice akan lunas</span> : <span className="hint">ⓘ Sisa setelah ini Rp {rp(sisaAfter)}</span>}
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
          <label className="field"><span>Uang diterima (Rp)<Req /></span>
            <input className="num" inputMode="decimal" value={jumlah} onChange={(e) => setJumlah(e.target.value)} onBlur={(e) => { const n = parseNum(e.target.value); if (!isNaN(n)) setJumlah(rp(n)) }} />
          </label>
          <label className="field"><span>Masuk ke rekening{j > 0 && <Req />}</span>
            <select value={kb} onChange={(e) => setKb(e.target.value)}>{kbs.map((k) => <option key={k.id} value={k.id}>{k.nama}</option>)}</select>
          </label>
        </div>
        <label className="field"><span>Referensi</span><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="no. bukti transfer / bukti potong" /></label>
        <label className="check"><input type="checkbox" checked={pot} onChange={(e) => setPot(e.target.checked)} /> Ada potongan (PPh 23, biaya transfer, diskon pelunasan…)</label>
        {pot && (
          <div className="pot-box stack">
            <div className="grid2">
              <label className="field"><span>Potongan (Rp)<Req /></span>
                <input className="num" inputMode="decimal" value={potongan} onChange={(e) => setPotongan(e.target.value)} onBlur={(e) => { const n = parseNum(e.target.value); if (n) setPotongan(rp(n)) }} />
                {akunPot === '1-1602' && <small className="hint">ⓘ PPh 23 jasa 2% × DPP = <button className="link" onClick={() => { const v = Math.round(dpp * 0.02); setPotongan(rp(v)); setJumlah(rp(Math.max(0, inv.sisa - v))) }}>Rp {rp(Math.round(dpp * 0.02))}</button></small>}
              </label>
              <label className="field"><span>Dicatat ke<Req /></span>
                {lain ? <AccountPicker value={akunPot} onChange={setAkunPot} />
                  : <select value={akunPot} onChange={(e) => { if (e.target.value === '*') { setLain(true); setAkunPot('') } else setAkunPot(e.target.value) }}>
                    {POTONGAN.map(([k, l]) => <option key={k} value={k}>{l}</option>)}<option value="*">Akun lain…</option>
                  </select>}
              </label>
            </div>
            <p className="hint">ⓘ Total pelunasan = uang diterima + potongan = Rp {rp(total)}. Simpan bukti potong PPh 23 untuk dikreditkan di SPT.</p>
          </div>
        )}
        <Banner kind="err">{err}</Banner>
      </div>
    </Modal>
  )
}
