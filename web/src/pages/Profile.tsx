import { useState, type FormEvent } from 'react'
import { call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { Banner, Field, PageHead } from '../components/ui'

export function ProfilePage() {
  const { boot, reload } = useSession()
  const [pw, setPw] = useState({ oldPassword: '', newPassword: '', again: '' })
  const [un, setUn] = useState(boot?.user.username ?? '')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [msg2, setMsg2] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const changePw = async (e: FormEvent) => {
    e.preventDefault()
    setMsg(null)
    if (pw.newPassword !== pw.again) return setMsg({ kind: 'err', text: 'Konfirmasi password tidak sama.' })
    setBusy(true)
    try {
      await call('auth.changePassword', { oldPassword: pw.oldPassword, newPassword: pw.newPassword })
      setPw({ oldPassword: '', newPassword: '', again: '' })
      setMsg({ kind: 'ok', text: 'Password diganti. Sesi di perangkat lain sudah dikeluarkan.' })
    } catch (e2) {
      setMsg({ kind: 'err', text: errorText(e2) })
    }
    setBusy(false)
  }

  const changeUn = async (e: FormEvent) => {
    e.preventDefault()
    setMsg2(null)
    setBusy(true)
    try {
      await call('auth.changeUsername', { username: un })
      await reload()
      setMsg2({ kind: 'ok', text: 'Username diganti. Pakai username baru saat login berikutnya.' })
    } catch (e2) {
      setMsg2({ kind: 'err', text: errorText(e2) })
    }
    setBusy(false)
  }

  return (
    <>
      <PageHead title="Profil" sub={`${boot?.user.nama} · ${boot?.user.role_nama}`} />
      <div className="grid2 top">
        <form className="card stack" onSubmit={changePw}>
          <h3>Ganti password</h3>
          <Field label="Password lama" type="password" value={pw.oldPassword} onChange={(e) => setPw({ ...pw, oldPassword: e.target.value })} required autoComplete="current-password" />
          <Field label="Password baru" type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required minLength={8} autoComplete="new-password" hint="minimal 8 karakter" />
          <Field label="Ulangi password baru" type="password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} required autoComplete="new-password" />
          {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
          <button className="btn primary" disabled={busy}>Ganti password</button>
        </form>
        <form className="card stack" onSubmit={changeUn}>
          <h3>Ganti username</h3>
          <Field label="Username" value={un} onChange={(e) => setUn(e.target.value)} required hint="huruf kecil, angka, titik, minus" />
          {msg2 && <Banner kind={msg2.kind}>{msg2.text}</Banner>}
          <button className="btn" disabled={busy || un === boot?.user.username}>Simpan username</button>
        </form>
      </div>
    </>
  )
}
