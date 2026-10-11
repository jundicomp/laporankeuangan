import { useState, type FormEvent } from 'react'
import { call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { Banner, Field, Modal, PageHead } from '../components/ui'

export function ProfilePage() {
  const { boot } = useSession()
  const [open, setOpen] = useState<'pw' | 'un' | null>(null)
  const [flash, setFlash] = useState('')
  const done = (t: string) => { setOpen(null); setFlash(t) }

  return (
    <>
      <PageHead title="Profil" sub={`${boot?.user.nama} · ${boot?.user.role_nama}`} />
      {flash && <Banner kind="ok">{flash}</Banner>}
      <div className="card stack narrow">
        <table className="tbl kv">
          <tbody>
            <tr><td>Nama</td><td>{boot?.user.nama}</td></tr>
            <tr><td>Username</td><td className="mono">{boot?.user.username}</td></tr>
            <tr><td>Peran</td><td>{boot?.user.role_nama}</td></tr>
          </tbody>
        </table>
        <div className="row">
          <button className="btn primary" onClick={() => { setFlash(''); setOpen('pw') }}>Ganti password</button>
          <button className="btn" onClick={() => { setFlash(''); setOpen('un') }}>Ganti username</button>
        </div>
      </div>
      {open === 'pw' && <PasswordForm onClose={() => setOpen(null)} onDone={done} />}
      {open === 'un' && <UsernameForm onClose={() => setOpen(null)} onDone={done} />}
    </>
  )
}

function PasswordForm({ onClose, onDone }: { onClose: () => void; onDone: (t: string) => void }) {
  const [pw, setPw] = useState({ oldPassword: '', newPassword: '', again: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    setErr('')
    if (!pw.oldPassword || pw.newPassword.length < 8) return setErr('Isi password lama, dan password baru minimal 8 karakter.')
    if (pw.newPassword !== pw.again) return setErr('Konfirmasi password baru tidak sama.')
    setBusy(true)
    try {
      await call('auth.changePassword', { oldPassword: pw.oldPassword, newPassword: pw.newPassword })
      onDone('Password diganti. Sesi di perangkat lain sudah dikeluarkan.')
    } catch (e2) {
      setErr(errorText(e2))
      setBusy(false)
    }
  }
  return (
    <Modal size="sm" title="Ganti password" onClose={onClose} dirty={!busy && !!(pw.oldPassword || pw.newPassword || pw.again)}
      footer={<><button className="btn" onClick={onClose}>Batal</button><button type="submit" form="pw-form" className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Ganti password'}</button></>}>
      <form id="pw-form" className="stack" onSubmit={save}>
        <Field label="Password lama" type="password" value={pw.oldPassword} onChange={(e) => setPw({ ...pw, oldPassword: e.target.value })} required autoComplete="current-password" />
        <Field label="Password baru" type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required minLength={8} autoComplete="new-password" hint="minimal 8 karakter" />
        <Field label="Ulangi password baru" type="password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} required autoComplete="new-password" />
        <Banner kind="err">{err}</Banner>
      </form>
    </Modal>
  )
}

function UsernameForm({ onClose, onDone }: { onClose: () => void; onDone: (t: string) => void }) {
  const { boot, reload } = useSession()
  const [un, setUn] = useState(boot?.user.username ?? '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await call('auth.changeUsername', { username: un })
      await reload()
      onDone('Username diganti. Pakai username baru saat login berikutnya.')
    } catch (e2) {
      setErr(errorText(e2))
      setBusy(false)
    }
  }
  return (
    <Modal size="sm" title="Ganti username" onClose={onClose} dirty={!busy && un !== boot?.user.username}
      footer={<><button className="btn" onClick={onClose}>Batal</button><button type="submit" form="un-form" className="btn primary" disabled={busy || un === boot?.user.username}>{busy ? 'Menyimpan…' : 'Simpan'}</button></>}>
      <form id="un-form" className="stack" onSubmit={save}>
        <Field label="Username baru" value={un} onChange={(e) => setUn(e.target.value)} required hint="huruf kecil, angka, titik, minus" />
        <Banner kind="err">{err}</Banner>
      </form>
    </Modal>
  )
}
