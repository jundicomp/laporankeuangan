import { useState, type FormEvent, type ReactNode } from 'react'
import { call, errorText, getApiUrl, setApiUrl } from '../api/client'
import { useSession } from '../auth/session'
import { Banner, Field } from '../components/ui'

function AuthShell({ children }: { children: ReactNode }) {
  const { company } = useSession()
  return (
    <div className="auth">
      <div className="auth-brand">
        <div>
          <div className="auth-logo"><b>N</b>Neraca</div>
          <p>Keuangan bisnis, rapi dari kasir sampai neraca.</p>
        </div>
        <ul>
          <li>Data tersimpan di Google Sheets milik Anda</li>
          <li>Laporan sesuai SAK EP & siap diajukan ke bank</li>
          <li>Multi pengguna dengan hak akses per peran</li>
        </ul>
        {company && <div className="auth-co">{company}</div>}
      </div>
      <div className="auth-form">{children}</div>
    </div>
  )
}

export function ConnectPage() {
  const { status, error, recheck } = useSession()
  const [url, setUrl] = useState(getApiUrl())
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setApiUrl(url)
    await recheck()
  }
  return (
    <AuthShell>
      <form onSubmit={submit} className="stack">
        <h2>Hubungkan ke server</h2>
        <p className="muted">Tempel URL Web App Apps Script yang berakhiran <code>/exec</code>.</p>
        <Field label="URL server" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" required />
        {status === 'offline' && <Banner kind="err">{error}</Banner>}
        <button className="btn primary" disabled={!url}>Hubungkan</button>
      </form>
    </AuthShell>
  )
}

export function SetupOwnerPage() {
  const { signIn } = useSession()
  const [f, setF] = useState({ setupCode: '', namaPerusahaan: '', nama: '', username: '', email: '', password: '', password2: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    if (f.password !== f.password2) return setErr('Konfirmasi password tidak sama.')
    setBusy(true)
    try {
      const r = await call<{ token: string }>('auth.setupOwner', f)
      await signIn(r.token)
    } catch (e2) {
      setErr(errorText(e2))
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <form onSubmit={submit} className="stack">
        <h2>Buat akun owner</h2>
        <p className="muted">Langkah sekali saja. Kode setup ada di <b>Log eksekusi</b> Apps Script setelah menjalankan <code>upgradeSchema</code>.</p>
        <Field label="Kode setup" value={f.setupCode} onChange={set('setupCode')} placeholder="8 karakter" required autoComplete="off" />
        <Field label="Nama perusahaan" value={f.namaPerusahaan} onChange={set('namaPerusahaan')} placeholder="CV / PT / Toko …" required />
        <div className="grid2">
          <Field label="Nama Anda" value={f.nama} onChange={set('nama')} required />
          <Field label="Username" value={f.username} onChange={set('username')} required autoComplete="username" hint="huruf kecil, tanpa spasi" />
        </div>
        <Field label="Email (untuk pemulihan akun)" type="email" value={f.email} onChange={set('email')} />
        <div className="grid2">
          <Field label="Password" type="password" value={f.password} onChange={set('password')} required minLength={8} autoComplete="new-password" hint="minimal 8 karakter" />
          <Field label="Ulangi password" type="password" value={f.password2} onChange={set('password2')} required autoComplete="new-password" />
        </div>
        <Banner kind="err">{err}</Banner>
        <button className="btn primary" disabled={busy}>{busy ? 'Membuat akun…' : 'Buat akun & masuk'}</button>
      </form>
    </AuthShell>
  )
}

export function LoginPage() {
  const { signIn } = useSession()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const r = await call<{ token: string }>('auth.login', { username, password })
      await signIn(r.token)
    } catch (e2) {
      setErr(errorText(e2))
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <form onSubmit={submit} className="stack">
        <h2>Masuk</h2>
        <p className="muted">Gunakan akun yang dibuat oleh owner perusahaan.</p>
        <Field label="Username" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" autoFocus />
        <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        <Banner kind="err">{err}</Banner>
        <button className="btn primary" disabled={busy}>{busy ? 'Memeriksa…' : 'Masuk'}</button>
        <p className="muted small">3× salah password, akun dikunci 15 menit. Lupa password? Minta owner meresetnya di menu Pengguna & Akses.</p>
      </form>
    </AuthShell>
  )
}
