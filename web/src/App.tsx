import type { ReactElement } from 'react'
import { createHashRouter, Navigate, Route, RouterProvider, Routes } from 'react-router-dom'
import { SessionProvider, useSession } from './auth/session'
import Layout from './components/Layout'
import { Spinner } from './components/ui'
import { NAV, type NavItem } from './nav'
import { AuditPage } from './pages/Audit'
import { BackupPage } from './pages/Backup'
import { CashBankPage } from './pages/CashBank'
import { MasterPage } from './pages/MasterData'
import { ReportsPage } from './pages/Reports'
import { ReceivablesPage } from './pages/Receivables'
import { SalesPage } from './pages/Sales'
import { JournalPage } from './pages/Journal'
import { JournalFormPage } from './pages/JournalForm'
import { PeriodsPage } from './pages/Periods'
import { ConnectPage, LoginPage, SetupOwnerPage } from './pages/Auth'
import { ForbiddenPage, HomePage, PlaceholderPage } from './pages/Home'
import { ProfilePage } from './pages/Profile'
import { SettingsPage } from './pages/Settings'
import { UsersPage } from './pages/Users'

const BUILT: Record<string, () => ReactElement> = {
  '/': () => <HomePage />,
  '/pengguna': () => <UsersPage />,
  '/audit': () => <AuditPage />,
  '/pengaturan': () => <SettingsPage />,
  '/jurnal': () => <JournalPage />,
  '/tutup-buku': () => <PeriodsPage />,
  '/master': () => <MasterPage />,
  '/kas-bank': () => <CashBankPage />,
  '/laporan': () => <ReportsPage />,
  '/backup': () => <BackupPage />,
  '/penjualan': () => <SalesPage />,
  '/piutang': () => <ReceivablesPage />,
}

const JOURNAL_FORM: NavItem = { path: '/jurnal/baru', label: 'Jurnal baru', icon: '≡', perm: 'jurnal.edit', module: 'akuntansi' }

/** Halaman hanya bisa dibuka bila peran punya izin dan modulnya aktif — sama dengan aturan di server. */
function Guard({ item, page: override }: { item: NavItem; page?: ReactElement }) {
  const { can, modOn } = useSession()
  if (!can(item.perm) || !modOn(item.module)) {
    if (item.path === '/') return <HomePage />
    return <ForbiddenPage />
  }
  if (override) return override
  const page = BUILT[item.path]
  return page ? page() : <PlaceholderPage item={item} />
}

function Gate() {
  const { status } = useSession()
  if (status === 'checking') return <div className="boot"><Spinner label="Menghubungkan ke server…" /></div>
  if (status === 'no-url' || status === 'offline') return <ConnectPage />
  if (status === 'needs-owner') return <SetupOwnerPage />
  if (status === 'signed-out') return <LoginPage />
  return (
    <Routes>
      <Route element={<Layout />}>
        {NAV.map((n) => <Route key={n.path} path={n.path} element={<Guard item={n} />} />)}
        <Route path="/jurnal/baru" element={<Guard item={JOURNAL_FORM} page={<><JournalPage /><JournalFormPage /></>} />} />
        <Route path="/jurnal/:id" element={<Guard item={JOURNAL_FORM} page={<><JournalPage /><JournalFormPage /></>} />} />
        <Route path="/profil" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

// Data router dibutuhkan agar modal bisa menahan tombol Back browser (useBlocker).
const router = createHashRouter([{ path: '*', element: <Gate /> }])

export default function App() {
  return (
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>
  )
}
