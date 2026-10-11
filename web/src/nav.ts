/**
 * Peta menu. Setiap item disaring berdasarkan izin peran (perm) dan modul aktif (module).
 * `step` = langkah pengembangan yang akan mengisi halaman itu (selama belum dibangun).
 */
export type NavItem = {
  path: string
  label: string
  icon: string
  group?: string
  perm?: string
  module?: string
  step?: string
}

export const NAV: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: '◧', perm: 'dashboard.view', step: 'Langkah 4' },
  { group: 'Data', path: '/master', label: 'Master Data', icon: '▤', perm: 'master.view', step: 'Langkah 3' },
  { group: 'Transaksi', path: '/penjualan', label: 'Penjualan', icon: '↗', perm: 'penjualan.view', module: 'penjualan', step: 'Langkah 4' },
  { path: '/pembelian', label: 'Pembelian', icon: '↙', perm: 'pembelian.view', module: 'pembelian', step: 'setelah MVP' },
  { path: '/kas-bank', label: 'Kas & Bank', icon: '◎', perm: 'kas.view', module: 'kasbank', step: 'Langkah 3' },
  { path: '/piutang', label: 'Piutang', icon: '→', perm: 'penjualan.view', module: 'piutang', step: 'Langkah 4' },
  { path: '/utang', label: 'Utang', icon: '←', perm: 'pembelian.view', module: 'utang', step: 'setelah MVP' },
  { path: '/persediaan', label: 'Persediaan', icon: '▦', perm: 'persediaan.view', module: 'persediaan', step: 'setelah MVP' },
  { path: '/aset', label: 'Aset Tetap', icon: '▣', perm: 'aset.view', module: 'aset', step: 'setelah MVP' },
  { group: 'Akuntansi', path: '/jurnal', label: 'Jurnal & Buku Besar', icon: '≡', perm: 'jurnal.view', module: 'akuntansi' },
  { path: '/tutup-buku', label: 'Tutup Buku', icon: '◫', perm: 'jurnal.view', module: 'laporan' },
  { path: '/laporan', label: 'Laporan', icon: '▥', perm: 'laporan.view', module: 'laporan', step: 'Langkah 3' },
  { path: '/anggaran', label: 'Anggaran & Analisis', icon: '◔', perm: 'anggaran.view', module: 'anggaran', step: 'setelah MVP' },
  { group: 'SDM & Pajak', path: '/payroll', label: 'Payroll', icon: '☺', perm: 'payroll.view', module: 'payroll', step: 'setelah MVP' },
  { path: '/pajak', label: 'Pajak', icon: '%', perm: 'pajak.view', module: 'pajak', step: 'setelah MVP' },
  { group: 'Sistem', path: '/pengguna', label: 'Pengguna & Akses', icon: '⚿', perm: 'user.manage' },
  { path: '/audit', label: 'Audit Log', icon: '⌕', perm: 'audit.view' },
  { path: '/backup', label: 'Impor & Backup', icon: '⇅', perm: 'backup.run', step: 'Langkah 3' },
  { path: '/pengaturan', label: 'Pengaturan', icon: '⚙', perm: 'setting.edit' },
]
