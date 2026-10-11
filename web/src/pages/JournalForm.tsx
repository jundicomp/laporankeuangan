import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { AccountPicker } from '../components/AccountPicker'
import { Banner, PageHead, Spinner } from '../components/ui'
import { bulanID, parseNum, rp, today } from '../lib/format'

type Line = { akun_id: string; memo: string; debit: string; kredit: string }
type Saved = { id: string; no: string; status: string }

const blank = (): Line => ({ akun_id: '', memo: '', debit: '', kredit: '' })
const TYPES = [
  { k: 'JU', label: 'Jurnal umum', hint: 'koreksi & transaksi non-rutin' },
  { k: 'JP', label: 'Penyesuaian', hint: 'akrual, sewa dibayar di muka, penyusutan manual' },
  { k: 'SA', label: 'Saldo awal', hint: 'saldo pembukaan saat mulai memakai aplikasi' },
]

export function JournalFormPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const { boot, can, modOn } = useSession()
  const [loading, setLoading] = useState(!!id)
  const [tgl, setTgl] = useState(today())
  const [jenis, setJenis] = useState('JU')
  const [keterangan, setKet] = useState('')
  const [referensi, setRef] = useState('')
  const [balik, setBalik] = useState(false)
  const [lines, setLines] = useState<Line[]>([blank(), blank(), blank()])
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    if (!id) return
    call<{ tgl: string; jenis: string; keterangan: string; referensi: string; balik_otomatis: boolean; status: string; alasan_batal: string; lines: { akun_id: string; memo: string; debit: number; kredit: number }[] }>('journal.get', { id })
      .then((j) => {
        if (j.status !== 'draft') return nav(`/jurnal?open=${id}`, { replace: true })
        setTgl(j.tgl); setJenis(j.jenis); setKet(j.keterangan); setRef(j.referensi); setBalik(j.balik_otomatis)
        setLines([...j.lines.map((l) => ({ akun_id: l.akun_id, memo: l.memo, debit: l.debit ? rp(l.debit) : '', kredit: l.kredit ? rp(l.kredit) : '' })), blank()])
        if (j.alasan_batal) setNote(j.alasan_batal)
      })
      .catch((e) => setErr(errorText(e)))
      .finally(() => setLoading(false))
  }, [id, nav])

  const totals = useMemo(() => {
    let d = 0, k = 0, bad = false
    lines.forEach((l) => {
      const dv = parseNum(l.debit), kv = parseNum(l.kredit)
      if (isNaN(dv) || isNaN(kv)) bad = true
      else { d += dv; k += kv }
    })
    return { d: Math.round(d * 100) / 100, k: Math.round(k * 100) / 100, bad }
  }, [lines])
  const diff = Math.round((totals.d - totals.k) * 100) / 100
  const filled = lines.filter((l) => l.akun_id || l.debit || l.kredit)
  const balanced = !totals.bad && diff === 0 && totals.d > 0 && filled.length >= 2
  const period = boot?.periods.find((p) => p.periode === tgl.slice(0, 7))
  const locked = period && period.status !== 'buka'
  const needApproval = modOn('approval') && !can('jurnal.approve')

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => {
    const next = ls.map((l, j) => (j === i ? { ...l, ...patch } : l))
    if (i === next.length - 1 && (patch.akun_id || patch.debit || patch.kredit)) next.push(blank())
    return next
  })

  /** Klik kolom kosong di sisi yang kurang → otomatis terisi selisihnya. */
  const fillBalance = (i: number, side: 'debit' | 'kredit') => {
    const l = lines[i]
    if (l.debit || l.kredit || !l.akun_id) return
    if (side === 'debit' && diff < 0) setLine(i, { debit: rp(-diff) })
    if (side === 'kredit' && diff > 0) setLine(i, { kredit: rp(diff) })
  }

  const save = async (submit: boolean) => {
    setErr('')
    setBusy(submit ? 'post' : 'draft')
    try {
      const payload = {
        id, tgl, jenis, keterangan, referensi, balik_otomatis: jenis === 'JP' && balik, submit,
        lines: lines.map((l) => ({ akun_id: l.akun_id, memo: l.memo, debit: parseNum(l.debit) || 0, kredit: parseNum(l.kredit) || 0 })),
      }
      const r = await call<Saved>('journal.save', payload)
      const msg = r.status === 'posted' ? `Jurnal ${r.no} diposting.` : r.status === 'menunggu' ? 'Jurnal diajukan, menunggu persetujuan.' : 'Draft disimpan.'
      nav(`/jurnal?open=${r.id}&msg=${encodeURIComponent(msg)}`)
    } catch (e) {
      setErr(errorText(e))
      setBusy('')
    }
  }

  if (loading) return <Spinner />

  return (
    <>
      <PageHead title={id ? 'Edit draft jurnal' : 'Jurnal baru'} sub="Jurnal yang sudah diposting tidak bisa diedit — koreksi dengan jurnal baru atau dibatalkan dengan alasan.">
        <Link className="btn" to="/jurnal">Batal</Link>
        <button className="btn" onClick={() => save(false)} disabled={!!busy || !keterangan}>{busy === 'draft' ? 'Menyimpan…' : 'Simpan draft'}</button>
        <button className="btn primary" onClick={() => save(true)} disabled={!!busy || !balanced || !keterangan || !!locked}>
          {busy === 'post' ? 'Memproses…' : needApproval ? 'Ajukan approval' : 'Posting'}
        </button>
      </PageHead>
      {note && <Banner kind="warn">{note}</Banner>}
      <div className="card">
        <div className="jf-head">
          <label className="field"><span>Tanggal</span><input type="date" value={tgl} onChange={(e) => setTgl(e.target.value)} /></label>
          <label className="field"><span>Jenis</span>
            <select value={jenis} onChange={(e) => setJenis(e.target.value)}>
              {TYPES.map((t) => <option key={t.k} value={t.k}>{t.k} · {t.label}</option>)}
            </select>
          </label>
          <label className="field grow"><span>Keterangan</span><input value={keterangan} onChange={(e) => setKet(e.target.value)} placeholder="mis. Penyesuaian sewa terpakai Oktober" /></label>
          <label className="field"><span>Referensi</span><input value={referensi} onChange={(e) => setRef(e.target.value)} placeholder="no. bukti / memo" /></label>
        </div>
        <p className="muted small">{TYPES.find((t) => t.k === jenis)?.hint}{boot && ` · nomor dibuat otomatis saat posting`}</p>
        {locked && <Banner kind="err">Periode {bulanID(tgl.slice(0, 7))} sedang dikunci. Draft tetap bisa disimpan, tapi posting butuh periode dibuka owner.</Banner>}
      </div>

      <div className="card flush">
        <table className="tbl jf-lines">
          <thead>
            <tr><th className="n">#</th><th>Akun</th><th>Memo baris</th><th className="r">Debit</th><th className="r">Kredit</th><th className="n"></th></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="n muted">{i + 1}</td>
                <td className="acc"><AccountPicker value={l.akun_id} onChange={(k) => setLine(i, { akun_id: k })} /></td>
                <td><input value={l.memo} onChange={(e) => setLine(i, { memo: e.target.value })} placeholder="opsional" /></td>
                <td className="num"><input inputMode="decimal" value={l.debit} onFocus={() => fillBalance(i, 'debit')}
                  onChange={(e) => setLine(i, { debit: e.target.value, kredit: e.target.value ? '' : l.kredit })}
                  onBlur={(e) => { const v = parseNum(e.target.value); if (v) setLine(i, { debit: rp(v) }) }} /></td>
                <td className="num"><input inputMode="decimal" value={l.kredit} onFocus={() => fillBalance(i, 'kredit')}
                  onChange={(e) => setLine(i, { kredit: e.target.value, debit: e.target.value ? '' : l.debit })}
                  onBlur={(e) => { const v = parseNum(e.target.value); if (v) setLine(i, { kredit: rp(v) }) }} /></td>
                <td className="n">{lines.length > 2 && <button className="x" title="Hapus baris" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>×</button>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td></td>
              <td colSpan={2}><button className="link" onClick={() => setLines((ls) => [...ls, blank()])}>+ Tambah baris</button></td>
              <td className="r tot">{rp(totals.d)}</td>
              <td className="r tot">{rp(totals.k)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        <div className="jf-foot">
          {totals.bad ? <span className="pill r">Ada angka tidak valid</span>
            : balanced ? <span className="pill g">Seimbang ✓</span>
            : diff !== 0 ? <span className="pill o">Selisih {rp(Math.abs(diff))} di sisi {diff > 0 ? 'kredit' : 'debit'}</span>
            : <span className="pill n">Isi minimal 2 baris</span>}
          {jenis === 'JP' && (
            <label className="check"><input type="checkbox" checked={balik} onChange={(e) => setBalik(e.target.checked)} /> Buat jurnal pembalik otomatis tanggal 1 bulan berikutnya</label>
          )}
          <span className="muted small">Tip: setelah memilih akun, klik kolom debit/kredit yang kosong untuk mengisi selisihnya otomatis.</span>
        </div>
      </div>
      <Banner kind="err">{err}</Banner>
    </>
  )
}
