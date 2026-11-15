import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { AccountPicker, useAccounts } from '../components/AccountPicker'
import { Banner, Modal, PageHead, Req, Spinner, fmtTime } from '../components/ui'
import { downloadXlsx } from '../lib/excel'
import { parseNum, rp, tglID, today } from '../lib/format'

type StockRow = { id: string; sku: string; nama: string; satuan: string; aktif: boolean; lacak: boolean; qty: number; nilai: number; rata: number; stok_min: number; harga_beli: number; rendah: boolean }
type StockList = { per: string; rows: StockRow[]; total: number; gl: number; akun: string[]; rendah: number }
type CardRow = { tgl: string; jenis: string; ref_no: string; keterangan: string; masuk: number; keluar: number; harga: number; nilai: number; saldo_qty: number; saldo_nilai: number }
type Card = { produk: { nama: string; sku: string; satuan: string }; awal: { qty: number; nilai: number }; rows: CardRow[]; akhir: { qty: number; nilai: number; rata: number } }
type Adj = { id: string; no: string; tgl: string; referensi: string; catatan: string; total: number; status: string; jurnal_id: string; alasan_batal: string; dibuat_oleh: string; dibuat_pada: string
  lines: { produk_id: string; deskripsi: string; satuan: string; qty: number; nilai: number }[] }
type AdjKind = 'pemakaian' | 'opname' | 'awal'

const JENIS: Record<string, [string, string]> = {
  awal: ['n', 'Stok awal'], beli: ['g', 'Pembelian'], jual: ['b', 'Penjualan'], pemakaian: ['o', 'Pemakaian'], opname: ['r', 'Opname'],
}
const ADJ_LABEL: Record<AdjKind, string> = { pemakaian: 'Pemakaian bahan', opname: 'Stok opname', awal: 'Stok awal' }
const qtyFmt = (n: number) => rp(n)

export function InventoryPage() {
  const { boot, can } = useSession()
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('tab') === 'penyesuaian' ? 'penyesuaian' : 'stok'
  const [per, setPer] = useState(today())
  const [q, setQ] = useState('')
  const [d, setD] = useState<StockList | null>(null)
  const [adjs, setAdjs] = useState<Adj[] | null>(null)
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const [card, setCard] = useState<StockRow | null>(null)
  const [form, setForm] = useState<AdjKind | null>(null)
  const [adj, setAdj] = useState<Adj | null>(null)

  const load = useCallback(async () => {
    setErr('')
    try {
      if (tab === 'stok') setD(await call<StockList>('stock.list', { per }))
      else setAdjs(await call<Adj[]>('stock.adjList', {}))
    } catch (e) { setErr(errorText(e)) }
  }, [tab, per])
  useEffect(() => { load() }, [load])

  const rows = (d?.rows ?? []).filter((r) => !q || (r.sku + ' ' + r.nama).toLowerCase().includes(q.toLowerCase()))
  const diff = d ? Math.round((d.gl - d.total) * 100) / 100 : 0
  const done = (t: string) => { setForm(null); setAdj(null); setFlash(t); load() }

  const exportXlsx = () => {
    if (!d) return
    downloadXlsx(`Persediaan-${d.per}.xlsx`, [{
      name: 'Persediaan', title: [boot?.company.nama ?? '', 'Daftar Persediaan', `Per ${tglID(d.per)}`, 'Metode rata-rata tertimbang'],
      columns: [{ header: 'Kode', key: 'sku', width: 12 }, { header: 'Nama barang', key: 'nama', width: 36 }, { header: 'Qty', key: 'qty', width: 10 },
        { header: 'Satuan', key: 'satuan', width: 10 }, { header: 'Harga rata-rata', key: 'rata', money: true, width: 16 }, { header: 'Nilai', key: 'nilai', money: true, width: 18 },
        { header: 'Stok minimum', key: 'stok_min', width: 12 }],
      rows: [...d.rows, { nama: 'TOTAL', nilai: d.total, bold: true }], bold: (r) => !!r.bold,
      note: [`Saldo buku besar persediaan: ${rp(d.gl)}${diff ? ` (selisih ${rp(diff)})` : ' — cocok'}.`],
    }])
  }

  return (
    <>
      <PageHead title="Persediaan" sub="Stok barang & bahan dihitung otomatis dari pembelian, penjualan, pemakaian, dan opname (metode rata-rata).">
        {tab === 'stok' && <button className="btn" onClick={exportXlsx} disabled={!d}>⤓ Excel</button>}
        {can('persediaan.edit') && <>
          <button className="btn" onClick={() => { setFlash(''); setForm('awal') }}>Stok awal</button>
          <button className="btn" onClick={() => { setFlash(''); setForm('opname') }}>Stok opname</button>
          <button className="btn primary" onClick={() => { setFlash(''); setForm('pemakaian') }}>− Pemakaian bahan</button>
        </>}
      </PageHead>
      {flash && <Banner kind="ok">{flash}</Banner>}
      <Banner kind="err">{err}</Banner>
      <div className="tabs">
        <button className={tab === 'stok' ? 'on' : ''} onClick={() => setSp({})}>Posisi stok</button>
        <button className={tab === 'penyesuaian' ? 'on' : ''} onClick={() => setSp({ tab: 'penyesuaian' })}>Riwayat penyesuaian</button>
      </div>

      {tab === 'stok' ? (
        <>
          <div className="filters">
            <label className="inline">Per tanggal <input type="date" value={per} onChange={(e) => setPer(e.target.value || today())} /></label>
            <input className="grow" placeholder="Cari kode / nama barang…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {d && (
            <div className="kpis">
              <div className="card kpi"><span>Nilai persediaan</span><b>Rp {rp(d.total)}</b></div>
              <div className="card kpi"><span>Jenis barang</span><b>{d.rows.length}</b></div>
              <div className="card kpi"><span>Di bawah minimum</span><b className={d.rendah ? 'neg' : ''}>{d.rendah}</b></div>
            </div>
          )}
          {d && diff !== 0 && (
            <div className="banner warn">⚠ Nilai di kartu stok Rp {rp(d.total)} berbeda Rp {rp(diff)} dengan saldo buku besar persediaan (akun {d.akun.join(', ')}) Rp {rp(d.gl)}.
              {diff > 0 ? ' Kemungkinan saldo awal persediaan belum dirinci per barang — catat lewat tombol "Stok awal".' : ' Kemungkinan ada jurnal manual yang mengurangi akun persediaan.'}</div>
          )}
          {d && diff === 0 && d.total > 0 && <p className="ok-text">✓ Cocok dengan saldo buku besar persediaan per {tglID(d.per)}.</p>}
          <div className="card flush">
            {!d ? <div className="pad"><Spinner /></div> : (
              <table className="tbl">
                <thead><tr><th>Kode</th><th>Barang</th><th className="r">Qty</th><th className="r">Harga rata-rata</th><th className="r">Nilai</th><th className="r">Minimum</th></tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={6} className="hint">ⓘ Belum ada barang yang dilacak stoknya. Di Master Data → Produk, pilih tipe <b>barang</b> dan <b>Lacak stok: ya</b>.</td></tr>}
                  {rows.map((r) => (
                    <tr key={r.id} className={`click ${r.rendah ? 'bad' : ''}`} onClick={() => setCard(r)}>
                      <td className="mono">{r.sku}</td>
                      <td>{r.nama}{!r.lacak && <span className="pill n">tidak dilacak lagi</span>}{r.rendah && <span className="pill r">stok rendah</span>}</td>
                      <td className={`r nowrap ${r.qty < 0 ? 'neg' : ''}`}>{qtyFmt(r.qty)} {r.satuan}</td>
                      <td className="r">{rp(r.rata, true)}</td>
                      <td className="r">{rp(r.nilai)}</td>
                      <td className="r">{r.stok_min ? qtyFmt(r.stok_min) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                {rows.length > 0 && <tfoot><tr><td colSpan={4}>Total</td><td className="r tot">{rp(rows.reduce((t, r) => t + r.nilai, 0))}</td><td /></tr></tfoot>}
              </table>
            )}
          </div>
          <p className="hint">ⓘ Klik barang untuk melihat kartu stoknya. Barang bertambah dari <Link to="/pembelian">Pembelian</Link>, berkurang dari <Link to="/penjualan">Penjualan</Link> dan pemakaian bahan.</p>
        </>
      ) : (
        <div className="card flush">
          {!adjs ? <div className="pad"><Spinner /></div> : (
            <table className="tbl">
              <thead><tr><th>Tanggal</th><th>Nomor</th><th>Jenis</th><th>Keterangan</th><th className="r">Nilai</th><th>Status</th></tr></thead>
              <tbody>
                {adjs.length === 0 && <tr><td colSpan={6} className="hint">ⓘ Belum ada pemakaian bahan, opname, atau stok awal.</td></tr>}
                {adjs.map((a) => (
                  <tr key={a.id} className={`click ${a.status === 'batal' ? 'off' : ''}`} onClick={() => setAdj(a)}>
                    <td className="nowrap">{tglID(a.tgl)}</td><td className="mono nowrap">{a.no}</td>
                    <td><span className={`pill ${JENIS[a.referensi]?.[0] ?? 'n'}`}>{ADJ_LABEL[a.referensi as AdjKind] ?? a.referensi}</span></td>
                    <td>{a.catatan}</td><td className="r">{rp(a.total)}</td>
                    <td>{a.status === 'batal' ? <span className="pill r">Dibatalkan</span> : <span className="pill g">Tercatat</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {card && <StockCard row={card} onClose={() => setCard(null)} />}
      {form && <AdjustForm kind={form} onClose={() => setForm(null)} onSaved={done} />}
      {adj && <AdjDetail adj={adj} onClose={() => setAdj(null)} onVoided={done} />}
    </>
  )
}

// ---------------------------------------------------------------- kartu stok

function StockCard({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const [from, setFrom] = useState(today().slice(0, 4) + '-01-01')
  const [to, setTo] = useState(today())
  const [c, setC] = useState<Card | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    setC(null)
    call<Card>('stock.card', { produk_id: row.id, from, to }).then(setC).catch((e) => setErr(errorText(e)))
  }, [row.id, from, to])
  return (
    <Modal size="xl" title={`Kartu stok · ${row.nama}`} sub={`${row.sku} · satuan ${row.satuan} · metode rata-rata`} onClose={onClose}
      footer={<button className="btn primary" onClick={onClose}>Tutup</button>}>
      <div className="filters">
        <label className="inline">Dari <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline">Sampai <input type="date" value={to} onChange={(e) => setTo(e.target.value || today())} /></label>
      </div>
      <Banner kind="err">{err}</Banner>
      {!c ? <Spinner /> : (
        <table className="tbl compact">
          <thead><tr><th>Tanggal</th><th>Jenis</th><th>Referensi</th><th className="r">Masuk</th><th className="r">Keluar</th><th className="r">Harga/satuan</th><th className="r">Nilai</th><th className="r">Saldo qty</th><th className="r">Saldo nilai</th></tr></thead>
          <tbody>
            <tr className="sub"><td colSpan={7}>Saldo awal</td><td className="r">{qtyFmt(c.awal.qty)}</td><td className="r">{rp(c.awal.nilai)}</td></tr>
            {c.rows.length === 0 && <tr><td colSpan={9} className="hint">ⓘ Tidak ada mutasi pada periode ini.</td></tr>}
            {c.rows.map((r, i) => (
              <tr key={i}>
                <td className="nowrap">{tglID(r.tgl)}</td>
                <td><span className={`pill ${JENIS[r.jenis]?.[0] ?? 'n'}`}>{JENIS[r.jenis]?.[1] ?? r.jenis}</span></td>
                <td><span className="mono small">{r.ref_no}</span>{r.keterangan && <div className="small">{r.keterangan}</div>}</td>
                <td className="r in">{r.masuk ? qtyFmt(r.masuk) : ''}</td>
                <td className="r out">{r.keluar ? qtyFmt(r.keluar) : ''}</td>
                <td className="r">{rp(r.harga)}</td>
                <td className="r">{rp(r.nilai)}</td>
                <td className={`r ${r.saldo_qty < 0 ? 'neg' : ''}`}>{qtyFmt(r.saldo_qty)}</td>
                <td className="r">{rp(r.saldo_nilai)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={7}>Saldo akhir · rata-rata Rp {rp(c.akhir.rata)}/{c.produk.satuan}</td><td className="r tot">{qtyFmt(c.akhir.qty)}</td><td className="r tot">{rp(c.akhir.nilai)}</td></tr></tfoot>
        </table>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------- form penyesuaian

type ALine = { produk_id: string; qty: string; harga: string }
const blankA = (): ALine => ({ produk_id: '', qty: '', harga: '' })

function AdjustForm({ kind, onClose, onSaved }: { kind: AdjKind; onClose: () => void; onSaved: (t: string) => void }) {
  const accounts = useAccounts()
  const [items, setItems] = useState<StockRow[] | null>(null)
  const [tgl, setTgl] = useState(today())
  const [ket, setKet] = useState(kind === 'awal' ? 'Stok awal' : kind === 'opname' ? `Stok opname ${tglID(today())}` : '')
  const [akun, setAkun] = useState('5-1101')
  const [lines, setLines] = useState<ALine[]>([blankA()])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    call<StockList>('stock.list', {}).then((d) => setItems(d.rows.filter((r) => r.lacak))).catch((e) => { setItems([]); setErr(errorText(e)) })
  }, [])
  const info = (id: string) => items?.find((x) => x.id === id)
  const setLine = (i: number, patch: Partial<ALine>) => {
    setTouched(true)
    setLines((ls) => {
      const next = ls.map((l, j) => (j === i ? { ...l, ...patch } : l))
      if (i === next.length - 1 && next[i].produk_id) next.push(blankA())
      return next
    })
  }
  const used = lines.filter((l) => l.produk_id)
  const dupe = used.find((l, i) => used.findIndex((x) => x.produk_id === l.produk_id) !== i)
  const lineErr = (() => {
    for (const l of used) {
      const it = info(l.produk_id)!
      const q = parseNum(l.qty)
      if (l.qty === '' || isNaN(q) || q < 0 || (kind !== 'opname' && q === 0)) return `Isi qty ${it.nama}.`
      if (kind === 'pemakaian' && q > it.qty) return `Stok ${it.nama} hanya ${qtyFmt(it.qty)} ${it.satuan}.`
      if (kind === 'awal' && !(parseNum(l.harga) > 0)) return `Isi harga pokok per satuan ${it.nama}.`
    }
    return ''
  })()
  const blocker = !tgl ? 'Isi tanggal.' : !ket.trim() ? 'Isi keterangan.' : !used.length ? 'Pilih minimal satu barang.'
    : dupe ? `${info(dupe.produk_id)?.nama} tercantum dua kali.` : lineErr ? lineErr
    : kind === 'pemakaian' && !akun ? 'Pilih akun pemakaian.'
    : kind === 'opname' && used.every((l) => parseNum(l.qty) === info(l.produk_id)?.qty) ? 'Belum ada selisih antara qty fisik dan sistem.'
    : ''

  const fillAll = () => { setTouched(true); setLines([...(items ?? []).map((x) => ({ produk_id: x.id, qty: String(x.qty).replace('.', ','), harga: '' })), blankA()]) }

  const save = async () => {
    setErr('')
    if (blocker) return setErr(blocker)
    setBusy(true)
    try {
      const r = await call<{ no: string; baris: number; nilai: number }>('stock.adjust', {
        tgl, jenis: kind, keterangan: ket, akun_id: akun,
        items: used.map((l) => ({ produk_id: l.produk_id, qty: parseNum(l.qty), harga: parseNum(l.harga) || 0 })),
      })
      onSaved(`${ADJ_LABEL[kind]} ${r.no} tercatat: ${r.baris} barang, nilai Rp ${rp(r.nilai)}${kind === 'awal' ? ' (tanpa jurnal — sudah termasuk saldo awal)' : ''}.`)
    } catch (e) {
      setErr(errorText(e))
      setBusy(false)
    }
  }

  const sub = kind === 'pemakaian' ? 'Bahan yang dipakai untuk produksi/operasional. Jurnal: Dr akun pemakaian, Cr Persediaan, sebesar harga rata-rata.'
    : kind === 'opname' ? 'Isi jumlah fisik hasil hitung gudang. Hanya barang yang selisih yang dicatat (Dr/Cr 5-1301 Selisih persediaan).'
    : 'Rincian stok saat mulai memakai aplikasi. Tidak membuat jurnal — totalnya harus sama dengan saldo awal akun Persediaan.'
  const accName = (k: string) => accounts.find((a) => a.kode === k)?.nama ?? k

  return (
    <Modal size="lg" title={ADJ_LABEL[kind]} sub={sub} onClose={onClose} dirty={!busy && touched}
      footer={<>
        {blocker ? <span className="warn-text">⚠ {blocker}</span> : <span className="ok-text">✓ {used.length} barang siap dicatat</span>}
        <button className="btn" onClick={onClose}>Batal</button>
        <button className={`btn primary ${blocker ? 'soft' : ''}`} onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
      </>}>
      {!items ? <Spinner /> : (
        <div className="stack">
          <div className="grid2">
            <label className="field"><span>Tanggal<Req /></span><input type="date" value={tgl} onChange={(e) => { setTouched(true); setTgl(e.target.value) }} /></label>
            <label className="field"><span>Keterangan<Req /></span><input value={ket} onChange={(e) => { setTouched(true); setKet(e.target.value) }} placeholder={kind === 'pemakaian' ? 'mis. Produksi brosur PT Sinar Abadi' : ''} /></label>
          </div>
          {kind === 'pemakaian' && (
            <label className="field"><span>Dicatat sebagai<Req /></span>
              <AccountPicker value={akun} onChange={setAkun} types={['hpp', 'beban']} />
              <small className="hint">ⓘ Default 5-1101 {accName('5-1101')} untuk bahan produksi; pilih akun beban untuk pemakaian kantor (mis. 6-1801).</small>
            </label>
          )}
          {items.length === 0 && <p className="warn-text">⚠ Belum ada barang yang dilacak stoknya. Atur di Master Data → Produk (tipe barang, Lacak stok: ya).</p>}
          {kind === 'opname' && items.length > 0 && <div><button className="btn" onClick={fillAll}>Isi semua barang dengan qty sistem</button></div>}
          <div className="jf-box">
            <table className="tbl jf-lines">
              <thead><tr><th className="n">#</th><th>Barang<Req /></th>
                {kind === 'opname' && <th className="r">Qty sistem</th>}
                <th className="r w-qty">{kind === 'pemakaian' ? 'Qty dipakai' : kind === 'opname' ? 'Qty fisik' : 'Qty'}<Req /></th>
                {kind === 'opname' && <th className="r">Selisih</th>}
                {kind === 'awal' && <th className="r w-money">Harga pokok/satuan<Req /></th>}
                {kind === 'pemakaian' && <th className="r">Stok tersedia</th>}
                <th className="n"></th></tr></thead>
              <tbody>
                {lines.map((l, i) => {
                  const it = info(l.produk_id)
                  const diff = it && l.qty !== '' ? parseNum(l.qty) - it.qty : 0
                  return (
                    <tr key={i}>
                      <td className="n">{i + 1}</td>
                      <td><select value={l.produk_id} onChange={(e) => setLine(i, { produk_id: e.target.value, harga: info(e.target.value)?.harga_beli ? rp(info(e.target.value)!.harga_beli) : l.harga })}>
                        <option value="">— pilih barang —</option>
                        {items.map((x) => <option key={x.id} value={x.id}>{x.nama} ({x.sku})</option>)}
                      </select></td>
                      {kind === 'opname' && <td className="r">{it ? `${qtyFmt(it.qty)} ${it.satuan}` : ''}</td>}
                      <td className="num"><input inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                      {kind === 'opname' && <td className={`r ${diff < 0 ? 'neg' : diff > 0 ? 'in' : ''}`}>{it && l.qty !== '' ? (diff > 0 ? '+' : '') + qtyFmt(diff) : ''}</td>}
                      {kind === 'awal' && <td className="num"><input inputMode="decimal" value={l.harga} onChange={(e) => setLine(i, { harga: e.target.value })} onBlur={(e) => { const n = parseNum(e.target.value); if (n) setLine(i, { harga: rp(n) }) }} /></td>}
                      {kind === 'pemakaian' && <td className="r">{it ? `${qtyFmt(it.qty)} ${it.satuan}` : ''}</td>}
                      <td className="n">{lines.length > 1 && <button className="x" onClick={() => { setTouched(true); setLines((ls) => ls.filter((_, j) => j !== i)) }}>×</button>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Banner kind="err">{err}</Banner>
        </div>
      )}
    </Modal>
  )
}

function AdjDetail({ adj, onClose, onVoided }: { adj: Adj; onClose: () => void; onVoided: (t: string) => void }) {
  const { can } = useSession()
  const [ask, setAsk] = useState(false)
  const [alasan, setAlasan] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const voidIt = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await call<{ pembalik: string }>('stock.adjVoid', { id: adj.id, alasan })
      onVoided(`${adj.no} dibatalkan${r.pembalik ? `. Jurnal pembalik: ${r.pembalik}` : ''}. Stok kembali seperti sebelumnya.`)
    } catch (e) {
      setErr(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Modal size={ask ? 'sm' : 'md'} title={ask ? `Batalkan ${adj.no}?` : `${ADJ_LABEL[adj.referensi as AdjKind] ?? 'Penyesuaian'} · ${adj.no}`} onClose={onClose} dirty={ask && !!alasan.trim() && !busy}
      footer={ask
        ? <><button className="btn" onClick={() => setAsk(false)}>Kembali</button><button className="btn danger" disabled={busy || !alasan.trim()} onClick={voidIt}>{busy ? 'Memproses…' : 'Batalkan'}</button></>
        : <>
          {adj.jurnal_id && can('jurnal.view') && <Link className="btn" to={`/jurnal?open=${adj.jurnal_id}`}>Lihat jurnal</Link>}
          {adj.status !== 'batal' && can('persediaan.edit') && <button className="btn warn" onClick={() => setAsk(true)}>Batalkan</button>}
          <button className="btn primary" onClick={onClose}>Tutup</button>
        </>}>
      {ask ? (
        <>
          <label className="field"><span>Alasan pembatalan<Req /></span><input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="tercatat di audit log" /></label>
          <p className="hint">ⓘ Mutasi stok dibatalkan dan, bila ada jurnalnya, dibuat jurnal pembalik bertanggal sama.</p>
        </>
      ) : (
        <>
          <table className="tbl kv"><tbody>
            <tr><td>Tanggal</td><td>{tglID(adj.tgl)}</td></tr>
            <tr><td>Keterangan</td><td>{adj.catatan}</td></tr>
            <tr><td>Dicatat</td><td>{adj.dibuat_oleh} · {fmtTime(adj.dibuat_pada)}</td></tr>
          </tbody></table>
          <table className="tbl compact">
            <thead><tr><th>Barang</th><th className="r">Qty</th><th className="r">Nilai</th></tr></thead>
            <tbody>{adj.lines.map((l, i) => <tr key={i}><td>{l.deskripsi}</td><td className={`r ${l.qty < 0 ? 'out' : 'in'}`}>{l.qty > 0 ? '+' : ''}{qtyFmt(l.qty)} {l.satuan}</td><td className="r">{rp(l.nilai)}</td></tr>)}</tbody>
          </table>
          {adj.status === 'batal' && <p className="err-text">Dibatalkan: {adj.alasan_batal}</p>}
        </>
      )}
      <Banner kind="err">{err}</Banner>
    </Modal>
  )
}
