import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { call, callTimed, errorText, getApiUrl, setApiUrl } from '../api/client'
import { useSession, type Module } from '../auth/session'
import { companyAccounts, type Rekening } from '../components/InvoiceDoc'
import { loadImage, trimImage } from '../lib/image'
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
  const st = boot?.settings ?? {}
  const [open, setOpen] = useState(false)
  const [flash, setFlash] = useState('')
  const rek = companyAccounts(c.rekening_json)
  const rows: [string, ReactNode][] = [
    ['Logo', c.logo_url ? <img src={c.logo_url} alt="logo" className="logo-prev" /> : ''],
    ['Nama perusahaan', c.nama], ['NPWP', c.npwp], ['Alamat', c.alamat], ['Telepon', c.telepon], ['Email', c.email],
    ['Rekening di invoice', rek.map((r, i) => <div key={i}>{r.bank} {r.no}{r.atas_nama && ` a.n. ${r.atas_nama}`}</div>)],
    ['Tarif PPN default', st.ppn_tarif ? `${st.ppn_tarif}%` : ''], ['Jatuh tempo default', st.top_default ? `${st.top_default} hari` : ''],
    ['Penanda tangan invoice', [st.invoice_ttd_nama, st.invoice_ttd_jabatan].filter(Boolean).join(' · ')],
    ['Catatan kaki invoice', st.invoice_catatan],
    ['Kerangka laporan', c.kerangka_sak || 'SAK EP'], ['Metode HPP', c.metode_hpp || 'rata-rata'],
  ]
  return (
    <div className="card stack narrow">
      {flash && <Banner kind="ok">{flash}</Banner>}
      <table className="tbl kv"><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td>{(Array.isArray(v) ? v.length : v) ? v : <span className="warn-text">belum diisi</span>}</td></tr>)}</tbody></table>
      {can('setting.edit') && <div><button className="btn primary" onClick={() => { setFlash(''); setOpen(true) }}>Ubah profil perusahaan</button></div>}
      {open && <CompanyForm initial={c} settings={st} onClose={() => setOpen(false)} onSaved={async () => { await reload(); setOpen(false); setFlash('Profil perusahaan disimpan.') }} />}
    </div>
  )
}

/** Perkecil logo di browser supaya muat di satu sel spreadsheet (maks ±45 ribu karakter). */
async function shrinkLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    // buang tepi putih/transparan dulu supaya logo tampil penuh di kop
    const img = await loadImage(await trimImage(url))
    for (const [maxW, maxH] of [[360, 140], [260, 100], [180, 70]]) {
      const r = Math.min(1, maxW / img.width, maxH / img.height)
      const cv = document.createElement('canvas')
      cv.width = Math.max(1, Math.round(img.width * r))
      cv.height = Math.max(1, Math.round(img.height * r))
      cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height)
      const png = cv.toDataURL('image/png')
      if (png.length < 45000) return png
      const ctx = cv.getContext('2d')!
      ctx.globalCompositeOperation = 'destination-over'
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, cv.width, cv.height)
      const jpg = cv.toDataURL('image/jpeg', 0.85)
      if (jpg.length < 45000) return jpg
    }
    throw new Error('Logo terlalu rumit untuk diperkecil. Coba gambar lain.')
  } finally {
    URL.revokeObjectURL(url)
  }
}

function CompanyForm({ initial, settings, onClose, onSaved }: { initial: Record<string, string>; settings: Record<string, string>; onClose: () => void; onSaved: () => Promise<void> }) {
  const start = {
    nama: initial.nama ?? '', npwp: initial.npwp ?? '', alamat: initial.alamat ?? '', telepon: initial.telepon ?? '', email: initial.email ?? '', logo_url: initial.logo_url ?? '',
    rek: (() => { const r = companyAccounts(initial.rekening_json); while (r.length < 3) r.push({ bank: '', no: '', atas_nama: '' }); return r })(),
    ppn_tarif: settings.ppn_tarif ?? '11', top_default: settings.top_default ?? '14', invoice_ttd_nama: settings.invoice_ttd_nama ?? '',
    invoice_ttd_jabatan: settings.invoice_ttd_jabatan ?? '', invoice_catatan: settings.invoice_catatan ?? '',
  }
  const [f, setF] = useState(start)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const setRek = (i: number, k: keyof Rekening, v: string) => setF({ ...f, rek: f.rek.map((r, j) => (j === i ? { ...r, [k]: v } : r)) })
  const pickLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErr('')
    try { setF({ ...f, logo_url: await shrinkLogo(file) }) } catch (x) { setErr(x instanceof Error && x.message !== 'x' ? x.message : 'File bukan gambar yang bisa dibaca.') }
  }
  const halfRek = f.rek.find((r) => (r.bank.trim() || r.no.trim()) && !(r.bank.trim() && r.no.trim()))
  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!f.nama.trim()) return setErr('Nama perusahaan wajib diisi.')
    if (halfRek) return setErr('Rekening bank perlu nama bank dan nomor rekening sekaligus.')
    setBusy(true)
    setErr('')
    try {
      await call('company.update', {
        nama: f.nama, npwp: f.npwp, alamat: f.alamat, telepon: f.telepon, email: f.email, logo_url: f.logo_url,
        rekening_json: JSON.stringify(f.rek.filter((r) => r.bank.trim() && r.no.trim())),
        settings: { ppn_tarif: f.ppn_tarif, top_default: f.top_default, invoice_ttd_nama: f.invoice_ttd_nama, invoice_ttd_jabatan: f.invoice_ttd_jabatan, invoice_catatan: f.invoice_catatan },
      })
      await onSaved()
    } catch (e2) {
      setErr(errorText(e2))
      setBusy(false)
    }
  }
  return (
    <Modal size="lg" title="Ubah profil perusahaan" sub="Data ini tampil di kop invoice dan laporan." onClose={onClose} dirty={!busy && JSON.stringify(f) !== JSON.stringify(start)}
      footer={<>{halfRek && <span className="warn-text">⚠ Lengkapi nama bank & nomor rekening.</span>}<button className="btn" onClick={onClose}>Batal</button><button type="submit" form="company-form" className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button></>}>
      <form id="company-form" className="stack" onSubmit={save}>
        <div className="logo-row">
          {f.logo_url ? <img src={f.logo_url} alt="logo" className="logo-prev" /> : <div className="logo-empty">Belum ada logo</div>}
          <label className="btn">Pilih logo…<input type="file" accept="image/*" hidden onChange={pickLogo} /></label>
          {f.logo_url && <button type="button" className="link" onClick={() => setF({ ...f, logo_url: '' })}>hapus logo</button>}
        </div>
        <Field label="Nama perusahaan" value={f.nama} onChange={set('nama')} required />
        <div className="grid2">
          <Field label="NPWP" value={f.npwp} onChange={set('npwp')} />
          <Field label="Telepon" value={f.telepon} onChange={set('telepon')} />
        </div>
        <Field label="Alamat" value={f.alamat} onChange={set('alamat')} />
        <Field label="Email" type="email" value={f.email} onChange={set('email')} />
        <h3>Rekening untuk pembayaran (tampil di invoice)</h3>
        {f.rek.map((r, i) => (
          <div key={i} className="rek-row">
            <input value={r.bank} onChange={(e) => setRek(i, 'bank', e.target.value)} placeholder="Bank, mis. BCA" />
            <input value={r.no} onChange={(e) => setRek(i, 'no', e.target.value)} placeholder="No. rekening" />
            <input value={r.atas_nama} onChange={(e) => setRek(i, 'atas_nama', e.target.value)} placeholder="Atas nama" />
          </div>
        ))}
        <h3>Invoice</h3>
        <div className="grid2">
          <Field label="Tarif PPN default (%)" value={f.ppn_tarif} onChange={set('ppn_tarif')} inputMode="decimal" hint="Hanya dipakai bila PPN dicentang di invoice." />
          <Field label="Jatuh tempo default (hari)" value={f.top_default} onChange={set('top_default')} inputMode="numeric" hint="Bila pelanggan belum punya TOP sendiri." />
        </div>
        <div className="grid2">
          <Field label="Nama penanda tangan" value={f.invoice_ttd_nama} onChange={set('invoice_ttd_nama')} />
          <Field label="Jabatan" value={f.invoice_ttd_jabatan} onChange={set('invoice_ttd_jabatan')} />
        </div>
        <Field label="Catatan kaki invoice" value={f.invoice_catatan} onChange={set('invoice_catatan')} placeholder="mis. Barang yang sudah dibeli tidak dapat ditukar." />
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
