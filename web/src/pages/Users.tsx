import { useEffect, useState, type FormEvent } from 'react'
import { batch, call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { Banner, Field, Modal, PageHead, Req, Spinner, fmtTime } from '../components/ui'

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
            <>
              {flash && <Banner kind="ok">{flash}</Banner>}
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
                  onClose={() => setEdit(null)}
                  onSaved={(u, text) => {
                    setUsers((list) => (list.some((x) => x.id === u.id) ? list.map((x) => (x.id === u.id ? u : x)) : [...list, u]))
                    setFlash(text)
                    setEdit(null)
                  }}
                />
              )}
            </>
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
              <p className="hint pad">ⓘ Peran bawaan mengikuti rancangan. Pengaturan izin per peran yang bisa diubah owner menyusul bersama modul approval.</p>
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

function UserForm({ user, roles, self, onClose, onSaved }: {
  user: User | null
  roles: Role[]
  self: boolean
  onClose: () => void
  onSaved: (u: User, text: string) => void
}) {
  const initial = { nama: user?.nama ?? '', username: user?.username ?? '', email: user?.email ?? '', role_id: user?.role_id ?? 'kasir', password: '' }
  const [f, setF] = useState(initial)
  const [newPw, setNewPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const dirty = !busy && (JSON.stringify(f) !== JSON.stringify(initial) || !!newPw)

  const run = async (action: string, payload: Record<string, unknown>, okText: string) => {
    setBusy(true)
    setErr('')
    try {
      const u = await call<User>(action, payload)
      onSaved(u, okText)
    } catch (e) {
      setErr(errorText(e))
      setBusy(false)
    }
  }

  const save = (e?: FormEvent) => {
    e?.preventDefault()
    setErr('')
    if (!f.nama.trim() || !f.username.trim()) return setErr('Nama dan username wajib diisi.')
    if (!user && f.password.length < 8) return setErr('Password awal minimal 8 karakter.')
    if (!user) run('user.create', f, `Pengguna ${f.nama} dibuat. Berikan username & password ke yang bersangkutan.`)
    else run('user.update', { id: user.id, nama: f.nama, email: f.email, role_id: f.role_id }, `Perubahan ${f.nama} disimpan.`)
  }

  return (
    <Modal
      title={user ? `Edit pengguna · ${user.nama}` : 'Pengguna baru'}
      onClose={onClose}
      dirty={dirty}
      footer={<><button type="button" className="btn" onClick={onClose}>Batal</button><button type="submit" form="user-form" className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : user ? 'Simpan perubahan' : 'Buat pengguna'}</button></>}
    >
      <form id="user-form" className="stack" onSubmit={save}>
        <Field label="Nama" value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} required />
        <Field label="Username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required disabled={!!user} hint={user ? 'Username diganti sendiri oleh pemiliknya lewat menu Profil' : 'huruf kecil, tanpa spasi'} />
        <Field label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <label className="field">
          <span>Peran<Req /></span>
          <select value={f.role_id} onChange={(e) => setF({ ...f, role_id: e.target.value })} disabled={self}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.nama}</option>)}
          </select>
          {self && <small className="hint">Peran akun sendiri tidak bisa diubah</small>}
        </label>
        {!user && <Field label="Password awal" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={8} autoComplete="new-password" hint="minimal 8 karakter" />}
        <Banner kind="err">{err}</Banner>
      </form>

      {user && !self && (
        <div className="danger-zone stack">
          <div className="row">
            <Field label="Reset password" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} minLength={8} autoComplete="new-password" placeholder="password baru, min. 8 karakter" />
            <button type="button" className="btn" disabled={busy || newPw.length < 8} onClick={() => run('user.update', { id: user.id, resetPassword: newPw }, `Password ${user.nama} direset. Sesi lamanya dikeluarkan.`)}>Reset</button>
          </div>
          <div className="row">
            {user.terkunci && <button type="button" className="btn" disabled={busy} onClick={() => run('user.update', { id: user.id, unlock: true }, `Kunci akun ${user.nama} dibuka.`)}>Buka kunci</button>}
            <button type="button" className={`btn ${user.aktif ? 'danger' : ''}`} disabled={busy} onClick={() => run('user.update', { id: user.id, aktif: !user.aktif }, user.aktif ? `${user.nama} dinonaktifkan dan dikeluarkan dari semua sesi.` : `${user.nama} diaktifkan kembali.`)}>
              {user.aktif ? 'Nonaktifkan pengguna' : 'Aktifkan kembali'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
