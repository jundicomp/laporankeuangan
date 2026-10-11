import { useEffect, useState, type FormEvent } from 'react'
import { call, callTimed, errorText, getApiUrl, setApiUrl } from '../api/client'
import { useSession, type Module } from '../auth/session'
import { Banner, Field, Modal, PageHead } from '../components/ui'

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
      <p className="hint">ⓘ Modul inti menjaga buku tetap seimbang dan bisa diaudit, jadi selalu aktif. Modul lain bisa dinyalakan atau dimatikan kapan saja — data lama tidak pernah dihapus.</p>
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
        <Modal
          size="sm"
          title={`${pending.target.aktif ? 'Nonaktifkan' : 'Aktifkan'} "${pending.target.nama}"?`}
          onClose={() => setPending(null)}
          footer={<><button className="btn" onClick={() => setPending(null)}>Batal</button><button className={`btn ${pending.target.aktif ? 'danger' : 'primary'}`} onClick={() => commit(pending.target)} disabled={!!busy}>{busy ? 'Memproses…' : pending.target.aktif ? 'Nonaktifkan' : 'Aktifkan'}</button></>}
        >
          <ul className="plain-list">
            {pending.changes.filter((c) => c.kode !== pending.target.kode).map((c) => (
              <li key={c.kode} className="warn-text">⚠ Ikut {c.aktif ? 'aktif' : 'nonaktif'}: <b>{c.nama}</b></li>
            ))}
            {pending.target.aktif && <li>Menu terkait disembunyikan, <b>data yang sudah ada tidak dihapus</b>.</li>}
            {pending.target.aktif && <li>Bisa diaktifkan kembali kapan saja.</li>}
          </ul>
        </Modal>
      )}
    </>
  )
}

function CompanyTab() {
  const { boot, can, reload } = useSession()
  const c = boot?.company ?? {}
  const [open, setOpen] = useState(false)
  const [flash, setFlash] = useState('')
  const rows: [string, string][] = [
    ['Nama perusahaan', c.nama], ['NPWP', c.npwp], ['Alamat', c.alamat], ['Telepon', c.telepon], ['Email', c.email],
    ['Kerangka laporan', c.kerangka_sak || 'SAK EP'], ['Metode HPP', c.metode_hpp || 'rata-rata'],
  ]
  return (
    <div className="card stack narrow">
      {flash && <Banner kind="ok">{flash}</Banner>}
      <table className="tbl kv"><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v || <span className="warn-text">belum diisi</span>}</td></tr>)}</tbody></table>
      {can('setting.edit') && <div><button className="btn primary" onClick={() => { setFlash(''); setOpen(true) }}>Ubah profil perusahaan</button></div>}
      {open && <CompanyForm initial={c} onClose={() => setOpen(false)} onSaved={async () => { await reload(); setOpen(false); setFlash('Profil perusahaan disimpan.') }} />}
    </div>
  )
}

function CompanyForm({ initial, onClose, onSaved }: { initial: Record<string, string>; onClose: () => void; onSaved: () => Promise<void> }) {
  const start = { nama: initial.nama ?? '', npwp: initial.npwp ?? '', alamat: initial.alamat ?? '', telepon: initial.telepon ?? '', email: initial.email ?? '' }
  const [f, setF] = useState(start)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!f.nama.trim()) return setErr('Nama perusahaan wajib diisi.')
    setBusy(true)
    setErr('')
    try {
      await call('company.update', f)
      await onSaved()
    } catch (e2) {
      setErr(errorText(e2))
      setBusy(false)
    }
  }
  return (
    <Modal title="Ubah profil perusahaan" onClose={onClose} dirty={!busy && JSON.stringify(f) !== JSON.stringify(start)}
      footer={<><button className="btn" onClick={onClose}>Batal</button><button type="submit" form="company-form" className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button></>}>
      <form id="company-form" className="stack" onSubmit={save}>
        <Field label="Nama perusahaan" value={f.nama} onChange={set('nama')} required />
        <div className="grid2">
          <Field label="NPWP" value={f.npwp} onChange={set('npwp')} />
          <Field label="Telepon" value={f.telepon} onChange={set('telepon')} />
        </div>
        <Field label="Alamat" value={f.alamat} onChange={set('alamat')} />
        <Field label="Email" type="email" value={f.email} onChange={set('email')} />
        <p className="hint">ⓘ Pilihan kerangka laporan (SAK EMKM / SAK EP / PSAK) dan metode HPP menyusul bersama modul laporan.</p>
        <Banner kind="err">{err}</Banner>
      </form>
    </Modal>
  )
}

type Info = { spreadsheetName: string; spreadsheetUrl: string; sheets: string[]; schemaVersion: string | null }

function DiagTab() {
  const [url, setUrl] = useState(getApiUrl())
  const [info, setInfo] = useState<Info | null>(null)
  const [ping, setPing] = useState('')
  const [err, setErr] = useState('')
  const [editUrl, setEditUrl] = useState(false)

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
      <table className="tbl kv">
        <tbody>
          <tr><td>URL server</td><td className="mono break">{getApiUrl() || '—'}</td></tr>
          <tr><td>Kecepatan server</td><td>{ping || '—'}</td></tr>
          <tr><td>Spreadsheet</td><td>{info ? <a href={info.spreadsheetUrl} target="_blank" rel="noreferrer">{info.spreadsheetName} ↗</a> : '—'}</td></tr>
          <tr><td>Versi skema</td><td>{info?.schemaVersion ?? '—'}</td></tr>
          <tr><td>Jumlah tab</td><td>{info?.sheets.length ?? '—'}</td></tr>
        </tbody>
      </table>
      <Banner kind="err">{err}</Banner>
      <div className="row">
        <button className="btn" onClick={run}>Uji ulang</button>
        <button className="btn" onClick={() => { setUrl(getApiUrl()); setEditUrl(true) }}>Ganti URL server</button>
      </div>
      {editUrl && (
        <Modal size="sm" title="Ganti URL server" onClose={() => setEditUrl(false)} dirty={url !== getApiUrl()}
          footer={<><button className="btn" onClick={() => setEditUrl(false)}>Batal</button><button className="btn primary" disabled={!url.trim()} onClick={() => { setApiUrl(url); location.reload() }}>Simpan & muat ulang</button></>}>
          <Field label="URL Web App Apps Script (/exec)" value={url} onChange={(e) => setUrl(e.target.value)} required hint="Disimpan di browser ini saja. Default diambil dari variabel VITE_API_URL di GitHub." />
          <p className="warn-text">⚠ URL yang salah membuat aplikasi tidak bisa terhubung sampai diperbaiki.</p>
        </Modal>
      )}
    </div>
  )
}
