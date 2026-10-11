import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { call, getApiUrl, getToken, setAuthLostHandler, setToken, errorText } from '../api/client'

export type Module = { kode: string; nama: string; aktif: boolean; wajib: boolean; bergantung_pada: string }
export type Boot = {
  user: { id: string; username: string; nama: string; role_id: string; role_nama: string; cabang_akses: string }
  perms: string[]
  company: Record<string, string>
  settings: Record<string, string>
  modules: Module[]
  coa: Record<string, unknown>[]
  kasbank: Record<string, unknown>[]
  periods: Record<string, unknown>[]
  serverTime: string
}

type Status = 'no-url' | 'checking' | 'needs-owner' | 'signed-out' | 'ready' | 'offline'

type SessionCtx = {
  status: Status
  boot: Boot | null
  company: string
  error: string
  signIn: (token: string) => Promise<void>
  signOut: () => Promise<void>
  reload: () => Promise<void>
  recheck: () => Promise<void>
  setModules: (m: Module[]) => void
  can: (perm?: string) => boolean
  modOn: (kode?: string) => boolean
}

const Ctx = createContext<SessionCtx | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(getApiUrl() ? 'checking' : 'no-url')
  const [boot, setBoot] = useState<Boot | null>(null)
  const [company, setCompany] = useState('')
  const [error, setError] = useState('')

  const loadBoot = useCallback(async () => {
    const b = await call<Boot>('app.bootstrap')
    setBoot(b)
    setCompany(b.company?.nama ?? '')
    setStatus('ready')
  }, [])

  const recheck = useCallback(async () => {
    if (!getApiUrl()) return setStatus('no-url')
    setStatus('checking')
    setError('')
    try {
      if (getToken()) {
        try {
          return await loadBoot()
        } catch {
          setToken(null)
        }
      }
      const s = await call<{ needsOwner: boolean; company: string }>('auth.status')
      setCompany(s.company)
      setStatus(s.needsOwner ? 'needs-owner' : 'signed-out')
    } catch (e) {
      setError(errorText(e))
      setStatus('offline')
    }
  }, [loadBoot])

  useEffect(() => {
    setAuthLostHandler(() => {
      setToken(null)
      setBoot(null)
      setStatus('signed-out')
    })
    recheck()
  }, [recheck])

  const value = useMemo<SessionCtx>(
    () => ({
      status,
      boot,
      company,
      error,
      recheck,
      signIn: async (t) => {
        setToken(t)
        await loadBoot()
      },
      signOut: async () => {
        try {
          await call('auth.logout')
        } catch {
          /* tetap keluar */
        }
        setToken(null)
        setBoot(null)
        setStatus('signed-out')
      },
      reload: loadBoot,
      setModules: (m) => setBoot((b) => (b ? { ...b, modules: m } : b)),
      can: (perm) => !perm || !!boot && (boot.perms.includes('*') || boot.perms.includes(perm)),
      modOn: (kode) => !kode || !!boot?.modules.find((m) => m.kode === kode)?.aktif,
    }),
    [status, boot, company, error, recheck, loadBoot],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useSession di luar SessionProvider')
  return c
}
