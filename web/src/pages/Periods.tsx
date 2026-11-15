import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { Banner, Modal, PageHead, Req, Spinner, fmtTime } from '../components/ui'
import { bulanID, rp, tglID } from '../lib/format'

type P = { periode: string; status: string; diubah_oleh: string; diubah_pada: string; alasan: string; posted: number; draft: number }

export function PeriodsPage() {
  const { can, reload } = useSession()
  const [year, setYear] = useState(new Date().getFullYear())
  const [rows, setRows] = useState<P[] | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [reopen, setReopen] = useState<P | null>(null)
  const [alasan, setAlasan] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(() => {
    setRows(null)
    call<P[]>('period.list', { tahun: year }).then(setRows).catch((e) => setErr(errorText(e)))
  }, [year])
  useEffect(() => { load() }, [load])

  const set = async (p: P, status: string, why = '') => {
    setBusy(p.periode)
    setErr('')
    setMsg('')
    try {
      await call('period.set', { periode: p.periode, status, alasan: why })
      setMsg(`${bulanID(p.periode)} ${status === 'kunci' ? 'dikunci' : 'dibuka kembali'}.`)
      setReopen(null)
      setAlasan('')
      load()
      reload()
    } catch (e) {
      setErr(errorText(e))
    }
    setBusy('')
  }

  return (
    <>
      <PageHead title="Tutup Buku" sub="Kunci periode yang sudah selesai diperiksa supaya angkanya tidak berubah lagi. Membuka kembali hanya bisa oleh owner, dengan alasan.">
        <div className="row">
          <button className="btn" onClick={() => setYear(year - 1)}>‹</button>
          <b className="year">{year}</b>
          <button className="btn" onClick={() => setYear(year + 1)}>›</button>
        </div>
      </PageHead>
      {msg && <Banner kind="ok">{msg}</Banner>}
      <Banner kind="err">{err}</Banner>
      {!rows ? <Spinner /> : (
        <div className="period-grid">
          {rows.map((p) => {
            const locked = p.status !== 'buka'
            return (
              <div key={p.periode} className={`card period ${locked ? 'locked' : ''}`}>
                <div className="period-top">
                  <b>{bulanID(p.periode)}</b>
                  <span className={`pill ${locked ? 'n' : 'g'}`}>{locked ? '🔒 Dikunci' : 'Terbuka'}</span>
                </div>
                <div className="small">{p.posted} jurnal posted{p.draft ? <> · <Link to="/jurnal?tab=daftar" className="warn-text">{p.draft} draft belum diposting</Link></> : ''}</div>
                {p.diubah_oleh && p.diubah_oleh !== 'setup' && <div className="muted small">{locked ? 'Dikunci' : 'Dibuka'} {p.diubah_oleh} · {fmtTime(p.diubah_pada)}{p.alasan ? ` · ${p.alasan}` : ''}</div>}
                <div className="row">
                  {!locked && can('periode.lock') && (
                    <button className="btn" disabled={!!busy} onClick={() => set(p, 'kunci')} title={p.draft ? 'Masih ada draft di periode ini' : ''}>
                      {busy === p.periode ? '…' : 'Kunci'}
                    </button>
                  )}
                  {locked && can('periode.reopen') && <button className="btn" onClick={() => { setReopen(p); setAlasan('') }}>Buka kembali</button>}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <YearClosing year={year} onDone={(t) => { setMsg(t); load(); reload() }} />
      <div className="card">
        <h3>Urutan tutup buku bulanan</h3>
        <ol className="checklist">
          <li>Posting atau buang semua draft di bulan itu.</li>
          <li>Posting jurnal penyesuaian (akrual, sewa terpakai, penyusutan).</li>
          <li>Periksa <Link to="/jurnal?tab=neraca-saldo">neraca saldo</Link> — harus seimbang.</li>
          <li>Kunci periode.</li>
        </ol>
        <p className="hint">ⓘ Akhir tahun: setelah Desember beres, buat <b>jurnal penutup</b> di atas, lalu kunci Desember. Cek hasilnya di <Link to="/laporan?tab=ekuitas">laporan perubahan ekuitas</Link> dan <Link to="/laporan?tab=calk">CALK</Link>.</p>
      </div>
      {reopen && (
        <Modal
          size="sm"
          title={`Buka kembali ${bulanID(reopen.periode)}?`}
          onClose={() => setReopen(null)}
          dirty={!!alasan.trim()}
          footer={<><button className="btn" onClick={() => setReopen(null)}>Batal</button><button className="btn danger" disabled={!alasan.trim() || !!busy} onClick={() => set(reopen, 'buka', alasan)}>{busy ? 'Memproses…' : 'Buka kembali'}</button></>}
        >
          <p className="warn-text">⚠ Laporan bulan ini bisa berubah lagi setelah dibuka. Alasan dicatat di audit log.</p>
          <label className="field"><span>Alasan<Req /></span><input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. koreksi invoice yang terlewat" /></label>
          <Banner kind="err">{err}</Banner>
        </Modal>
      )}
    </>
  )
}

type ClosingLine = { akun_id: string; nama: string; memo: string; debit: number; kredit: number }
type Preview = {
  from: string; to: string; lines: ClosingLine[]; laba: number; prive: number; sudah: { id: string; no: string; tgl: string } | null
  peringatan: { draft: number; akhir_terkunci: boolean; belum_berakhir: boolean }
}

/** Jurnal penutup tahunan: pendapatan & beban → ikhtisar laba rugi → saldo laba; prive → saldo laba. */
function YearClosing({ year, onDone }: { year: number; onDone: (t: string) => void }) {
  const { can } = useSession()
  const [pv, setPv] = useState<Preview | null>(null)
  const [err, setErr] = useState('')
  const [ask, setAsk] = useState<'' | 'post' | 'void'>('')
  const [prive, setPrive] = useState(true)
  const [ignoreDraft, setIgnoreDraft] = useState(false)
  const [alasan, setAlasan] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const tanggal = `${year}-06-30`
  const load = useCallback(() => {
    setPv(null); setErr('')
    call<Preview>('closing.preview', { tanggal, tutupPrive: prive }).then(setPv).catch((e) => setErr(errorText(e)))
  }, [tanggal, prive])
  useEffect(() => { load() }, [load])

  const run = async () => {
    setBusy(true); setErr('')
    try {
      if (ask === 'post') {
        const r = await call<{ no: string; laba: number }>('closing.post', { tanggal, tutupPrive: prive, abaikanDraft: ignoreDraft })
        onDone(`Jurnal penutup ${r.no} dibuat. ${r.laba >= 0 ? 'Laba' : 'Rugi'} Rp ${rp(Math.abs(r.laba))} dipindahkan ke saldo laba. Jangan lupa kunci periode Desember.`)
      } else {
        const r = await call<{ pembalik: string }>('closing.void', { tanggal, alasan })
        onDone(`Jurnal penutup dibatalkan (pembalik ${r.pembalik}). Tahun buku ini bisa ditutup ulang.`)
      }
      setAsk(''); setAlasan(''); load()
    } catch (e) { setErr(errorText(e)) }
    setBusy(false)
  }

  const blocker = !pv ? '' : pv.sudah ? '' : pv.peringatan.belum_berakhir ? `Tahun buku baru berakhir ${tglID(pv.to)}.`
    : pv.peringatan.akhir_terkunci ? `Periode ${bulanID(pv.to.slice(0, 7))} sudah dikunci — buka dulu untuk membuat jurnal penutup.`
    : !pv.lines.length ? 'Tidak ada saldo pendapatan/beban untuk ditutup.' : ''

  return (
    <div className="card closing">
      <div className="row between">
        <h3>Tutup buku tahunan {pv ? `· ${tglID(pv.from)} – ${tglID(pv.to)}` : year}</h3>
        {pv?.sudah ? <span className="pill g">✓ Sudah ditutup · {pv.sudah.no}</span> : <span className="pill n">Belum ditutup</span>}
      </div>
      <Banner kind="err">{err}</Banner>
      {!pv ? (!err && <Spinner />) : (
        <>
          {pv.sudah ? (
            <p>Jurnal penutup <Link to={`/jurnal?open=${pv.sudah.id}`} className="mono">{pv.sudah.no}</Link> bertanggal {tglID(pv.sudah.tgl)} sudah memindahkan laba rugi tahun ini ke saldo laba.
              Laporan laba rugi tahun ini tetap bisa dilihat seperti biasa.</p>
          ) : (
            <>
              <div className="kpis">
                <div className="card kpi"><span>{pv.laba >= 0 ? 'Laba bersih' : 'Rugi bersih'} tahun ini</span><b className={pv.laba < 0 ? 'neg' : ''}>Rp {rp(pv.laba)}</b><small className="muted">ditutup ke 3-2101 Saldo laba</small></div>
                <div className="card kpi"><span>Prive / distribusi</span><b>Rp {rp(pv.prive)}</b><small className="muted">{prive ? 'ikut ditutup ke saldo laba' : 'tidak ditutup'}</small></div>
              </div>
              {pv.peringatan.draft > 0 && <p className="warn-text">⚠ {pv.peringatan.draft} jurnal di tahun ini masih draft / menunggu persetujuan. <Link to="/jurnal?tab=daftar">Periksa</Link></p>}
              {blocker && <p className="warn-text">⚠ {blocker}</p>}
              <button className="link" onClick={() => setOpen(!open)}>{open ? '▾ Sembunyikan' : '▸ Lihat'} rancangan jurnal penutup ({pv.lines.length} baris)</button>
              {open && (
                <table className="tbl compact">
                  <thead><tr><th>Akun</th><th>Keterangan</th><th className="r">Debit</th><th className="r">Kredit</th></tr></thead>
                  <tbody>{pv.lines.map((l, i) => <tr key={i}><td><span className="mono">{l.akun_id}</span> {l.nama}</td><td className="small">{l.memo}</td><td className="r">{l.debit ? rp(l.debit) : ''}</td><td className="r">{l.kredit ? rp(l.kredit) : ''}</td></tr>)}</tbody>
                </table>
              )}
            </>
          )}
          <div className="row">
            {!pv.sudah && can('periode.lock') && <button className={`btn primary ${blocker ? 'soft' : ''}`} onClick={() => (blocker ? setErr(blocker) : setAsk('post'))}>Buat jurnal penutup</button>}
            {pv.sudah && can('periode.reopen') && <button className="btn warn" onClick={() => setAsk('void')}>Batalkan jurnal penutup</button>}
            {!can('periode.lock') && !pv.sudah && <span className="hint">ⓘ Jurnal penutup dibuat oleh peran dengan izin tutup buku (owner/accounting).</span>}
          </div>
        </>
      )}
      {ask && pv && (
        <Modal size="sm" title={ask === 'post' ? 'Buat jurnal penutup?' : 'Batalkan jurnal penutup?'} onClose={() => setAsk('')} dirty={ask === 'void' && !!alasan.trim()}
          footer={<><button className="btn" onClick={() => setAsk('')}>Batal</button>
            <button className={`btn ${ask === 'post' ? 'primary' : 'danger'}`} disabled={busy || (ask === 'void' && !alasan.trim())} onClick={run}>{busy ? 'Memproses…' : ask === 'post' ? 'Buat jurnal penutup' : 'Batalkan'}</button></>}>
          {ask === 'post' ? (
            <div className="stack">
              <p>Jurnal penutup bertanggal <b>{tglID(pv.to)}</b>: semua akun pendapatan & beban dinolkan lewat 3-9999 Ikhtisar laba rugi, lalu {pv.laba >= 0 ? 'laba' : 'rugi'} Rp {rp(Math.abs(pv.laba))} masuk ke 3-2101 Saldo laba.</p>
              <label className="check"><input type="checkbox" checked={prive} onChange={(e) => setPrive(e.target.checked)} /> Tutup juga prive / distribusi (Rp {rp(pv.prive)}) ke saldo laba</label>
              {pv.peringatan.draft > 0 && <label className="check"><input type="checkbox" checked={ignoreDraft} onChange={(e) => setIgnoreDraft(e.target.checked)} /> Saya tahu masih ada {pv.peringatan.draft} draft, tetap lanjutkan</label>}
              <p className="hint">ⓘ Bisa dibatalkan owner kapan saja selama periode {bulanID(pv.to.slice(0, 7))} belum dikunci.</p>
            </div>
          ) : (
            <>
              <label className="field"><span>Alasan<Req /></span><input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. ada koreksi penyesuaian Desember" /></label>
              <p className="hint">ⓘ Sistem membuat jurnal pembalik; laba kembali tampil sebagai laba tahun berjalan sampai ditutup ulang.</p>
            </>
          )}
          <Banner kind="err">{err}</Banner>
        </Modal>
      )}
    </div>
  )
}
