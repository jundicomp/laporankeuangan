import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { useAccounts } from '../components/AccountPicker'
import { Banner, Modal, PageHead, Req, Spinner, fmtTime } from '../components/ui'
import { downloadXlsx, readXlsx } from '../lib/excel'
import { parseNum, rp, today } from '../lib/format'

type BackupFile = { id: string; nama: string; url: string; dibuat: string; ukuran: number }
type BackupInfo = { folderUrl: string; otomatisAktif: boolean; files: BackupFile[] }

export function BackupPage() {
  const { can } = useSession()
  const [info, setInfo] = useState<BackupInfo | null>(null)
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const [busy, setBusy] = useState(false)
  const [opening, setOpening] = useState(false)

  const load = useCallback(() => {
    setErr('')
    call<BackupInfo>('backup.list').then(setInfo).catch((e) => setErr(errorText(e)))
  }, [])
  useEffect(() => { load() }, [load])

  const runNow = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await call<{ nama: string }>('backup.run')
      setFlash(`Backup dibuat: ${r.nama}`)
      load()
    } catch (e) {
      setErr(errorText(e))
    }
    setBusy(false)
  }

  return (
    <>
      <PageHead title="Impor & Backup" sub="Pindahkan data awal dari Excel, dan pastikan salinan data tersimpan aman di Google Drive." />
      {flash && <Banner kind="ok">{flash}</Banner>}
      <Banner kind="err">{err}</Banner>

      <div className="grid2 top">
        <div className="card stack">
          <h3>Impor dari Excel</h3>
          {can('jurnal.edit') && (
            <div className="imp-row">
              <div><b>Saldo awal akun</b><p className="hint">Kas, bank, piutang, utang, persediaan, aset, modal per tanggal mulai pakai aplikasi → menjadi satu jurnal SA.</p></div>
              <button className="btn primary" onClick={() => { setFlash(''); setOpening(true) }}>Impor saldo awal</button>
            </div>
          )}
          {can('master.edit') && (
            <>
              <div className="imp-row"><div><b>Pelanggan</b></div><Link className="btn" to="/master?tab=pelanggan">Buka & impor</Link></div>
              <div className="imp-row"><div><b>Supplier</b></div><Link className="btn" to="/master?tab=supplier">Buka & impor</Link></div>
              <div className="imp-row"><div><b>Produk & jasa</b></div><Link className="btn" to="/master?tab=produk">Buka & impor</Link></div>
            </>
          )}
          <p className="hint">ⓘ Rincian saldo awal piutang per invoice dan utang per tagihan menyusul bersama modul penjualan & pembelian.</p>
        </div>

        <div className="card stack">
          <div className="row between">
            <h3>Backup Google Drive</h3>
            {info && (info.otomatisAktif ? <span className="pill g">Otomatis aktif · tiap hari 02.00</span> : <span className="pill r">Otomatis belum aktif</span>)}
          </div>
          {info && !info.otomatisAktif && <p className="warn-text">⚠ Jalankan <code>upgradeSchema</code> sekali di Apps Script untuk mengaktifkan backup harian.</p>}
          <div className="row">
            <button className="btn primary" onClick={runNow} disabled={busy}>{busy ? 'Membuat salinan…' : 'Backup sekarang'}</button>
            {info && <a className="btn" href={info.folderUrl} target="_blank" rel="noreferrer">Buka folder Drive ↗</a>}
          </div>
          {!info ? <Spinner /> : (
            <table className="tbl compact">
              <thead><tr><th>Waktu</th><th>Jenis</th><th></th></tr></thead>
              <tbody>
                {info.files.length === 0 && <tr><td colSpan={3} className="hint">ⓘ Belum ada backup.</td></tr>}
                {info.files.slice(0, 15).map((f) => (
                  <tr key={f.id}>
                    <td>{fmtTime(f.dibuat)}</td>
                    <td>{f.nama.includes('(otomatis)') ? <span className="pill b">Otomatis</span> : <span className="pill o">Manual</span>}</td>
                    <td className="r"><a href={f.url} target="_blank" rel="noreferrer">Buka ↗</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="hint">ⓘ Disimpan 30 backup otomatis + 20 manual terbaru. Yang lebih lama masuk Sampah Drive (bisa dipulihkan 30 hari).
            Untuk memulihkan: buka salinan backup, lalu hubungi admin untuk mengarahkan aplikasi ke file tersebut.</p>
        </div>
      </div>
      {opening && <OpeningImport onClose={() => setOpening(false)} onDone={(t) => { setOpening(false); setFlash(t) }} />}
    </>
  )
}

// ---------------------------------------------------------------- impor saldo awal

type Check = { baris: number; total_debit: number; total_kredit: number; seimbang: boolean; errors: { baris: number; pesan: string; peringatan?: boolean }[]; saldoAwalLain: string[]; no?: string }
type OLine = { akun_id: string; nama: string; debit: number; kredit: number; _baris: number }

function OpeningImport({ onClose, onDone }: { onClose: () => void; onDone: (t: string) => void }) {
  const accounts = useAccounts()
  const { reload } = useSession()
  const [tgl, setTgl] = useState(`${new Date().getFullYear()}-01-01`)
  const [lines, setLines] = useState<OLine[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [check, setCheck] = useState<Check | null>(null)
  const [confirmExisting, setConfirmExisting] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const template = () => {
    const neraca = accounts.filter((a) => !a.is_header && a.aktif && ['aset', 'liabilitas', 'ekuitas'].includes(a.tipe))
    return downloadXlsx('template-saldo-awal.xlsx', [{
      name: 'Saldo awal',
      title: ['Template saldo awal', 'Isi kolom Debit untuk aset (dan prive), Kredit untuk liabilitas, modal, akumulasi penyusutan & cadangan. Kosongkan akun yang saldonya nol.'],
      columns: [
        { header: 'Kode akun', key: 'kode', width: 12 }, { header: 'Nama akun', key: 'nama', width: 40 }, { header: 'Saldo normal', key: 'normal', width: 13 },
        { header: 'Debit', key: 'debit', width: 18, money: true }, { header: 'Kredit', key: 'kredit', width: 18, money: true },
      ],
      rows: neraca.map((a) => ({ kode: a.kode, nama: a.nama, normal: a.saldo_normal === 'D' ? 'Debit' : 'Kredit', debit: '', kredit: '' })),
      note: ['Total Debit harus sama dengan total Kredit. Selisih biasanya dimasukkan ke 3-1101 Modal.'],
    }])
  }

  const runCheck = async (ls: OLine[], date: string) => {
    setBusy(true)
    setErr('')
    try {
      setCheck(await call<Check>('import.opening', { tgl: date, dryRun: true, lines: ls }))
    } catch (e) {
      setErr(errorText(e))
    }
    setBusy(false)
  }

  const pick = async (file: File) => {
    setFileName(file.name)
    setCheck(null)
    setErr('')
    try {
      const raw = await readXlsx(file, ['kode_akun', 'debit', 'kredit'])
      const ls = raw.map((r) => ({
        akun_id: String(r.kode_akun ?? '').trim(), nama: String(r.nama_akun ?? ''),
        debit: typeof r.debit === 'number' ? r.debit : parseNum(String(r.debit ?? '')) || 0,
        kredit: typeof r.kredit === 'number' ? r.kredit : parseNum(String(r.kredit ?? '')) || 0,
        _baris: Number(r._baris),
      })).filter((l) => l.debit || l.kredit)
      if (!ls.length) throw new Error('Tidak ada baris berisi angka Debit/Kredit.')
      setLines(ls)
      await runCheck(ls, tgl)
    } catch (e) {
      setErr(e instanceof Error ? e.message : errorText(e))
    }
  }

  const post = async () => {
    if (!lines) return
    setBusy(true)
    setErr('')
    try {
      const r = await call<Check>('import.opening', { tgl, lines, allowExisting: confirmExisting })
      await reload()
      onDone(`Saldo awal diposting sebagai jurnal ${r.no} (${r.baris} akun, total Rp ${rp(r.total_debit)}).`)
    } catch (e) {
      setErr(errorText(e))
      setBusy(false)
    }
  }

  const hard = check?.errors.filter((e) => !e.peringatan) ?? []
  const warn = check?.errors.filter((e) => e.peringatan) ?? []
  const diff = check ? Math.round((check.total_debit - check.total_kredit) * 100) / 100 : 0
  const blocker = !lines ? 'Pilih file Excel dulu.'
    : !check ? 'Menunggu pemeriksaan.'
    : hard.length ? `${hard.length} baris bermasalah — perbaiki di Excel.`
    : !check.seimbang ? `Debit dan kredit belum seimbang (selisih Rp ${rp(Math.abs(diff))}).`
    : check.saldoAwalLain.length && !confirmExisting ? `Sudah ada saldo awal ${check.saldoAwalLain.join(', ')} — centang konfirmasi.`
    : ''
  const realRow = (b: number) => lines?.[b - 2]?._baris ?? b
  const name = (k: string) => accounts.find((a) => a.kode === k)?.nama ?? '—'

  return (
    <Modal size="lg" title="Impor saldo awal dari Excel" onClose={onClose} dirty={!!lines && !busy}
      footer={<>
        {blocker ? <span className="warn-text">⚠ {blocker}</span> : <span className="ok-text">✓ Siap diposting sebagai jurnal SA</span>}
        <button className="btn" onClick={onClose}>Batal</button>
        <button className={`btn primary ${blocker ? 'soft' : ''}`} disabled={busy || !!blocker} onClick={post}>{busy ? 'Memproses…' : 'Posting saldo awal'}</button>
      </>}>
      <ol className="steps-list">
        <li>Unduh template — sudah berisi semua akun neraca dari COA Anda. <button className="link" onClick={template}>⇣ Unduh template</button></li>
        <li>Isi saldo per tanggal mulai pembukuan, simpan sebagai .xlsx.</li>
        <li>Pilih tanggal dan file. Sistem memeriksa keseimbangan sebelum memposting.</li>
      </ol>
      <div className="form-grid">
        <label className="field"><span>Tanggal saldo awal<Req /></span>
          <input type="date" value={tgl} max={today()} onChange={(e) => { setTgl(e.target.value); if (lines) runCheck(lines, e.target.value) }} />
        </label>
        <label className="file-drop">
          <input type="file" accept=".xlsx" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pick(f) }} />
          <span>{fileName || 'Klik untuk memilih file .xlsx'}</span>
        </label>
      </div>
      {busy && <Spinner label="Memeriksa…" />}
      <Banner kind="err">{err}</Banner>
      {lines && check && (
        <>
          <div className="card flush">
            <table className="tbl compact">
              <thead><tr><th>Baris</th><th>Akun</th><th className="r">Debit</th><th className="r">Kredit</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l._baris} className={hard.some((e) => realRow(e.baris) === l._baris) ? 'bad' : ''}>
                    <td>{l._baris}</td><td><span className="mono">{l.akun_id}</span> {name(l.akun_id)}</td>
                    <td className="r">{rp(l.debit, true)}</td><td className="r">{rp(l.kredit, true)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={2}>Total {check.seimbang ? <span className="pill g">Seimbang ✓</span> : <span className="pill r">Selisih Rp {rp(Math.abs(diff))}</span>}</td>
                <td className="r">{rp(check.total_debit)}</td><td className="r">{rp(check.total_kredit)}</td></tr></tfoot>
            </table>
          </div>
          {hard.map((e) => <p key={e.baris} className="err-text">Baris {realRow(e.baris)}: {e.pesan}</p>)}
          {warn.map((e) => <p key={'w' + e.baris} className="warn-text">⚠ Baris {realRow(e.baris)}: {e.pesan}</p>)}
          {check.saldoAwalLain.length > 0 && (
            <label className="check warn-text"><input type="checkbox" checked={confirmExisting} onChange={(e) => setConfirmExisting(e.target.checked)} />
              Sudah ada jurnal saldo awal ({check.saldoAwalLain.join(', ')}). Saya paham ini menambah saldo, bukan mengganti.</label>
          )}
        </>
      )}
    </Modal>
  )
}
