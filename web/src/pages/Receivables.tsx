import { Fragment, useCallback, useEffect, useState } from 'react'
import { call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { Banner, Modal, PageHead, Req, Spinner } from '../components/ui'
import { downloadXlsx } from '../lib/excel'
import { addDays, parseNum, rp, tglID, today } from '../lib/format'
import { InvoiceDetail } from './Sales'

type AgingInv = { id: string; no: string; tgl: string; jatuh_tempo: string; total: number; sisa: number; bucket: string; hari: number; saldo_awal: boolean }
type AgingCust = { pelanggan_id: string; nama: string; telepon: string; batas_kredit: number; total: number; b: Record<string, number>; invoices: AgingInv[]; lewat_batas: boolean }
type Aging = { per: string; buckets: { key: string; label: string }[]; customers: AgingCust[]; totals: Record<string, number>; total: number; gl: number; akun: string[] }

export function ReceivablesPage() {
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
    try { setD(await call<Aging>('ar.aging', { per })) } catch (e) { setErr(errorText(e)) }
    setLoading(false)
  }, [per])
  useEffect(() => { load() }, [load])

  const diff = d ? Math.round((d.gl - d.total) * 100) / 100 : 0
  const pct = (v: number) => (d && d.total ? Math.round((v / d.total) * 100) : 0)

  const exportXlsx = () => {
    if (!d) return
    const rows: Record<string, unknown>[] = []
    d.customers.forEach((c) => {
      rows.push({ nama: c.nama, total: c.total, ...c.b, bold: true })
      c.invoices.forEach((i) => rows.push({ nama: `   ${i.no} · jt ${i.jatuh_tempo}${i.hari ? ` · telat ${i.hari} hari` : ''}`, total: i.sisa, [i.bucket]: i.sisa }))
    })
    rows.push({ nama: 'TOTAL', total: d.total, ...d.totals, bold: true })
    downloadXlsx(`Umur-Piutang-${d.per}.xlsx`, [{
      name: 'Umur Piutang', title: [boot?.company.nama ?? '', 'Daftar Umur Piutang Usaha', `Per ${tglID(d.per)}`, 'dalam Rupiah'],
      columns: [{ header: 'Pelanggan / invoice', key: 'nama', width: 44 }, { header: 'Total', key: 'total', money: true, width: 16 },
        ...d.buckets.map((b) => ({ header: b.label, key: b.key, money: true, width: 16 }))],
      rows, bold: (r) => !!r.bold,
      note: [`Saldo buku besar piutang per ${tglID(d.per)}: ${rp(d.gl)}${diff ? ` (selisih ${rp(diff)})` : ' — cocok'}.`],
    }])
  }

  return (
    <>
      <PageHead title="Piutang" sub="Siapa yang belum membayar, berapa, dan sudah berapa lama lewat jatuh tempo.">
        <button className="btn" onClick={exportXlsx} disabled={!d}>⤓ Excel</button>
        <button className="btn" onClick={() => window.print()} disabled={!d}>⎙ Cetak</button>
        {can('penjualan.edit') && <button className="btn" onClick={() => { setFlash(''); setOpening(true) }}>+ Piutang lama (saldo awal)</button>}
      </PageHead>
      {flash && <Banner kind="ok">{flash}</Banner>}
      <Banner kind="err">{err}</Banner>
      <div className="filters no-print">
        <label className="inline">Per tanggal <input type="date" value={per} onChange={(e) => setPer(e.target.value || today())} /></label>
        <button className="btn" onClick={() => setOpen(Object.fromEntries((d?.customers ?? []).map((c) => [c.pelanggan_id, true])))}>Buka semua</button>
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
          ⚠ Saldo buku besar piutang (akun {d.akun.join(', ')}) Rp {rp(d.gl)} berbeda Rp {rp(diff)} dengan daftar invoice terbuka Rp {rp(d.total)}.
          {diff > 0 ? ' Kemungkinan ada piutang dari saldo awal atau jurnal manual yang belum punya invoice — catat lewat tombol "Piutang lama (saldo awal)".'
            : ' Kemungkinan ada jurnal manual yang mengkredit akun piutang tanpa pembayaran invoice.'}
        </div>
      )}
      {d && diff === 0 && d.total > 0 && <p className="ok-text">✓ Cocok dengan saldo buku besar piutang per {tglID(d.per)}.</p>}

      <div className="card flush">
        <div className="report-title print-only"><h2>{boot?.company.nama}</h2><b>Daftar Umur Piutang Usaha</b><span>Per {d && tglID(d.per)}</span></div>
        {loading ? <div className="pad"><Spinner /></div> : d && (
          <table className="tbl aging">
            <thead><tr><th>Pelanggan</th><th className="r">Total</th>{d.buckets.map((b) => <th key={b.key} className="r">{b.label}</th>)}</tr></thead>
            <tbody>
              {d.customers.length === 0 && <tr><td colSpan={7} className="hint">ⓘ Tidak ada piutang terbuka per tanggal ini.</td></tr>}
              {d.customers.map((c) => (
                <Fragment key={c.pelanggan_id}>
                  <tr className="click grp" onClick={() => setOpen({ ...open, [c.pelanggan_id]: !open[c.pelanggan_id] })}>
                    <td><span className="caret">{open[c.pelanggan_id] ? '▾' : '▸'}</span> <b>{c.nama}</b>
                      {c.lewat_batas && <span className="pill r">lewat batas kredit</span>}
                      <span className="small muted"> · {c.invoices.length} invoice</span></td>
                    <td className="r"><b>{rp(c.total)}</b></td>
                    {d.buckets.map((b) => <td key={b.key} className={`r ${b.key !== 'belum' && c.b[b.key] ? 'late' : ''}`}>{rp(c.b[b.key], true)}</td>)}
                  </tr>
                  {open[c.pelanggan_id] && c.invoices.map((i) => (
                    <tr key={i.id} className="click sub" onClick={() => setInv(i.id)}>
                      <td className="indent"><span className="mono">{i.no}</span> <span className="small">· {tglID(i.tgl)} · jatuh tempo {tglID(i.jatuh_tempo)}</span>
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
      <p className="hint no-print">ⓘ Klik nama pelanggan untuk melihat invoicenya, lalu klik invoice untuk menerima pembayaran atau mencatat penagihan. Umur dihitung dari tanggal jatuh tempo.</p>

      {inv && <InvoiceDetail id={inv} onClose={() => setInv(null)} onChanged={() => load()} />}
      {opening && <OpeningInvoiceForm onClose={() => setOpening(false)} onSaved={(t) => { setOpening(false); setFlash(t); load() }} />}
    </>
  )
}

type Customer = { id: string; kode: string; nama: string; top_hari: number }

/** Piutang yang sudah ada sebelum mulai memakai aplikasi — masuk buku piutang tanpa jurnal baru. */
function OpeningInvoiceForm({ onClose, onSaved }: { onClose: () => void; onSaved: (t: string) => void }) {
  const [custs, setCusts] = useState<Customer[] | null>(null)
  const [f, setF] = useState({ pelanggan_id: '', no_asal: '', tgl: '', jatuh_tempo: '', total: '', catatan: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    call<Customer[]>('master.list', { entity: 'pelanggan', aktif: true }).then(setCusts).catch((e) => { setCusts([]); setErr(errorText(e)) })
  }, [])
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  const amt = parseNum(f.total)
  const blocker = !f.pelanggan_id ? 'Pilih pelanggan.' : !f.no_asal.trim() ? 'Isi nomor invoice lama.' : !f.tgl ? 'Isi tanggal invoice lama.'
    : !(amt > 0) ? 'Isi sisa piutang yang belum dibayar.' : f.jatuh_tempo && f.jatuh_tempo < f.tgl ? 'Jatuh tempo sebelum tanggal invoice.' : ''
  const save = async () => {
    setErr('')
    if (blocker) return setErr(blocker)
    setBusy(true)
    try {
      const c = custs?.find((x) => x.id === f.pelanggan_id)
      await call('sales.save', { ...f, total: amt, jatuh_tempo: f.jatuh_tempo || addDays(f.tgl, Number(c?.top_hari) || 0), saldo_awal: true, post: true })
      onSaved(`Piutang lama ${f.no_asal} Rp ${rp(amt)} dicatat. Pelunasannya nanti lewat invoice ini.`)
    } catch (e) {
      setErr(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Modal title="Piutang lama (saldo awal)" sub="Untuk tagihan yang terbit sebelum mulai memakai aplikasi." onClose={onClose}
      dirty={!busy && Object.values(f).some(Boolean)}
      footer={<>
        {blocker && <span className="warn-text">⚠ {blocker}</span>}
        <button className="btn" onClick={onClose}>Batal</button>
        <button className={`btn primary ${blocker ? 'soft' : ''}`} onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
      </>}>
      {!custs ? <Spinner /> : (
        <div className="stack">
          <label className="field"><span>Pelanggan<Req /></span>
            <select value={f.pelanggan_id} onChange={set('pelanggan_id')}><option value="">— pilih —</option>{custs.map((c) => <option key={c.id} value={c.id}>{c.nama} ({c.kode})</option>)}</select>
          </label>
          <div className="grid2">
            <label className="field"><span>No. invoice lama<Req /></span><input value={f.no_asal} onChange={set('no_asal')} /></label>
            <label className="field"><span>Sisa belum dibayar (Rp)<Req /></span><input className="num" inputMode="decimal" value={f.total} onChange={set('total')} onBlur={() => { if (amt) setF({ ...f, total: rp(amt) }) }} /></label>
          </div>
          <div className="grid2">
            <label className="field"><span>Tanggal invoice<Req /></span><input type="date" value={f.tgl} onChange={set('tgl')} /></label>
            <label className="field"><span>Jatuh tempo</span><input type="date" value={f.jatuh_tempo} onChange={set('jatuh_tempo')} /></label>
          </div>
          <label className="field"><span>Keterangan</span><input value={f.catatan} onChange={set('catatan')} placeholder="mis. Cetak spanduk Desember" /></label>
          <p className="hint">ⓘ Tidak membuat jurnal baru, karena nilainya sudah termasuk saldo awal akun Piutang usaha. Pastikan total semua piutang lama sama dengan saldo awal piutang.</p>
          <Banner kind="err">{err}</Banner>
        </div>
      )}
    </Modal>
  )
}
