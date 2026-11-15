import { Fragment, useCallback, useEffect, useState } from 'react'
import { call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { Banner, Modal, PageHead, Req, Spinner } from '../components/ui'
import { downloadXlsx } from '../lib/excel'
import { addDays, parseNum, rp, tglID, today } from '../lib/format'
import { PurchaseDetail } from './Purchases'
import { InvoiceDetail } from './Sales'

type AgingInv = { id: string; no: string; referensi: string; tgl: string; jatuh_tempo: string; total: number; sisa: number; bucket: string; hari: number; saldo_awal: boolean }
type AgingCust = { pihak_id: string; nama: string; telepon: string; batas_kredit: number; total: number; b: Record<string, number>; invoices: AgingInv[]; lewat_batas: boolean }
type Aging = { per: string; buckets: { key: string; label: string }[]; customers: AgingCust[]; totals: Record<string, number>; total: number; gl: number; akun: string[] }

type Kind = 'piutang' | 'utang'
const CFG = {
  piutang: {
    action: 'ar.aging', title: 'Piutang', sub: 'Siapa yang belum membayar, berapa, dan sudah berapa lama lewat jatuh tempo.',
    judul: 'Daftar Umur Piutang Usaha', pihak: 'Pelanggan', dok: 'invoice', perm: 'penjualan.edit', akun: 'piutang',
    lama: '+ Piutang lama (saldo awal)', kosong: 'Tidak ada piutang terbuka per tanggal ini.',
    hint: 'Klik nama pelanggan untuk melihat invoicenya, lalu klik invoice untuk menerima pembayaran atau mencatat penagihan. Umur dihitung dari tanggal jatuh tempo.',
  },
  utang: {
    action: 'ap.aging', title: 'Utang', sub: 'Tagihan supplier yang belum dibayar, berapa, dan kapan jatuh temponya.',
    judul: 'Daftar Umur Utang Usaha', pihak: 'Supplier', dok: 'tagihan', perm: 'pembelian.edit', akun: 'utang',
    lama: '+ Utang lama (saldo awal)', kosong: 'Tidak ada utang terbuka per tanggal ini.',
    hint: 'Klik nama supplier untuk melihat tagihannya, lalu klik tagihan untuk mencatat pembayaran. Umur dihitung dari tanggal jatuh tempo.',
  },
}

export function ReceivablesPage() { return <AgingPage kind="piutang" /> }
export function PayablesPage() { return <AgingPage kind="utang" /> }

function AgingPage({ kind }: { kind: Kind }) {
  const cfg = CFG[kind]
  const { boot, can } = useSession()
  const [per, setPer] = useState(today())
  const [d, setD] = useState<Aging | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const [loading, setLoading] = useState(true)
  const [inv, setInv] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try { setD(await call<Aging>(cfg.action, { per })) } catch (e) { setErr(errorText(e)) }
    setLoading(false)
  }, [per, cfg.action])
  useEffect(() => { load() }, [load])

  const diff = d ? Math.round((d.gl - d.total) * 100) / 100 : 0
  const pct = (v: number) => (d && d.total ? Math.round((v / d.total) * 100) : 0)

  const exportXlsx = () => {
    if (!d) return
    const rows: Record<string, unknown>[] = []
    d.customers.forEach((c) => {
      rows.push({ nama: c.nama, total: c.total, ...c.b, bold: true })
      c.invoices.forEach((i) => rows.push({ nama: `   ${i.no}${i.referensi && kind === 'utang' ? ` (${i.referensi})` : ''} · jt ${i.jatuh_tempo}${i.hari ? ` · telat ${i.hari} hari` : ''}`, total: i.sisa, [i.bucket]: i.sisa }))
    })
    rows.push({ nama: 'TOTAL', total: d.total, ...d.totals, bold: true })
    downloadXlsx(`Umur-${cfg.title}-${d.per}.xlsx`, [{
      name: `Umur ${cfg.title}`, title: [boot?.company.nama ?? '', cfg.judul, `Per ${tglID(d.per)}`, 'dalam Rupiah'],
      columns: [{ header: `${cfg.pihak} / ${cfg.dok}`, key: 'nama', width: 44 }, { header: 'Total', key: 'total', money: true, width: 16 },
        ...d.buckets.map((b) => ({ header: b.label, key: b.key, money: true, width: 16 }))],
      rows, bold: (r) => !!r.bold,
      note: [`Saldo buku besar ${cfg.akun} per ${tglID(d.per)}: ${rp(d.gl)}${diff ? ` (selisih ${rp(diff)})` : ' — cocok'}.`],
    }])
  }

  return (
    <>
      <PageHead title={cfg.title} sub={cfg.sub}>
        <button className="btn" onClick={exportXlsx} disabled={!d}>⤓ Excel</button>
        <button className="btn" onClick={() => window.print()} disabled={!d}>⎙ Cetak</button>
        {can(cfg.perm) && <button className="btn" onClick={() => { setFlash(''); setOpening(true) }}>{cfg.lama}</button>}
      </PageHead>
      {flash && <Banner kind="ok">{flash}</Banner>}
      <Banner kind="err">{err}</Banner>
      <div className="filters no-print">
        <label className="inline">Per tanggal <input type="date" value={per} onChange={(e) => setPer(e.target.value || today())} /></label>
        <button className="btn" onClick={() => setOpen(Object.fromEntries((d?.customers ?? []).map((c) => [c.pihak_id, true])))}>Buka semua</button>
        <button className="btn" onClick={() => setOpen({})}>Tutup semua</button>
      </div>

      {d && (
        <div className="kpis aging-kpis">
          {d.buckets.map((b) => (
            <div key={b.key} className={`card kpi ${b.key !== 'belum' && d.totals[b.key] ? 'late' : ''}`}><span>{b.label}</span><b>Rp {rp(d.totals[b.key])}</b><small>{pct(d.totals[b.key])}% dari total</small></div>
          ))}
        </div>
      )}
      {d && diff !== 0 && (
        <div className="banner warn">
          ⚠ Saldo buku besar {cfg.akun} (akun {d.akun.join(', ')}) Rp {rp(d.gl)} berbeda Rp {rp(diff)} dengan daftar {cfg.dok} terbuka Rp {rp(d.total)}.
          {diff > 0 ? ` Kemungkinan ada ${cfg.akun} dari saldo awal atau jurnal manual yang belum punya ${cfg.dok} — catat lewat tombol "${cfg.lama.slice(2)}".`
            : ` Kemungkinan ada jurnal manual ke akun ${cfg.akun} tanpa pembayaran ${cfg.dok}.`}
        </div>
      )}
      {d && diff === 0 && d.total > 0 && <p className="ok-text">✓ Cocok dengan saldo buku besar {cfg.akun} per {tglID(d.per)}.</p>}

      <div className="card flush">
        <div className="report-title print-only"><h2>{boot?.company.nama}</h2><b>{cfg.judul}</b><span>Per {d && tglID(d.per)}</span></div>
        {loading ? <div className="pad"><Spinner /></div> : d && (
          <table className="tbl aging">
            <thead><tr><th>{cfg.pihak}</th><th className="r">Total</th>{d.buckets.map((b) => <th key={b.key} className="r">{b.label}</th>)}</tr></thead>
            <tbody>
              {d.customers.length === 0 && <tr><td colSpan={7} className="hint">ⓘ {cfg.kosong}</td></tr>}
              {d.customers.map((c) => (
                <Fragment key={c.pihak_id}>
                  <tr className="click grp" onClick={() => setOpen({ ...open, [c.pihak_id]: !open[c.pihak_id] })}>
                    <td><span className="caret">{open[c.pihak_id] ? '▾' : '▸'}</span> <b>{c.nama}</b>
                      {c.lewat_batas && <span className="pill r">lewat batas kredit</span>}
                      <span className="small muted"> · {c.invoices.length} {cfg.dok}</span></td>
                    <td className="r"><b>{rp(c.total)}</b></td>
                    {d.buckets.map((b) => <td key={b.key} className={`r ${b.key !== 'belum' && c.b[b.key] ? 'late' : ''}`}>{rp(c.b[b.key], true)}</td>)}
                  </tr>
                  {open[c.pihak_id] && c.invoices.map((i) => (
                    <tr key={i.id} className="click sub" onClick={() => setInv(i.id)}>
                      <td className="indent"><span className="mono">{i.no}</span>{kind === 'utang' && i.referensi && <span className="small"> ({i.referensi})</span>} <span className="small">· {tglID(i.tgl)} · jatuh tempo {tglID(i.jatuh_tempo)}</span>
                        {i.hari > 0 && <span className="err-text small"> · telat {i.hari} hari</span>}</td>
                      <td className="r">{rp(i.sisa)}</td>
                      {d.buckets.map((b) => <td key={b.key} className="r">{i.bucket === b.key ? rp(i.sisa) : ''}</td>)}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            {d.customers.length > 0 && (
              <tfoot><tr><td>Total</td><td className="r tot">{rp(d.total)}</td>{d.buckets.map((b) => <td key={b.key} className="r">{rp(d.totals[b.key], true)}</td>)}</tr></tfoot>
            )}
          </table>
        )}
      </div>
      <p className="hint no-print">ⓘ {cfg.hint}</p>

      {inv && kind === 'piutang' && <InvoiceDetail id={inv} onClose={() => setInv(null)} onChanged={() => load()} />}
      {inv && kind === 'utang' && <PurchaseDetail id={inv} onClose={() => setInv(null)} onChanged={() => load()} />}
      {opening && <OpeningInvoiceForm kind={kind} onClose={() => setOpening(false)} onSaved={(t) => { setOpening(false); setFlash(t); load() }} />}
    </>
  )
}

type Customer = { id: string; kode: string; nama: string; top_hari: number }

/** Piutang yang sudah ada sebelum mulai memakai aplikasi — masuk buku piutang tanpa jurnal baru. */
function OpeningInvoiceForm({ kind, onClose, onSaved }: { kind: Kind; onClose: () => void; onSaved: (t: string) => void }) {
  const utang = kind === 'utang'
  const W = utang ? { pihak: 'Supplier', dok: 'tagihan', akun: 'Utang usaha', lama: 'Utang lama', bayar: 'Pembayarannya' } : { pihak: 'Pelanggan', dok: 'invoice', akun: 'Piutang usaha', lama: 'Piutang lama', bayar: 'Pelunasannya' }
  const [custs, setCusts] = useState<Customer[] | null>(null)
  const [f, setF] = useState({ pelanggan_id: '', no_asal: '', tgl: '', jatuh_tempo: '', total: '', catatan: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    call<Customer[]>('master.list', { entity: utang ? 'supplier' : 'pelanggan', aktif: true }).then(setCusts).catch((e) => { setCusts([]); setErr(errorText(e)) })
  }, [])
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  const amt = parseNum(f.total)
  const blocker = !f.pelanggan_id ? `Pilih ${W.pihak.toLowerCase()}.` : !f.no_asal.trim() ? `Isi nomor ${W.dok} lama.` : !f.tgl ? `Isi tanggal ${W.dok} lama.`
    : !(amt > 0) ? 'Isi sisa yang belum dibayar.' : f.jatuh_tempo && f.jatuh_tempo < f.tgl ? `Jatuh tempo sebelum tanggal ${W.dok}.` : ''
  const save = async () => {
    setErr('')
    if (blocker) return setErr(blocker)
    setBusy(true)
    try {
      const c = custs?.find((x) => x.id === f.pelanggan_id)
      const body = { ...f, total: amt, jatuh_tempo: f.jatuh_tempo || addDays(f.tgl, Number(c?.top_hari) || 0), saldo_awal: true, post: true }
      if (utang) await call('purchase.save', { ...body, supplier_id: f.pelanggan_id })
      else await call('sales.save', body)
      onSaved(`${W.lama} ${f.no_asal} Rp ${rp(amt)} dicatat. ${W.bayar} nanti lewat ${W.dok} ini.`)
    } catch (e) {
      setErr(errorText(e))
      setBusy(false)
    }
  }
  return (
     <Modal title={`${W.lama} (saldo awal)`} sub="Untuk tagihan yang terbit sebelum mulai memakai aplikasi." onClose={onClose}
      dirty={!busy && Object.values(f).some(Boolean)}
      footer={<>
        {blocker && <span className="warn-text">⚠ {blocker}</span>}
        <button className="btn" onClick={onClose}>Batal</button>
        <button className={`btn primary ${blocker ? 'soft' : ''}`} onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
      </>}>
      {!custs ? <Spinner /> : (
        <div className="stack">
          <label className="field"><span>{W.pihak}<Req /></span>
            <select value={f.pelanggan_id} onChange={set('pelanggan_id')}><option value="">— pilih —</option>{custs.map((c) => <option key={c.id} value={c.id}>{c.nama} ({c.kode})</option>)}</select>
          </label>
          <div className="grid2">
            <label className="field"><span>No. {W.dok} lama<Req /></span><input value={f.no_asal} onChange={set('no_asal')} /></label>
            <label className="field"><span>Sisa belum dibayar (Rp)<Req /></span><input className="num" inputMode="decimal" value={f.total} onChange={set('total')} onBlur={() => { if (amt) setF({ ...f, total: rp(amt) }) }} /></label>
          </div>
          <div className="grid2">
            <label className="field"><span>Tanggal {W.dok}<Req /></span><input type="date" value={f.tgl} onChange={set('tgl')} /></label>
            <label className="field"><span>Jatuh tempo</span><input type="date" value={f.jatuh_tempo} onChange={set('jatuh_tempo')} /></label>
          </div>
          <label className="field"><span>Keterangan</span><input value={f.catatan} onChange={set('catatan')} placeholder={utang ? 'mis. Kertas & tinta Desember' : 'mis. Cetak spanduk Desember'} /></label>
          <p className="hint">ⓘ Tidak membuat jurnal baru, karena nilainya sudah termasuk saldo awal akun {W.akun}. Pastikan totalnya sama dengan saldo awal akun itu.</p>
          <Banner kind="err">{err}</Banner>
        </div>
      )}
    </Modal>
  )
}
