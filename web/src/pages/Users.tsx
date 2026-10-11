import { useEffect, useState, type FormEvent } from 'react'
import { batch, call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { Banner, Field, PageHead, Spinner, fmtTime } from '../components/ui'

type User = { id: string; username: string; nama: string; email: string; role_id: string; aktif: boolean; terkunci: boolean }
type Role = { id: string; nama: string; izin: string[] }
type Perm = { kode: string; nama: string }
type LoginRow = { waktu: string; username: string; status: string; keterangan: string }

export function UsersPage() {
  const { boot } = useSession()
  const [tab, setTab] = useState<'users' | 'roles' | 'login'>('users')
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [catalog, setCatalog] = useState<Perm[]>([])
  const [logins, setLogins] = useState<LoginRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [edit, setEdit] = useState<User | 'new' | null>(null)
  const [flash, setFlash] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [u, r, l] = await batch([{ action: 'user.list' }, { action: 'role.list' }, { action: 'login.list', payload: { limit: 50 } }])
      if (u.ok) setUsers(u.data as User[])
      if (r.ok) {
        const d = r.data as { roles: Role[]; catalog: Perm[] }
        setRoles(d.roles)
        setCatalog(d.catalog)
      }
      if (l.ok) setLogins((l.data as { rows: LoginRow[] }).rows)
    } catch (e) {
      setErr(errorText(e))
    }
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [])

  const roleName = (id: string) => roles.find((r) => r.id === id)?.nama ?? id

  return (
    <>
      <PageHead title="Pengguna & Akses" sub="Tambah pengguna, atur peran, reset password, dan lihat riwayat login.">
        {tab === 'users' && <button className="btn primary" onClick={() => { setFlash(''); setEdit('new') }}>+ Pengguna</button>}
      </PageHead>
      <div className="tabs">
        <button className={tab === 'users' ? 'on' : ''} onClick={() => setTab('users')}>Pengguna ({users.length})</button>
        <button className={tab === 'roles' ? 'on' : ''} onClick={() => setTab('roles')}>Peran & izin</button>
        <button className={tab === 'login' ? 'on' : ''} onClick={() => setTab('login')}>Riwayat login</button>
      </div>
      <Banner kind="err">{err}</Banner>
      {loading ? <Spinner /> : (
        <>
          {tab === 'users' && (
            <div className="split">
              <div className="card flush">
                <table className="tbl">
                  <thead><tr><th>Nama</th><th>Username</th><th>Peran</th><th>Status</th></tr></thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id} className={`click ${edit !== 'new' && edit?.id === u.id ? 'sel' : ''}`} onClick={() => { setFlash(''); setEdit(u) }}>
                        <td>{u.nama}{u.id === boot?.user.id && <span className="pill n">Anda</span>}</td>
                        <td className="mono">{u.username}</td>
                        <td>{roleName(u.role_id)}</td>
                        <td>{!u.aktif ? <span className="pill n">Nonaktif</span> : u.terkunci ? <span className="pill r">Terkunci</span> : <span className="pill g">Aktif</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {edit && (
                <UserForm
                  key={edit === 'new' ? 'new' : edit.id}
                  user={edit === 'new' ? null : edit}
                  roles={roles}
                  self={edit !== 'new' && edit.id === boot?.user.id}
                  flash={flash}
                  onClose={() => setEdit(null)}
                  onSaved={(u, text) => {
                    setUsers((list) => (list.some((x) => x.id === u.id) ? list.map((x) => (x.id === u.id ? u : x)) : [...list, u]))
                    setFlash(text)
                    setEdit(u)
                  }}
                />
              )}
            </div>
          )}
          {tab === 'roles' && (
            <div className="card flush scroll-x">
              <table className="tbl matrix">
                <thead>
                  <tr><th>Izin</th>{roles.map((r) => <th key={r.id} className="c">{r.nama}</th>)}</tr>
                </thead>
                <tbody>
                  {catalog.map((p) => (
                    <tr key={p.kode}>
                      <td>{p.nama}</td>
                      {roles.map((r) => {
                        const on = r.izin.includes('*') || r.izin.includes(p.kode)
                        return <td key={r.id} className="c">{on ? <span className="yes">●</span> : <span className="no">○</span>}</td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small pad">Peran bawaan mengikuti rancangan. Pengaturan izin per peran yang bisa diubah owner menyusul bersama modul approval.</p>
            </div>
          )}
          {tab === 'login' && (
            <div className="card flush">
              <table className="tbl">
                <thead><tr><th>Waktu</th><th>Username</th><th>Status</th><th>Keterangan</th></tr></thead>
                <tbody>
                  {logins.map((l, i) => (
                    <tr key={i}>
                      <td>{fmtTime(l.waktu)}</td>
                      <td className="mono">{l.username}</td>
                      <td><span className={`pill ${l.status === 'sukses' ? 'g' : l.status === 'gagal' ? 'r' : 'o'}`}>{l.status}</span></td>
                      <td className="muted">{l.keterangan}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  )
}

function UserForm({ user, roles, self, flash, onClose, onSaved }: {
  user: User | null
  roles: Role[]
  self: boolean
  flash: string
  onClose: () => void
  onSaved: (u: User, text: string) => void
}) {
  const [f, setF] = useState({
    nama: user?.nama ?? '',
    username: user?.username ?? '',
    email: user?.email ?? '',
    role_id: user?.role_id ?? 'kasir',
    password: '',
  })
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(flash ? { kind: 'ok', text: flash } : null)
  const [busy, setBusy] = useState(false)

  const run = async (action: string, payload: Record<string, unknown>, okText: string) => {
    setBusy(true)
    setMsg(null)
    try {
      const u = await call<User>(action, payload)
      setMsg({ kind: 'ok', text: okText })
      onSaved(u, okText)
      setF((x) => ({ ...x, password: '' }))
    } catch (e) {
      setMsg({ kind: 'err', text: errorText(e) })
    }
    setBusy(false)
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!user) run('user.create', f, 'Pengguna dibuat. Berikan username & password ke yang bersangkutan.')
    else run('user.update', { id: user.id, nama: f.nama, email: f.email, role_id: f.role_id }, 'Perubahan disimpan.')
  }

  return (
    <form className="card panel stack" onSubmit={save}>
      <div className="panel-head">
        <h3>{user ? `Edit · ${user.nama}` : 'Pengguna baru'}</h3>
        <button type="button" className="x" onClick={onClose} aria-label="Tutup">×</button>
      </div>
      <Field label="Nama" value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} required />
      <Field label="Username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required disabled={!!user} hint={user ? 'Username diganti sendiri oleh pemiliknya lewat menu Profil' : 'huruf kecil, tanpa spasi'} />
      <Field label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <label className="field">
        <span>Peran</span>
        <select value={f.role_id} onChange={(e) => setF({ ...f, role_id: e.target.value })} disabled={self}>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.nama}</option>)}
        </select>
        {self && <small>Peran akun sendiri tidak bisa diubah</small>}
      </label>
      {!user && <Field label="Password awal" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={8} autoComplete="new-password" hint="minimal 8 karakter" />}
      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
      <button className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : user ? 'Simpan perubahan' : 'Buat pengguna'}</button>

      {user && !self && (
        <div className="danger-zone stack">
          <div className="row">
            <Field label="Reset password" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} minLength={8} autoComplete="new-password" placeholder="password baru" />
            <button type="button" className="btn" disabled={busy || f.password.length < 8} onClick={() => run('user.update', { id: user.id, resetPassword: f.password }, 'Password direset. Sesi lama pengguna ini dikeluarkan.')}>Reset</button>
          </div>
          <div className="row">
            {user.terkunci && <button type="button" className="btn" disabled={busy} onClick={() => run('user.update', { id: user.id, unlock: true }, 'Kunci akun dibuka.')}>Buka kunci</button>}
            <button type="button" className={`btn ${user.aktif ? 'warn' : ''}`} disabled={busy} onClick={() => run('user.update', { id: user.id, aktif: !user.aktif }, user.aktif ? 'Pengguna dinonaktifkan dan dikeluarkan dari semua sesi.' : 'Pengguna diaktifkan kembali.')}>
              {user.aktif ? 'Nonaktifkan' : 'Aktifkan kembali'}
            </button>
          </div>
        </div>
      )}
    </form>
  )
}
