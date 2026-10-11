import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { Banner, Modal, PageHead, Req, Spinner, fmtTime } from '../components/ui'
import { bulanID } from '../lib/format'

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
      <div className="card">
        <h3>Urutan tutup buku bulanan</h3>
        <ol className="checklist">
          <li>Posting atau buang semua draft di bulan itu.</li>
          <li>Posting jurnal penyesuaian (akrual, sewa terpakai, penyusutan).</li>
          <li>Periksa <Link to="/jurnal?tab=neraca-saldo">neraca saldo</Link> — harus seimbang.</li>
          <li>Kunci periode.</li>
        </ol>
        <p className="hint">ⓘ Tutup buku tahunan (jurnal penutup otomatis ke saldo laba) dibangun bersama modul laporan PSAK.</p>
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
