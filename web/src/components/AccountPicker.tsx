import { useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '../auth/session'

export type Account = { kode: string; nama: string; tipe: string; saldo_normal: string; parent: string; is_header: boolean; aktif: boolean }

export function useAccounts() {
  const { boot } = useSession()
  return useMemo(() => (boot?.coa ?? []) as unknown as Account[], [boot])
}

/** Pilih akun dengan mengetik kode atau nama. Hanya akun detail (bukan header) yang aktif. */
export function AccountPicker({ value, onChange, autoFocus, placeholder = 'Ketik kode / nama akun…', includeInactive = false }: {
  value: string
  onChange: (kode: string) => void
  autoFocus?: boolean
  placeholder?: string
  includeInactive?: boolean
}) {
  const accounts = useAccounts()
  const options = useMemo(() => accounts.filter((a) => !a.is_header && (includeInactive || a.aktif)), [accounts, includeInactive])
  const current = accounts.find((a) => a.kode === value)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return options
    return options.filter((a) => a.kode.toLowerCase().startsWith(t) || a.nama.toLowerCase().includes(t))
  }, [q, options])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  useEffect(() => {
    list.current?.children[hi]?.scrollIntoView({ block: 'nearest' })
  }, [hi])

  const pick = (a: Account) => {
    onChange(a.kode)
    setQ('')
    setOpen(false)
  }

  return (
    <div className="acc-picker" ref={box}>
      <input
        value={open ? q : current ? `${current.kode} · ${current.nama}` : value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onFocus={(e) => { setOpen(true); setQ(''); setHi(0); e.target.select() }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, matches.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)) }
          else if (e.key === 'Enter' && open && matches[hi]) { e.preventDefault(); pick(matches[hi]) }
          else if (e.key === 'Escape') setOpen(false)
          else if (e.key === 'Tab' && open && q && matches[hi]) pick(matches[hi])
        }}
      />
      {open && (
        <ul className="acc-list" ref={list}>
          {matches.length === 0 && <li className="none">Akun tidak ditemukan</li>}
          {matches.slice(0, 80).map((a, i) => (
            <li key={a.kode} className={i === hi ? 'hi' : ''} onMouseDown={(e) => { e.preventDefault(); pick(a) }} onMouseEnter={() => setHi(i)}>
              <span className="mono">{a.kode}</span> {a.nama}
              <small>{a.tipe}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
