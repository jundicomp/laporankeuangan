import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { call, errorText } from '../api/client'
import { useSession } from '../auth/session'
import { Banner, PageHead, Spinner } from '../components/ui'
import { useVisibleNav } from '../components/Layout'
import { bulanID, rp, tglID } from '../lib/format'
import type { NavItem } from '../nav'

type Dash = {
  per: string; bulan: string; awal_tahun_buku: string
  tren: { bulan: string; pendapatan: number; laba: number }[]
  omzet: { bulan: number; lalu: number; ytd: number }
  laba: { bulan: number; lalu: number; ytd: number }
  kas?: { total: number; rekening: { id: string; nama: string; jenis: string; saldo: number }[]; termasuk_bank: boolean }
  piutang?: { total: number; terlambat: number; n_terlambat: number; segera: number; n_segera: number; draft: number
    teratas: { id: string; no: string; pelanggan: string; sisa: number; jatuh_tempo: string; hari: number }[] }
  peringatan: { level: 'warn' | 'err' | 'info'; text: string; link: string }[]
}

const ROADMAP = [
  { step: 'Langkah 1–4', title: 'MVP: akses & audit, jurnal & buku besar, kas & bank, laporan, invoice & piutang, dashboard', done: true },
  { step: 'Berikutnya', title: 'Pembelian, utang supplier & persediaan' },
  { step: 'Lalu', title: 'Siklus PSAK lengkap: neraca lajur, jurnal penutup, arus kas, CALK' },
  { step: 'Lalu', title: 'Aset tetap & penyusutan, payroll, pajak' },
  { step: 'Terakhir', title: 'Anggaran, paket laporan bankable, multi perusahaan' },
]

function greet() {
  const h = new Date().getHours()
  return h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam'
}

function Change({ now, prev }: { now: number; prev: number }) {
  if (!prev) return <small className="muted">bulan lalu Rp {rp(prev)}</small>
  const p = Math.round(((now - prev) / Math.abs(prev)) * 100)
  return <small className={p >= 0 ? 'ok-text' : 'err-text'}>{p >= 0 ? '▲' : '▼'} {Math.abs(p)}% dari bulan lalu (Rp {rp(prev)})</small>
}

/** Grafik batang 6 bulan: pendapatan (hijau) & laba bersih (biru; merah bila rugi). */
function TrendChart({ data }: { data: Dash['tren'] }) {
  const W = 560, H = 190, pad = 24, base = H - 28
  const max = Math.max(1, ...data.map((d) => Math.max(d.pendapatan, Math.abs(d.laba))))
  const neg = Math.max(0, ...data.map((d) => -d.laba))
  const scale = (base - pad) / (max + neg)
  const zero = base - neg * scale
  const slot = (W - 20) / data.length
  const short = (n: number) => (Math.abs(n) >= 1e9 ? `${(n / 1e9).toFixed(1)} M` : Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)} jt` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)} rb` : String(Math.round(n)))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trend" role="img" aria-label="Tren pendapatan dan laba 6 bulan">
      <line x1="10" x2={W - 10} y1={zero} y2={zero} stroke="#c5ccd4" />
      {data.map((d, i) => {
        const x = 10 + i * slot + slot * 0.18
        const bw = slot * 0.3
        const hp = d.pendapatan * scale
        const hl = Math.abs(d.laba) * scale
        return (
          <g key={d.bulan}>
            <rect x={x} y={zero - Math.max(0, hp)} width={bw} height={Math.max(0, hp)} fill="#0f5c4d" rx="2"><title>Pendapatan {bulanID(d.bulan)}: Rp {rp(d.pendapatan)}</title></rect>
            <rect x={x + bw + 3} y={d.laba >= 0 ? zero - hl : zero} width={bw} height={hl} fill={d.laba >= 0 ? '#2d63b8' : '#c2412d'} rx="2"><title>Laba bersih {bulanID(d.bulan)}: Rp {rp(d.laba)}</title></rect>
            {d.pendapatan > 0 && <text x={x + bw / 2} y={zero - hp - 4} textAnchor="middle" fontSize="10" fill="#1c2430">{short(d.pendapatan)}</text>}
            <text x={x + bw} y={H - 8} textAnchor="middle" fontSize="11" fill="#3f4856">{bulanID(d.bulan, false)}</text>
          </g>
        )
      })}
    </svg>
  )
}

export function HomePage() {
  const { boot, can } = useSession()
  const [d, setD] = useState<Dash | null>(null)
  const [err, setErr] = useState('')
  const canDash = can('dashboard.view')
  useEffect(() => {
    if (!canDash) return
    call<Dash>('dashboard.summary').then(setD).catch((e) => setErr(errorText(e)))
  }, [canDash])
  const first = boot?.user.nama.split(' ')[0]

  if (!canDash) return <QuickHome title={`${greet()}, ${first}`} />

  return (
    <>
      <PageHead title={`${greet()}, ${first}`} sub={`${boot?.company.nama} · ${d ? `posisi ${tglID(d.per)}` : 'memuat…'}`}>
        {can('penjualan.edit') && <Link className="btn" to="/penjualan?baru=1">+ Invoice</Link>}
        {can('kas.edit') && <Link className="btn" to="/kas-bank">Kas & Bank</Link>}
        {can('laporan.view') && <Link className="btn" to="/laporan">Laporan</Link>}
      </PageHead>
      <Banner kind="err">{err}</Banner>
      {!d ? (!err && <Spinner label="Menghitung angka…" />) : (
        <>
          <div className="kpis dash-kpis">
            <div className="card kpi"><span>Pendapatan {bulanID(d.bulan)}</span><b>Rp {rp(d.omzet.bulan)}</b><Change now={d.omzet.bulan} prev={d.omzet.lalu} /></div>
            <div className="card kpi"><span>Laba bersih {bulanID(d.bulan)}</span><b className={d.laba.bulan < 0 ? 'neg' : ''}>Rp {rp(d.laba.bulan)}</b>
              <small className="muted">Sejak {tglID(d.awal_tahun_buku)}: Rp {rp(d.laba.ytd)}</small></div>
            {d.kas && <div className="card kpi"><span>Kas & bank{d.kas.termasuk_bank ? '' : ' (tanpa bank)'}</span><b className={d.kas.total < 0 ? 'neg' : ''}>Rp {rp(d.kas.total)}</b>
              <small className="muted">{d.kas.rekening.length} rekening</small></div>}
            {d.piutang && <div className="card kpi"><span>Piutang belum dibayar</span><b>Rp {rp(d.piutang.total)}</b>
              {d.piutang.n_terlambat ? <small className="err-text">Rp {rp(d.piutang.terlambat)} lewat jatuh tempo</small> : <small className="ok-text">✓ tidak ada yang telat</small>}</div>}
          </div>

          <div className="dash-grid">
            <div className="card">
              <div className="row between"><h3>Pendapatan & laba 6 bulan</h3>
                <span className="legend"><i className="lg-p" /> Pendapatan <i className="lg-l" /> Laba bersih</span></div>
              <TrendChart data={d.tren} />
              <p className="small muted">Pendapatan sejak awal tahun buku: <b>Rp {rp(d.omzet.ytd)}</b></p>
            </div>
            <div className="card">
              <h3>Perlu perhatian</h3>
              {d.peringatan.length === 0 && <p className="ok-text">✓ Tidak ada peringatan. Pembukuan terlihat rapi.</p>}
              <ul className="alerts">
                {d.peringatan.map((w, i) => (
                  <li key={i} className={`al-${w.level}`}>
                    <span className="al-ic">{w.level === 'info' ? 'ⓘ' : '⚠'}</span>
                    <span>{w.text}{w.link && <> <Link to={w.link}>Buka</Link></>}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="dash-grid">
            {d.piutang && (
              <div className="card flush">
                <div className="pad row between"><h3>Invoice paling lama tertunggak</h3><Link to="/piutang">Umur piutang →</Link></div>
                <table className="tbl compact">
                  <tbody>
                    {d.piutang.teratas.length === 0 && <tr><td className="ok-text">✓ Tidak ada invoice yang lewat jatuh tempo.</td></tr>}
                    {d.piutang.teratas.map((t) => (
                      <tr key={t.id}>
                        <td><Link to={`/penjualan?buka=${t.id}`} className="mono">{t.no}</Link><div className="small">{t.pelanggan}</div></td>
                        <td className="nowrap err-text">telat {t.hari} hari</td>
                        <td className="r">Rp {rp(t.sisa)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {d.kas && (
              <div className="card flush">
                <div className="pad row between"><h3>Saldo rekening</h3><Link to="/kas-bank">Kas & Bank →</Link></div>
                <table className="tbl compact">
                  <tbody>
                    {d.kas.rekening.map((k) => <tr key={k.id}><td>{k.nama}</td><td className={`r ${k.saldo < 0 ? 'neg' : ''}`}>Rp {rp(k.saldo)}</td></tr>)}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <h3>Progres pembangunan</h3>
            <ol className="roadmap">
              {ROADMAP.map((r, i) => <li key={i} className={r.done ? 'done' : ''}><span className="dot" /><b>{r.step}</b><span>{r.title}</span></li>)}
            </ol>
          </div>
        </>
      )}
    </>
  )
}

/** Beranda untuk peran tanpa izin dashboard (mis. kasir, admin): pintasan ke menu yang bisa dipakai. */
function QuickHome({ title }: { title: string }) {
  const { boot } = useSession()
  const items = useVisibleNav().filter((n) => n.path !== '/' && !n.step)
  return (
    <>
      <PageHead title={title} sub={`${boot?.company.nama} · ${boot?.user.role_nama}`} />
      <div className="quick-grid">
        {items.map((n) => <Link key={n.path} to={n.path} className="card quick"><span className="ic">{n.icon}</span><b>{n.label}</b></Link>)}
      </div>
    </>
  )
}

export function PlaceholderPage({ item }: { item: NavItem }) {
  const items = useVisibleNav()
  const ready = items.filter((n) => !n.step && n.path !== item.path)
  return (
    <>
      <PageHead title={item.label} />
      <div className="card empty">
        <div className="empty-ic">{item.icon}</div>
        <h3>Sedang dibangun</h3>
        <p className="muted">Halaman {item.label} dikerjakan di tahap <b>{item.step}</b>. Menu ini sudah tampil karena peran Anda punya akses dan modulnya aktif.</p>
        {ready.length > 0 && (
          <p className="hint">Yang sudah bisa dipakai: {ready.map((n, i) => (
            <span key={n.path}>{i > 0 && ', '}<Link to={n.path}>{n.label}</Link></span>
          ))}</p>
        )}
      </div>
    </>
  )
}

export function ForbiddenPage() {
  return (
    <>
      <PageHead title="Tidak ada akses" />
      <div className="card empty">
        <div className="empty-ic">⚿</div>
        <p className="warn-text">⚠ Peran Anda tidak punya izin untuk halaman ini, atau modulnya sedang nonaktif. Hubungi owner bila perlu akses.</p>
        <Link className="btn" to="/">Kembali</Link>
      </div>
    </>
  )
}
