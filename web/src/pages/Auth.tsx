import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
        <p className="hint">Tempel URL Web App Apps Script yang berakhiran <code>/exec</code>.</p>
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
        <p className="hint">ⓘ Langkah sekali saja. Kode setup ada di <b>Log eksekusi</b> Apps Script setelah menjalankan <code>upgradeSchema</code>.</p>
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
  const [forgot, setForgot] = useState(false)
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
        <button type="button" className="link left" onClick={() => setForgot(true)}>Lupa password?</button>
        <p className="warn-text">⚠ 3× salah password, akun dikunci 15 menit.</p>
      </form>
      {forgot && <ForgotForm initial={username} onBack={() => setForgot(false)} />}
    </AuthShell>
  )
}

/** Minta link reset ke email. Jawaban server selalu sama supaya akun tidak bisa ditebak. */
function ForgotForm({ initial, onBack }: { initial: string; onBack: () => void }) {
  const [login, setLogin] = useState(initial)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const r = await call<{ pesan: string }>('auth.resetRequest', { login: login.replace(/^'+/, '').trim() })
      setMsg(r.pesan)
    } catch (e2) {
      setErr(errorText(e2))
    }
    setBusy(false)
  }
  return (
    <div className="forgot-layer">
      <form onSubmit={submit} className="stack forgot-card">
        <h2>Lupa password</h2>
        {msg ? (
          <>
            <Banner kind="ok">{msg}</Banner>
            <p className="hint">ⓘ Email dikirim dari akun Google pemilik aplikasi dengan judul "… — buat password baru". Tidak masuk dalam beberapa menit? Cek folder Spam/Promosi, atau minta lagi (maksimal 3× per jam).</p>
            <button type="button" className="btn primary" onClick={onBack}>Kembali ke halaman masuk</button>
          </>
        ) : (
          <>
            <p className="hint">ⓘ Isi username atau email akun Anda. Link untuk membuat password baru akan dikirim ke email yang terdaftar.</p>
            <Field label="Username atau email" value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus autoComplete="username" />
            <Banner kind="err">{err}</Banner>
            <div className="row end">
              <button type="button" className="btn" onClick={onBack}>Kembali</button>
              <button className="btn primary" disabled={busy || !login.trim()}>{busy ? 'Mengirim…' : 'Kirim link reset'}</button>
            </div>
            <p className="small muted">Akun tanpa email? Minta owner mereset password Anda di menu Pengguna & Akses.</p>
          </>
        )}
      </form>
    </div>
  )
}

/** Halaman dari link email: #/reset?token=… */
export function ResetPage() {
  const { signIn } = useSession()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const token = sp.get('token') ?? ''
  const [info, setInfo] = useState<{ valid: boolean; username?: string; nama?: string } | null>(null)
  const [pw, setPw] = useState({ a: '', b: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    call<{ valid: boolean; username?: string; nama?: string }>('auth.resetCheck', { token }).then(setInfo).catch((e) => { setInfo({ valid: false }); setErr(errorText(e)) })
  }, [token])
  const blocker = pw.a.length < 8 ? 'Password minimal 8 karakter.' : pw.a !== pw.b ? 'Ulangi password belum sama.' : ''
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    if (blocker) return setErr(blocker)
    setBusy(true)
    try {
      const r = await call<{ token: string }>('auth.resetConfirm', { token, password: pw.a })
      nav('/', { replace: true })
      await signIn(r.token)
    } catch (e2) {
      setErr(errorText(e2))
      setBusy(false)
    }
  }
  return (
    <AuthShell>
      {!info ? <p className="hint">Memeriksa link…</p> : !info.valid ? (
        <div className="stack">
          <h2>Link tidak berlaku</h2>
          <p className="warn-text">⚠ Link reset sudah kedaluwarsa (berlaku 30 menit) atau sudah pernah dipakai.</p>
          <Banner kind="err">{err}</Banner>
          <button className="btn primary" onClick={() => nav('/', { replace: true })}>Ke halaman masuk → minta link baru</button>
        </div>
      ) : (
        <form onSubmit={submit} className="stack">
          <h2>Buat password baru</h2>
          <p className="hint">ⓘ Untuk akun <b>{info.username}</b> ({info.nama}). Setelah disimpan Anda langsung masuk, dan semua sesi lama di perangkat lain dikeluarkan.</p>
          <Field label="Password baru" type="password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} required minLength={8} autoComplete="new-password" autoFocus hint="minimal 8 karakter" />
          <Field label="Ulangi password baru" type="password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} required autoComplete="new-password" />
          {pw.a && blocker && <p className="warn-text">⚠ {blocker}</p>}
          <Banner kind="err">{err}</Banner>
          <button className={`btn primary ${blocker ? 'soft' : ''}`} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan & masuk'}</button>
        </form>
      )}
    </AuthShell>
  )
}
