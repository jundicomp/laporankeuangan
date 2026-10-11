import { useEffect, useState } from 'react'
import { call, errorText } from '../api/client'
import { Banner, PageHead, Spinner, fmtTime } from '../components/ui'

type Row = { waktu: string; user_id: string; aksi: string; tabel: string; rec_id: string; before_json: string; after_json: string; alasan: string }

const PAGE = 50

function diff(before: string, after: string) {
  let b: Record<string, unknown> = {}
  let a: Record<string, unknown> = {}
  try { b = before ? JSON.parse(before) : {} } catch { /* abaikan */ }
  try { a = after ? JSON.parse(after) : {} } catch { /* abaikan */ }
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]))
  if (!before) return keys.filter((k) => a[k] !== '' && a[k] !== undefined).map((k) => ({ k, b: '', a: String(a[k]) }))
  return keys.filter((k) => String(b[k] ?? '') !== String(a[k] ?? '')).map((k) => ({ k, b: String(b[k] ?? ''), a: String(a[k] ?? '') }))
}

export function AuditPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    setLoading(true)
    call<{ total: number; rows: Row[] }>('audit.list', { limit: PAGE, offset })
      .then((d) => { setRows(d.rows); setTotal(d.total) })
      .catch((e) => setErr(errorText(e)))
      .finally(() => setLoading(false))
  }, [offset])

  return (
    <>
      <PageHead title="Audit Log" sub="Jejak siapa membuat, mengubah, dan menyetujui apa — lengkap dengan data sebelum & sesudah." />
      <Banner kind="err">{err}</Banner>
      {loading ? <Spinner /> : (
        <div className="card flush">
          <table className="tbl">
            <thead><tr><th>Waktu</th><th>Pengguna</th><th>Aksi</th><th>Data</th><th>Perubahan</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={5} className="muted">Belum ada aktivitas.</td></tr>}
              {rows.map((r, i) => {
                const d = diff(r.before_json, r.after_json)
                return (
                  <tr key={i} className="click" onClick={() => setOpen(open === i ? null : i)}>
                    <td className="nowrap">{fmtTime(r.waktu)}</td>
                    <td className="mono">{r.user_id}</td>
                    <td><span className="pill b">{r.aksi}</span></td>
                    <td className="mono">{r.tabel}{r.rec_id && ` · ${r.rec_id}`}</td>
                    <td>
                      {open === i ? (
                        <div className="diff">
                          {d.length === 0 && <span className="muted">Tidak ada detail.</span>}
                          {d.map((x) => (
                            <div key={x.k}><b>{x.k}</b>: {x.b && <del>{x.b}</del>} {x.a && <ins>{x.a}</ins>}</div>
                          ))}
                          {r.alasan && <div className="muted">Alasan: {r.alasan}</div>}
                        </div>
                      ) : (
                        <span className="muted">{d.length ? `${d.length} kolom · klik untuk detail` : '—'}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="pager">
            <span className="muted small">{total ? `${offset + 1}–${Math.min(offset + PAGE, total)} dari ${total}` : ''}</span>
            <button className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>‹ Lebih baru</button>
            <button className="btn" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Lebih lama ›</button>
          </div>
        </div>
      )}
    </>
  )
}
