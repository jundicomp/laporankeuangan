import { useEffect, useState } from 'react'
import { call, getApiUrl, setApiUrl, ApiError } from './api/client'

type Status = 'idle' | 'run' | 'ok' | 'fail'
type Check = { key: string; label: string; status: Status; detail?: string }

type Info = { spreadsheetName: string; sheets: string[]; schemaVersion: string | null }
type PingRow = { id: string; waktu: string; catatan: string; client: string }

const INITIAL: Check[] = [
  { key: 'ping', label: 'Server Apps Script menjawab', status: 'idle' },
  { key: 'info', label: 'Spreadsheet terhubung & tab lengkap', status: 'idle' },
  { key: 'write', label: 'Menulis baris ke Sheets', status: 'idle' },
  { key: 'read', label: 'Membaca kembali baris tadi', status: 'idle' },
  { key: 'speed', label: 'Kecepatan (5× ping)', status: 'idle' },
]

const msg = (e: unknown) => (e instanceof ApiError ? `${e.code}: ${e.message}` : String(e))

export default function App() {
  const [url, setUrl] = useState(getApiUrl())
  const [checks, setChecks] = useState<Check[]>(INITIAL)
  const [running, setRunning] = useState(false)
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<PingRow[]>([])
  const [error, setError] = useState('')

  const update = (key: string, patch: Partial<Check>) =>
    setChecks((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)))

  async function runAll() {
    setApiUrl(url)
    setChecks(INITIAL)
    setRunning(true)
    try {
      update('ping', { status: 'run' })
      const p = await call<{ pong: boolean }>('system.ping')
      update('ping', { status: 'ok', detail: `${p.totalMs} ms (server ${p.serverMs} ms)` })

      update('info', { status: 'run' })
      const i = await call<Info>('system.info')
      const n = i.data.sheets.length
      update('info', {
        status: n >= 30 ? 'ok' : 'fail',
        detail: `"${i.data.spreadsheetName}" · ${n} tab · skema ${i.data.schemaVersion ?? '?'}`,
      })

      update('write', { status: 'run' })
      const stamp = `uji otomatis ${new Date().toLocaleString('id-ID')}`
      const w = await call<{ id: string }>('test.write', { note: stamp, client: navigator.userAgent.slice(0, 60) })
      update('write', { status: 'ok', detail: `${w.data.id} · ${w.totalMs} ms` })

      update('read', { status: 'run' })
      const r = await call<PingRow[]>('test.list', { limit: 10 })
      const found = r.data.some((x) => x.id === w.data.id)
      setRows(r.data)
      update('read', { status: found ? 'ok' : 'fail', detail: found ? `${r.totalMs} ms` : 'Baris tidak ditemukan' })

      update('speed', { status: 'run' })
      const times: number[] = []
      for (let k = 0; k < 5; k++) times.push((await call('system.ping')).totalMs)
      const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length)
      update('speed', {
        status: avg < 3000 ? 'ok' : 'fail',
        detail: `rata-rata ${avg} ms · min ${Math.min(...times)} · maks ${Math.max(...times)}`,
      })
    } catch (e) {
      setChecks((cs) => cs.map((c) => (c.status === 'run' ? { ...c, status: 'fail', detail: msg(e) } : c)))
    } finally {
      setRunning(false)
    }
  }

  async function loadRows() {
    try {
      setRows((await call<PingRow[]>('test.list', { limit: 10 })).data)
    } catch (e) {
      setError(msg(e))
    }
  }

  async function addNote(ev: React.FormEvent) {
    ev.preventDefault()
    setError('')
    try {
      await call('test.write', { note, client: 'form manual' })
      setNote('')
      await loadRows()
    } catch (e) {
      setError(msg(e))
    }
  }

  useEffect(() => {
    if (getApiUrl()) loadRows()
  }, [])

  const allOk = checks.every((c) => c.status === 'ok')

  return (
    <div className="page">
      <header className="top">
        <div className="logo"><b>N</b>Neraca</div>
        <span className="tag">Langkah 0 · uji jalur React → Apps Script → Google Sheets</span>
      </header>

      <main className="grid">
        <section className="card">
          <h2>1. Hubungkan ke Apps Script</h2>
          <p className="muted">Tempel URL Web App yang berakhiran <code>/exec</code>.</p>
          <div className="row">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" />
            <button className="primary" onClick={runAll} disabled={running || !url}>
              {running ? 'Menguji…' : 'Jalankan uji'}
            </button>
          </div>
          <ul className="checks">
            {checks.map((c) => (
              <li key={c.key} className={c.status}>
                <span className="dot" />
                <span className="lbl">{c.label}</span>
                <span className="det">{c.detail ?? (c.status === 'run' ? 'menunggu…' : '')}</span>
              </li>
            ))}
          </ul>
          {allOk && <div className="banner ok">Jalur aman. Langkah 0 lulus — kita siap lanjut ke Langkah 1.</div>}
        </section>

        <section className="card">
          <h2>2. Coba tulis manual</h2>
          <form className="row" onSubmit={addNote}>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Tulis catatan uji…" maxLength={200} />
            <button className="primary" disabled={!note}>Simpan ke Sheets</button>
          </form>
          {error && <div className="banner fail">{error}</div>}
          <table>
            <thead><tr><th>ID</th><th>Waktu</th><th>Catatan</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={3} className="muted">Belum ada data.</td></tr>}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.id}</td>
                  <td>{new Date(r.waktu).toLocaleString('id-ID')}</td>
                  <td>{r.catatan}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Baris ini ada di tab <code>T_Ping</code> spreadsheet "Neraca — Database". Buka spreadsheet-nya untuk memastikan.</p>
        </section>
      </main>
    </div>
  )
}
