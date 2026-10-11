import { useEffect, useState, type FormEvent } from 'react'
import { call, callTimed, errorText, getApiUrl, setApiUrl } from '../api/client'
import { useSession, type Module } from '../auth/session'
import { Banner, Field, PageHead } from '../components/ui'

const GROUPS: { title: string; kode: string[] }[] = [
  { title: 'Inti — selalu aktif', kode: ['akuntansi', 'kasbank', 'laporan', 'akses', 'backup'] },
  { title: 'Penjualan', kode: ['penjualan', 'penawaran', 'piutang'] },
  { title: 'Pembelian', kode: ['pembelian', 'po', 'utang'] },
  { title: 'Persediaan', kode: ['persediaan', 'multigudang', 'batch'] },
  { title: 'SDM, aset & pajak', kode: ['aset', 'payroll', 'pajak'] },
  { title: 'Kontrol & laporan', kode: ['approval', 'cabang', 'proyek', 'anggaran', 'rekonbank', 'bankable', 'multiperusahaan'] },
]

type Change = { kode: string; nama: string; aktif: boolean }

export function SettingsPage() {
  const { can } = useSession()
  const [tab, setTab] = useState<'modul' | 'perusahaan' | 'diag'>(can('modul.manage') ? 'modul' : 'perusahaan')
  return (
    <>
      <PageHead title="Pengaturan" />
      <div className="tabs">
        {can('modul.manage') && <button className={tab === 'modul' ? 'on' : ''} onClick={() => setTab('modul')}>Aktivasi modul</button>}
        <button className={tab === 'perusahaan' ? 'on' : ''} onClick={() => setTab('perusahaan')}>Perusahaan</button>
        <button className={tab === 'diag' ? 'on' : ''} onClick={() => setTab('diag')}>Koneksi & diagnostik</button>
      </div>
      {tab === 'modul' && <ModulesTab />}
      {tab === 'perusahaan' && <CompanyTab />}
      {tab === 'diag' && <DiagTab />}
    </>
  )
}

function ModulesTab() {
  const { boot, setModules } = useSession()
  const mods = boot?.modules ?? []
  const [pending, setPending] = useState<{ target: Module; changes: Change[] } | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const byKode = Object.fromEntries(mods.map((m) => [m.kode, m]))

  const apply = (changes: Change[]) => {
    setModules(mods.map((m) => {
      const c = changes.find((x) => x.kode === m.kode)
      return c ? { ...m, aktif: c.aktif } : m
    }))
  }

  const toggle = async (m: Module) => {
    if (m.wajib) return
    setMsg(null)
    setBusy(m.kode)
    try {
      const { changes } = await call<{ changes: Change[] }>('module.set', { kode: m.kode, aktif: !m.aktif, preview: true })
      if (changes.length > 1 || m.aktif) setPending({ target: m, changes })
      else await commit(m)
    } catch (e) {
      setMsg({ kind: 'err', text: errorText(e) })
    }
    setBusy('')
  }

  const commit = async (m: Module) => {
    setBusy(m.kode)
    try {
      const { changes } = await call<{ changes: Change[] }>('module.set', { kode: m.kode, aktif: !m.aktif })
      apply(changes)
      const others = changes.filter((c) => c.kode !== m.kode)
      setMsg({ kind: 'ok', text: `${m.nama} ${!m.aktif ? 'diaktifkan' : 'dinonaktifkan'}${others.length ? `, ikut ${others[0].aktif ? 'aktif' : 'nonaktif'}: ${others.map((o) => o.nama).join(', ')}` : ''}. Menu sudah menyesuaikan.` })
    } catch (e) {
      setMsg({ kind: 'err', text: errorText(e) })
    }
    setPending(null)
    setBusy('')
  }

  const deps = (m: Module) => m.bergantung_pada
    ? 'butuh: ' + m.bergantung_pada.split(',').map((g) => g.split('|').map((k) => byKode[k]?.nama ?? k).join(' atau ')).join(', ')
    : ''

  return (
    <>
      <p className="muted">Modul inti menjaga buku tetap seimbang dan bisa diaudit, jadi selalu aktif. Modul lain bisa dinyalakan atau dimatikan kapan saja — data lama tidak pernah dihapus.</p>
      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
      <div className="mod-grid">
        {GROUPS.map((g) => (
          <div className="card" key={g.title}>
            <div className="mod-grp">{g.title}</div>
            {g.kode.map((k) => byKode[k]).filter(Boolean).map((m) => (
              <button key={m.kode} className="mod-row" onClick={() => toggle(m)} disabled={m.wajib || !!busy}>
                <span className={`tg ${m.wajib ? 'lock' : m.aktif ? 'on' : ''} ${busy === m.kode ? 'busy' : ''}`} />
                <span className="nm"><b>{m.nama}</b>{deps(m) && <small>{deps(m)}</small>}</span>
                {m.wajib && <span className="pill n">Wajib</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
      {pending && (
        <div className="modal-bg" onClick={() => setPending(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{pending.target.aktif ? 'Nonaktifkan' : 'Aktifkan'} "{pending.target.nama}"?</h3>
            <ul>
              {pending.changes.filter((c) => c.kode !== pending.target.kode).map((c) => (
                <li key={c.kode}>Ikut {c.aktif ? 'aktif' : 'nonaktif'}: <b>{c.nama}</b></li>
              ))}
              {pending.target.aktif && <li>Menu terkait disembunyikan, <b>data yang sudah ada tidak dihapus</b>.</li>}
              {pending.target.aktif && <li>Bisa diaktifkan kembali kapan saja.</li>}
            </ul>
            <div className="row end">
              <button className="btn" onClick={() => setPending(null)}>Batal</button>
              <button className={`btn ${pending.target.aktif ? 'warn' : 'primary'}`} onClick={() => commit(pending.target)} disabled={!!busy}>
                {pending.target.aktif ? 'Nonaktifkan' : 'Aktifkan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function CompanyTab() {
  const { boot, can, reload } = useSession()
  const c = boot?.company ?? {}
  const [f, setF] = useState({ nama: c.nama ?? '', npwp: c.npwp ?? '', alamat: c.alamat ?? '', telepon: c.telepon ?? '', email: c.email ?? '' })
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const editable = can('setting.edit')
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      await call('company.update', f)
      await reload()
      setMsg({ kind: 'ok', text: 'Profil perusahaan disimpan.' })
    } catch (e2) {
      setMsg({ kind: 'err', text: errorText(e2) })
    }
    setBusy(false)
  }

  return (
    <form className="card stack narrow" onSubmit={save}>
      <Field label="Nama perusahaan" value={f.nama} onChange={set('nama')} required disabled={!editable} />
      <div className="grid2">
        <Field label="NPWP" value={f.npwp} onChange={set('npwp')} disabled={!editable} />
        <Field label="Telepon" value={f.telepon} onChange={set('telepon')} disabled={!editable} />
      </div>
      <Field label="Alamat" value={f.alamat} onChange={set('alamat')} disabled={!editable} />
      <Field label="Email" type="email" value={f.email} onChange={set('email')} disabled={!editable} />
      <div className="grid2">
        <Field label="Kerangka laporan" value={c.kerangka_sak ?? 'SAK EP'} disabled hint="Pilihan SAK EMKM / SAK EP / PSAK menyusul di Langkah 3" />
        <Field label="Metode HPP" value={c.metode_hpp ?? 'rata-rata'} disabled />
      </div>
      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
      {editable && <button className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>}
    </form>
  )
}

type Info = { spreadsheetName: string; spreadsheetUrl: string; sheets: string[]; schemaVersion: string | null }

function DiagTab() {
  const [url, setUrl] = useState(getApiUrl())
  const [info, setInfo] = useState<Info | null>(null)
  const [ping, setPing] = useState('')
  const [err, setErr] = useState('')

  const run = async () => {
    setErr('')
    setPing('mengukur…')
    try {
      const times: number[] = []
      for (let i = 0; i < 3; i++) times.push((await callTimed('system.ping')).totalMs)
      setPing(`rata-rata ${Math.round(times.reduce((a, b) => a + b) / times.length)} ms`)
      setInfo((await callTimed<Info>('system.info')).data)
    } catch (e) {
      setErr(errorText(e))
      setPing('')
    }
  }
  useEffect(() => {
    run()
  }, [])

  return (
    <div className="card stack narrow">
      <Field label="URL server (Apps Script /exec)" value={url} onChange={(e) => setUrl(e.target.value)} hint="Disimpan di browser ini. Default diambil dari variabel VITE_API_URL di GitHub." />
      <div className="row">
        <button className="btn" onClick={() => { setApiUrl(url); location.reload() }}>Simpan & muat ulang</button>
        <button className="btn" onClick={run}>Uji ulang</button>
      </div>
      <Banner kind="err">{err}</Banner>
      <table className="tbl kv">
        <tbody>
          <tr><td>Kecepatan server</td><td>{ping || '—'}</td></tr>
          <tr><td>Spreadsheet</td><td>{info ? <a href={info.spreadsheetUrl} target="_blank" rel="noreferrer">{info.spreadsheetName} ↗</a> : '—'}</td></tr>
          <tr><td>Versi skema</td><td>{info?.schemaVersion ?? '—'}</td></tr>
          <tr><td>Jumlah tab</td><td>{info?.sheets.length ?? '—'}</td></tr>
        </tbody>
      </table>
    </div>
  )
}
