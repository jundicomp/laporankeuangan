import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'

/** Tanda wajib isi: bintang merah. */
export function Req() {
  return <b className="req" aria-label="wajib diisi">*</b>
}

export function Field({ label, hint, ...rest }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field">
      <span>{label}{rest.required && <Req />}</span>
      <input {...rest} />
      {hint && <small className="hint">{hint}</small>}
    </label>
  )
}

/**
 * Jendela modal untuk semua form isian.
 * Menutupi seluruh layar (termasuk menu) sehingga pengguna harus menyimpan atau menutup dulu.
 * Bila `dirty`, menutup (tombol ×, Esc, klik luar) minta konfirmasi dulu, dan menutup tab browser diperingatkan.
 */
export function Modal({ title, sub, onClose, dirty = false, size = 'md', footer, children }: {
  title: ReactNode
  sub?: ReactNode
  onClose: () => void
  dirty?: boolean
  size?: 'sm' | 'md' | 'lg' | 'xl'
  footer?: ReactNode
  children: ReactNode
}) {
  const [confirm, setConfirm] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const tryClose = () => (dirty ? setConfirm(true) : onClose())
  const tryCloseRef = useRef(tryClose)
  tryCloseRef.current = tryClose

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') tryCloseRef.current() }
    document.addEventListener('keydown', onKey)
    const first = box.current?.querySelector<HTMLElement>('input:not([disabled]), select, textarea')
    first?.focus()
    return () => { document.body.style.overflow = prev; document.removeEventListener('keydown', onKey) }
  }, [])

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) tryClose() }}>
      <div className={`modal ${size}`} ref={box} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {sub && <div className="modal-sub">{sub}</div>}
          </div>
          <button type="button" className="x" onClick={tryClose} aria-label="Tutup">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {confirm ? (
          <div className="modal-foot confirm">
            <span className="warn-text">⚠ Ada isian yang belum disimpan. Tutup dan buang isian ini?</span>
            <button type="button" className="btn" onClick={() => setConfirm(false)}>Kembali mengisi</button>
            <button type="button" className="btn danger" onClick={onClose}>Buang & tutup</button>
          </div>
        ) : footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Banner({ kind, children }: { kind: 'ok' | 'err' | 'warn' | 'info'; children: ReactNode }) {
  if (!children) return null
  return <div className={`banner ${kind}`}>{children}</div>
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  )
}

export function fmtTime(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}

export function Spinner({ label = 'Memuat…' }: { label?: string }) {
  return <div className="spinner"><span />{label}</div>
}
