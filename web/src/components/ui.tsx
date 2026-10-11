import type { InputHTMLAttributes, ReactNode } from 'react'

export function Field({ label, hint, ...rest }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...rest} />
      {hint && <small>{hint}</small>}
    </label>
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
