import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { Banner, Modal, PageHead, Req, Spinner } from '../components/ui'
import { parseNum, rp, tglID, today } from '../lib/format'

type KB = { id: string; nama: string; jenis: string; akun_id: string; no_rek: string; aktif: boolean; saldo: number }
type Item = { key: string; jurnal_id: string; tgl: string; no: string; keterangan: string; masuk: number; keluar: number; cleared: boolean }
type Rec = { id: string; tgl: string; saldo_koran: number; saldo_buku: number; transit: number; beredar: number; selisih: number; status: 'draft' | 'final'; catatan: string; diubah_oleh: string }
type Data = { rekening: { id: string; nama: string; akun_id: string; no_rek: string }; tgl: string; saldo_buku: number; items: Item[]; draft: Rec | null; terakhir: Rec | null; riwayat: Rec[] }

const endOfLastMonth = () => { const n = new Date(); const d = new Date(n.getFullYear(), n.getMonth(), 0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export function ReconcilePage() {
  const [kbs, setKbs] = useState<KB[] | null>(null)
  const [hist, setHist] = useState<Record<string, Data>>({})
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const [open, setOpen] = useState<KB | null>(null)
  const [reopen, setReopen] = useState<{ kb: KB; rec: Rec } | null>(null)

  const load = useCallback(async () => {
    setErr('')
    try {
      const list = (await call<KB[]>('kasbank.list')).filter((k) => k.aktif && k.jenis === 'bank')
      setKbs(list)
      const pairs = await Promise.all(list.map(async (k) => [k.id, await call<Data>('recon.get', { kasbank_id: k.id })] as const))
      setHist(Object.fromEntries(pairs))
    } catch (e) { setErr(errorText(e)); setKbs((x) => x ?? []) }
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <>
      <PageHead title="Rekonsiliasi Bank" sub="Cocokkan catatan bank di aplikasi dengan rekening koran setiap akhir bulan." />
      {flash && <Banner kind="ok">{flash}</Banner>}
      <Banner kind="err">{err}</Banner>
      {!kbs ? <Spinner /> : kbs.length === 0 ? (
        <div className="card empty"><p className="warn-text">⚠ Belum ada rekening bank aktif yang bisa Anda lihat. Tambahkan di <Link to="/kas-bank">Kas & Bank</Link>.</p></div>
      ) : (
        <div className="recon-grid">
          {kbs.map((k) => {
            const h = hist[k.id]
            return (
              <div key={k.id} className="card recon-card">
                <div className="row between"><b>{k.nama}</b>{h?.draft ? <span className="pill o">Draft {tglID(h.draft.tgl)}</span> : h?.terakhir ? <span className="pill g">✓ s/d {tglID(h.terakhir.tgl)}</span> : <span className="pill n">Belum pernah</span>}</div>
                {k.no_rek && <div className="small mono">{k.no_rek}</div>}
                <div className="recon-saldo">Saldo buku <b>Rp {rp(k.saldo)}</b></div>
                {h?.terakhir && <div className="small">Rekonsiliasi terakhir: saldo koran Rp {rp(h.terakhir.saldo_koran)} per {tglID(h.terakhir.tgl)}</div>}
                <div className="row">
                  <button className="btn primary" onClick={() => { setFlash(''); setOpen(k) }}>{h?.draft ? 'Lanjutkan draft' : 'Mulai rekonsiliasi'}</button>
                  {h?.terakhir && !h.draft && <button className="link" onClick={() => setReopen({ kb: k, rec: h.terakhir! })}>buka kembali yang terakhir</button>}
                </div>
                {h && h.riwayat.filter((r) => r.status === 'final').length > 0 && (
                  <details className="recon-hist"><summary>Riwayat</summary>
                    <table className="tbl compact"><tbody>{h.riwayat.filter((r) => r.status === 'final').map((r) => (
                      <tr key={r.id}><td>{tglID(r.tgl)}</td><td className="r">Rp {rp(r.saldo_koran)}</td><td className="small">{r.diubah_oleh}</td></tr>
                    ))}</tbody></table>
                  </details>
                )}
              </div>
            )
          })}
        </div>
      )}
      <div className="card">
        <h3>Cara rekonsiliasi</h3>
        <ol className="checklist">
          <li>Siapkan rekening koran / mutasi bank sampai akhir bulan.</li>
          <li>Catat dulu di <Link to="/kas-bank">Kas & Bank</Link> transaksi yang ada di koran tapi belum dicatat (biaya admin, bunga, pajak bunga, transfer masuk yang belum diketahui).</li>
          <li>Klik <b>Mulai rekonsiliasi</b>, isi tanggal & saldo akhir koran, lalu centang setiap transaksi yang muncul di koran.</li>
          <li>Yang tidak dicentang menjadi setoran dalam perjalanan / pengeluaran beredar. Bila selisih Rp 0, klik <b>Selesaikan</b>.</li>
        </ol>
      </div>
      {open && <ReconModal kb={open} onClose={() => setOpen(null)} onSaved={(t) => { setOpen(null); setFlash(t); load() }} />}
      {reopen && <ReopenModal {...reopen} onClose={() => setReopen(null)} onDone={(t) => { setReopen(null); setFlash(t); load() }} />}
    </>
  )
}

function ReconModal({ kb, onClose, onSaved }: { kb: KB; onClose: () => void; onSaved: (t: string) => void }) {
  const { can } = useSession()
  const [tgl, setTgl] = useState('')
  const [d, setD] = useState<Data | null>(null)
  const [koran, setKoran] = useState('')
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    setD(null); setErr('')
    call<Data>('recon.get', { kasbank_id: kb.id, tgl: tgl || undefined }).then((x) => {
      setD(x)
      if (!tgl) setTgl(x.draft ? x.tgl : endOfLastMonth() > (x.terakhir?.tgl ?? '') ? endOfLastMonth() : today())
      setChecked(Object.fromEntries(x.items.map((i) => [i.key, i.cleared])))
      if (x.draft && !koran) setKoran(rp(x.draft.saldo_koran))
    }).catch((e) => setErr(errorText(e)))
  }, [kb.id, tgl]) // eslint-disable-line react-hooks/exhaustive-deps

  const calc = useMemo(() => {
    if (!d) return null
    let transit = 0, beredar = 0, n = 0
    d.items.forEach((i) => { if (checked[i.key]) { n++; return } transit += Math.round(i.masuk * 100); beredar += Math.round(i.keluar * 100) })
    const buku = Math.round(d.saldo_buku * 100)
    const hitung = buku - transit + beredar
    const k = koran.trim() === '' ? NaN : Math.round(parseNum(koran) * 100)
    return { transit: transit / 100, beredar: beredar / 100, hitung: hitung / 100, selisih: isNaN(k) ? NaN : (k - hitung) / 100, n }
  }, [d, checked, koran])

  const save = async (final: boolean) => {
    if (!d || !calc) return
    setErr('')
    if (isNaN(calc.selisih)) return setErr('Isi saldo akhir menurut rekening koran.')
    if (final && calc.selisih !== 0) return setErr(`Masih selisih Rp ${rp(calc.selisih)}. Cek centang atau catat transaksi yang belum ada di Kas & Bank.`)
    setBusy(true)
    try {
      await call('recon.save', { kasbank_id: kb.id, tgl, saldo_koran: parseNum(koran), cleared: Object.keys(checked).filter((k) => checked[k]), final })
      onSaved(final ? `Rekonsiliasi ${kb.nama} per ${tglID(tgl)} selesai — cocok dengan rekening koran.` : `Draft rekonsiliasi ${kb.nama} disimpan.`)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : errorText(e))
      setBusy(false)
    }
  }
  const blocker = !tgl ? 'Isi tanggal rekening koran.' : !calc || isNaN(calc.selisih) ? 'Isi saldo akhir menurut rekening koran.'
    : calc.selisih !== 0 ? `Selisih Rp ${rp(calc.selisih)} — belum bisa diselesaikan.` : ''
  const all = d ? d.items.every((i) => checked[i.key]) : false

  return (
    <Modal size="xl" title={`Rekonsiliasi · ${kb.nama}`} sub={kb.no_rek ? `No. rekening ${kb.no_rek}` : undefined} onClose={onClose} dirty={!busy && touched}
      footer={<>
        {blocker ? <span className="warn-text">⚠ {blocker}</span> : <span className="ok-text">✓ Cocok dengan rekening koran</span>}
        <button className="btn" onClick={onClose}>Batal</button>
        {can('kas.edit') && <button className="btn" onClick={() => save(false)} disabled={busy}>Simpan draft</button>}
        {can('kas.edit') && <button className={`btn primary ${blocker ? 'soft' : ''}`} onClick={() => save(true)} disabled={busy}>{busy ? 'Menyimpan…' : 'Selesaikan'}</button>}
      </>}>
      <div className="grid3">
        <label className="field"><span>Tanggal rekening koran<Req /></span><input type="date" value={tgl} min={d?.terakhir?.tgl} onChange={(e) => { setTouched(true); setTgl(e.target.value) }} />
          {d?.terakhir && <small className="hint">ⓘ Terakhir selesai per {tglID(d.terakhir.tgl)}.</small>}</label>
        <label className="field"><span>Saldo akhir menurut koran (Rp)<Req /></span>
          <input className="num" inputMode="decimal" value={koran} onChange={(e) => { setTouched(true); setKoran(e.target.value) }} onBlur={() => { const n = parseNum(koran); if (koran && !isNaN(n)) setKoran(rp(n)) }} /></label>
        <div />
      </div>
      <Banner kind="err">{err}</Banner>
      {!d || !calc ? (!err && <Spinner />) : (
        <div className="recon-body">
          <div className="recon-list">
            <div className="row between">
              <b>Transaksi di buku s/d {tglID(d.tgl)} ({d.items.length})</b>
              {d.items.length > 0 && <label className="check"><input type="checkbox" checked={all} onChange={(e) => { setTouched(true); setChecked(Object.fromEntries(d.items.map((i) => [i.key, e.target.checked]))) }} /> centang semua</label>}
            </div>
            <table className="tbl compact recon-tbl">
              <thead><tr><th className="n">Ada di koran</th><th>Tanggal</th><th>Keterangan</th><th className="r">Masuk</th><th className="r">Keluar</th></tr></thead>
              <tbody>
                {d.items.length === 0 && <tr><td colSpan={5} className="hint">ⓘ Tidak ada transaksi yang belum dicocokkan.</td></tr>}
                {d.items.map((i) => (
                  <tr key={i.key} className={`click ${checked[i.key] ? 'on' : ''}`} onClick={() => { setTouched(true); setChecked({ ...checked, [i.key]: !checked[i.key] }) }}>
                    <td className="n"><input type="checkbox" checked={!!checked[i.key]} readOnly /></td>
                    <td className="nowrap">{tglID(i.tgl)}<div className="mono small">{i.no}</div></td>
                    <td>{i.keterangan}</td>
                    <td className="r in">{i.masuk ? rp(i.masuk) : ''}</td>
                    <td className="r out">{i.keluar ? rp(i.keluar) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <table className="tbl kv recon-sum">
            <tbody>
              <tr><td>Saldo menurut buku</td><td className="r">Rp {rp(d.saldo_buku)}</td></tr>
              <tr><td>− Setoran dalam perjalanan<div className="small">masuk di buku, belum di koran</div></td><td className="r">({rp(calc.transit)})</td></tr>
              <tr><td>+ Pengeluaran beredar<div className="small">keluar di buku, belum di koran</div></td><td className="r">{rp(calc.beredar)}</td></tr>
              <tr className="grand"><td>Saldo bank menurut hitungan</td><td className="r">Rp {rp(calc.hitung)}</td></tr>
              <tr><td>Saldo menurut rekening koran</td><td className="r">{isNaN(calc.selisih) ? '—' : `Rp ${rp(parseNum(koran))}`}</td></tr>
              <tr className={!isNaN(calc.selisih) && calc.selisih === 0 ? 'ok-row' : 'bad-row'}><td>Selisih</td><td className="r"><b>{isNaN(calc.selisih) ? '—' : `Rp ${rp(calc.selisih)}`}</b></td></tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">ⓘ Ada biaya admin, bunga, atau mutasi di koran yang belum dicatat? Simpan draft, catat di <Link to="/kas-bank">Kas & Bank</Link>, lalu lanjutkan draft ini.</p>
    </Modal>
  )
}

function ReopenModal({ kb, rec, onClose, onDone }: { kb: KB; rec: Rec; onClose: () => void; onDone: (t: string) => void }) {
  const [alasan, setAlasan] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const run = async () => {
    setBusy(true); setErr('')
    try { await call('recon.reopen', { id: rec.id, alasan }); onDone(`Rekonsiliasi ${kb.nama} per ${tglID(rec.tgl)} dibuka kembali sebagai draft.`) } catch (e) { setErr(errorText(e)); setBusy(false) }
  }
  return (
    <Modal size="sm" title={`Buka kembali rekonsiliasi ${tglID(rec.tgl)}?`} onClose={onClose} dirty={!!alasan.trim()}
      footer={<><button className="btn" onClick={onClose}>Batal</button><button className="btn danger" disabled={busy || !alasan.trim()} onClick={run}>{busy ? 'Memproses…' : 'Buka kembali'}</button></>}>
      <label className="field"><span>Alasan<Req /></span><input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. salah centang transaksi" /></label>
      <p className="hint">ⓘ Transaksi yang sudah dicocokkan bisa diubah/dibatalkan lagi sampai rekonsiliasi diselesaikan ulang.</p>
      <Banner kind="err">{err}</Banner>
    </Modal>
  )
}
