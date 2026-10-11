import { Link } from 'react-router-dom'
import { useSession } from '../auth/session'
import { PageHead } from '../components/ui'
import { useVisibleNav } from '../components/Layout'
import type { NavItem } from '../nav'

const ROADMAP = [
  { step: 'Langkah 1', title: 'Login, peran & hak akses, audit log, aktivasi modul', done: true },
  { step: 'Langkah 2', title: 'Chart of accounts, form jurnal umum, buku besar, neraca saldo, kunci periode' },
  { step: 'Langkah 3', title: 'Kas & bank, master data, laba rugi & posisi keuangan, impor saldo awal, backup' },
  { step: 'Langkah 4', title: 'Invoice + PDF, piutang, dashboard — MVP selesai' },
]

export function HomePage() {
  const { boot } = useSession()
  const hour = new Date().getHours()
  const greet = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 18 ? 'Selamat sore' : 'Selamat malam'
  const active = boot?.modules.filter((m) => m.aktif).length ?? 0
  return (
    <>
      <PageHead title={`${greet}, ${boot?.user.nama.split(' ')[0]}`} sub={`${boot?.company.nama} · ${boot?.user.role_nama}`} />
      <div className="kpis">
        <div className="card kpi"><span>Akun di COA</span><b>{boot?.coa.filter((a) => String(a.is_header).toUpperCase() !== 'TRUE').length}</b></div>
        <div className="card kpi"><span>Modul aktif</span><b>{active} / {boot?.modules.length}</b></div>
        <div className="card kpi"><span>Kerangka laporan</span><b>{boot?.settings.kerangka_sak ?? 'SAK EP'}</b></div>
        <div className="card kpi"><span>Rekening kas & bank</span><b>{boot?.kasbank.length}</b></div>
      </div>
      <div className="card">
        <h3>Progres pembangunan</h3>
        <ol className="roadmap">
          {ROADMAP.map((r) => (
            <li key={r.step} className={r.done ? 'done' : ''}>
              <span className="dot" />
              <b>{r.step}</b>
              <span>{r.title}</span>
            </li>
          ))}
        </ol>
        <p className="muted small">Dashboard keuangan lengkap (omzet, laba, kas, piutang, peringatan) muncul di Langkah 4, setelah ada transaksi yang bisa dihitung.</p>
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
        <p className="muted">Halaman {item.label} dikerjakan di <b>{item.step}</b>. Menu ini sudah tampil karena peran Anda punya akses dan modulnya aktif.</p>
        {ready.length > 0 && (
          <p className="muted small">Yang sudah bisa dipakai: {ready.map((n, i) => (
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
        <p className="muted">Peran Anda tidak punya izin untuk halaman ini, atau modulnya sedang nonaktif. Hubungi owner bila perlu akses.</p>
        <Link className="btn" to="/">Kembali</Link>
      </div>
    </>
  )
}
