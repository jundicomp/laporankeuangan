/**
 * Versi aplikasi & riwayat update — tampil di kaki sidebar.
 * Setiap rilis: tambahkan entri baru PALING ATAS dan ubah APP_VERSION.
 */
export const APP_NAME = 'Neraca'
export const APP_VERSION = '0.5.1'

export type ChangeType = 'baru' | 'tingkat' | 'perbaikan'
export const CHANGE_LABEL: Record<ChangeType, string> = { baru: 'Fitur baru', tingkat: 'Peningkatan', perbaikan: 'Perbaikan' }

export type Release = { version: string; date: string; title: string; changes: { type: ChangeType; text: string }[] }

export const CHANGELOG: Release[] = [
  {
    version: '0.5.1', date: '2026-10-12', title: 'Tampilan sidebar',
    changes: [
      { type: 'tingkat', text: 'Tombol burger menciutkan sidebar menjadi ikon; arahkan mouse ke ikon untuk melihat nama menu.' },
      { type: 'tingkat', text: 'Menu dikelompokkan per modul dan hanya kelompok yang dipilih yang terbuka, jadi sidebar tidak perlu digulung.' },
      { type: 'tingkat', text: 'Kop sidebar memakai logo dan nama usaha.' },
      { type: 'baru', text: 'Versi aplikasi dan riwayat update di kaki sidebar.' },
    ],
  },
  {
    version: '0.5.0', date: '2026-10-12', title: 'Langkah 4 — MVP selesai',
    changes: [
      { type: 'baru', text: 'Invoice penjualan: draft, posting otomatis ke jurnal, cetak / simpan PDF dengan logo, rekening, dan terbilang.' },
      { type: 'baru', text: 'Pelunasan piutang bertahap, termasuk potongan PPh 23 dan biaya transfer.' },
      { type: 'baru', text: 'Umur piutang per tanggal, catatan penagihan, dan piutang lama dari saldo awal.' },
      { type: 'baru', text: 'Dashboard keuangan: pendapatan, laba, kas, piutang, tren 6 bulan, dan peringatan.' },
      { type: 'tingkat', text: 'Profil perusahaan: logo, rekening bank, penanda tangan, dan catatan kaki invoice.' },
      { type: 'perbaikan', text: 'Kode akun tidak lagi berubah menjadi tanggal saat satu baris data diubah.' },
    ],
  },
  {
    version: '0.4.0', date: '2026-10-12', title: 'Langkah 3',
    changes: [
      { type: 'baru', text: 'Kas & Bank: pemasukan, pengeluaran, transfer, rekening dengan akun COA otomatis.' },
      { type: 'baru', text: 'Master data pelanggan, supplier, produk/jasa + impor Excel.' },
      { type: 'baru', text: 'Laporan Laba Rugi dan Posisi Keuangan (SAK EP), pembanding, cetak, Excel.' },
      { type: 'baru', text: 'Impor saldo awal dari template Excel dan backup harian ke Google Drive.' },
      { type: 'tingkat', text: 'Tombol Back browser ditahan selama ada isian yang belum disimpan.' },
    ],
  },
  {
    version: '0.3.1', date: '2026-10-12', title: 'Revisi tampilan form',
    changes: [
      { type: 'tingkat', text: 'Semua form isian menjadi jendela modal yang menutupi menu.' },
      { type: 'tingkat', text: 'Tanda wajib bintang merah; warna berbeda untuk info, peringatan, dan error.' },
      { type: 'perbaikan', text: 'Tombol Posting jurnal menjelaskan alasan bila belum bisa diklik.' },
    ],
  },
  {
    version: '0.3.0', date: '2026-10-12', title: 'Langkah 2',
    changes: [
      { type: 'baru', text: 'Chart of accounts, jurnal umum/penyesuaian/saldo awal, approval, pembatalan dengan jurnal pembalik.' },
      { type: 'baru', text: 'Buku besar, neraca saldo, dan kunci periode / tutup buku.' },
    ],
  },
  {
    version: '0.2.0', date: '2026-10-12', title: 'Langkah 1',
    changes: [
      { type: 'baru', text: 'Login, akun owner, 9 peran dan hak akses, pengguna, audit log, riwayat login.' },
      { type: 'baru', text: 'Aktivasi modul dengan ketergantungan otomatis.' },
    ],
  },
  {
    version: '0.1.0', date: '2026-10-11', title: 'Langkah 0',
    changes: [{ type: 'baru', text: 'Kerangka aplikasi: React di GitHub Pages, Apps Script, database Google Sheets.' }],
  },
]
