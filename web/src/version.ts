/**
 * Versi aplikasi & riwayat update — tampil di kaki sidebar.
 * Setiap rilis: tambahkan entri baru PALING ATAS dan ubah APP_VERSION.
 */
export const APP_NAME = 'Neraca'
export const APP_VERSION = '1.0.1'

export type ChangeType = 'baru' | 'tingkat' | 'perbaikan'
export const CHANGE_LABEL: Record<ChangeType, string> = { baru: 'Fitur baru', tingkat: 'Peningkatan', perbaikan: 'Perbaikan' }

export type Release = { version: string; date: string; title: string; changes: { type: ChangeType; text: string }[] }

export const CHANGELOG: Release[] = [
  {
    version: '1.0.1', date: '2026-11-15', title: 'Update server sekali klik',
    changes: [
      { type: 'tingkat', text: 'deploy.bat: semua file Apps Script diunggah, versi deployment dibuat, dan kode web dikirim ke GitHub dalam satu langkah.' },
      { type: 'tingkat', text: 'upgradeSchema berjalan otomatis pada request pertama setelah kode server diperbarui.' },
    ],
  },
  {
    version: '1.0.0', date: '2026-11-15', title: 'Roadmap lengkap',
    changes: [
      { type: 'tingkat', text: 'Semua langkah pembangunan selesai: akuntansi, penjualan, pembelian, persediaan, kas & bank, aset, payroll, pajak, siklus akhir periode, anggaran, rasio, dan paket bankable.' },
      { type: 'tingkat', text: 'Satu aplikasi untuk satu perusahaan — modul "Multi perusahaan" dihapus dari daftar aktivasi.' },
    ],
  },
  {
    version: '0.10.0', date: '2026-11-15', title: 'Langkah 9 — Paket laporan bankable',
    changes: [
      { type: 'baru', text: 'Menu Paket Bankable: satu dokumen PDF berisi sampul, surat pernyataan manajemen, ringkasan, laporan posisi keuangan, laba rugi, perubahan ekuitas, arus kas, CALK, dan analisis rasio — komparatif dengan tahun lalu.' },
      { type: 'baru', text: 'Lampiran yang biasa diminta analis kredit: omzet & laba 24 bulan, saldo & mutasi rekening 12 bulan, umur piutang & utang, daftar aset tetap, kepatuhan pajak.' },
      { type: 'baru', text: 'Daftar periksa kesiapan sebelum ke bank: neraca seimbang, periode dikunci, tutup buku, rekonsiliasi bank, buku pembantu cocok dengan buku besar, pajak tidak terlambat.' },
      { type: 'tingkat', text: 'Paket bisa diunduh sebagai Excel (satu sheet per laporan) dan bagian-bagiannya bisa dipilih.' },
    ],
  },
  {
    version: '0.9.0', date: '2026-11-15', title: 'Langkah 8 — Anggaran & analisis rasio',
    changes: [
      { type: 'baru', text: 'Susun anggaran laba rugi per akun per bulan; salin dari realisasi tahun lalu + pertumbuhan %, atau ketik total setahun untuk dibagi rata.' },
      { type: 'baru', text: 'Realisasi vs anggaran per bulan atau sejak awal tahun: selisih, capaian %, proyeksi akhir tahun, grafik laba bulanan, ekspor Excel.' },
      { type: 'baru', text: 'Analisis rasio keuangan: likuiditas, solvabilitas (DER, utang bank/EBITDA, kemampuan bayar bunga), profitabilitas, dan perputaran piutang/persediaan/utang, dibanding tahun lalu dengan status sehat/perlu perhatian.' },
      { type: 'tingkat', text: 'Dashboard mengingatkan bila beban melewati anggaran atau pendapatan masih jauh di bawah target.' },
    ],
  },
  {
    version: '0.8.0', date: '2026-11-15', title: 'Langkah 7 — Aset tetap, payroll & pajak',
    changes: [
      { type: 'baru', text: 'Aset tetap: daftar aset per kategori, beli dari kas/bank atau utang, aset lama dari saldo awal, jadwal penyusutan garis lurus & saldo menurun.' },
      { type: 'baru', text: 'Proses penyusutan bulanan sekali klik (jurnal penyesuaian), jual/hapus aset dengan laba/rugi otomatis, cocokkan daftar aset dengan buku besar.' },
      { type: 'baru', text: 'Payroll: data karyawan, penggajian bulanan dengan lembur/bonus/THR/kasbon, BPJS Kesehatan & Ketenagakerjaan, slip gaji cetak/PDF, pembayaran gaji.' },
      { type: 'baru', text: 'PPh 21 otomatis: tarif efektif (TER) Januari–November, hitung ulang setahun Pasal 17 di Desember atau saat karyawan keluar; rekap tahunan untuk 1721-A1.' },
      { type: 'baru', text: 'Pajak: rekap PPN, PPh 21/23/4(2), PPh 25 dan PPh final UMKM per masa, catat setoran + NTPN, kompensasi PPN masukan, kalender jatuh tempo.' },
      { type: 'tingkat', text: 'CALK menampilkan tabel mutasi aset tetap; dashboard mengingatkan pajak jatuh tempo, penyusutan & gaji yang belum diproses.' },
    ],
  },
  {
    version: '0.7.0', date: '2026-11-15', title: 'Langkah 6 — Siklus akuntansi PSAK lengkap',
    changes: [
      { type: 'baru', text: 'Neraca lajur (worksheet): neraca saldo, penyesuaian, neraca saldo disesuaikan, laba rugi, dan posisi keuangan dalam satu tabel.' },
      { type: 'baru', text: 'Jurnal penutup tahunan otomatis: pendapatan & beban → ikhtisar laba rugi → saldo laba, prive ikut ditutup; bisa dibatalkan owner.' },
      { type: 'baru', text: 'Laporan arus kas metode tidak langsung (operasi, investasi, pendanaan) yang dicocokkan dengan saldo kas.' },
      { type: 'baru', text: 'Laporan perubahan ekuitas dan Catatan atas Laporan Keuangan (CALK) dengan angka otomatis & teks yang bisa diedit.' },
      { type: 'baru', text: 'Rekonsiliasi bank: centang transaksi yang muncul di rekening koran, hitung setoran dalam perjalanan & pengeluaran beredar.' },
      { type: 'tingkat', text: 'Laporan laba rugi dan dashboard mengabaikan jurnal penutup, jadi angka tahun yang sudah ditutup tetap terlihat.' },
    ],
  },
  {
    version: '0.6.3', date: '2026-11-15', title: 'Warna sidebar lebih kalem',
    changes: [
      { type: 'tingkat', text: 'Aksen kuning di sidebar diganti hijau mint lembut; judul grup modul memakai warna sage yang tenang dan menyala saat aktif/di-hover.' },
    ],
  },
  {
    version: '0.6.2', date: '2026-11-15', title: 'Perbaikan lupa password',
    changes: [
      { type: 'perbaikan', text: 'Email/username yang tersalin bersama apostrof (\') dari Google Sheets tetap dikenali saat lupa password dan login.' },
      { type: 'perbaikan', text: 'upgradeSchema membersihkan apostrof di depan email pengguna yang terlanjur tersimpan.' },
      { type: 'tingkat', text: 'Bila server Apps Script belum diperbarui, pesan error menjelaskan langkah deploy versi baru.' },
    ],
  },
  {
    version: '0.6.1', date: '2026-11-12', title: 'Lupa password lewat email',
    changes: [
      { type: 'baru', text: 'Tombol "Lupa password?" di halaman masuk: link untuk membuat password baru dikirim ke email (berlaku 30 menit, sekali pakai).' },
      { type: 'baru', text: 'Email pemulihan bisa diisi/diganti sendiri di menu Profil.' },
      { type: 'tingkat', text: 'Owner tanpa email tetap bisa memulihkan akun: link dikirim ke email perusahaan atau akun Google pemilik aplikasi.' },
    ],
  },
  {
    version: '0.6.0', date: '2026-10-12', title: 'Langkah 5 — Pembelian, utang & persediaan',
    changes: [
      { type: 'baru', text: 'Tagihan pembelian dari supplier: draft, posting otomatis ke utang, persediaan/biaya, dan PPN masukan; peringatan nomor tagihan supplier ganda.' },
      { type: 'baru', text: 'Pembayaran utang bertahap dari kas/bank, termasuk potongan PPh 23 yang kita potong; umur utang dan utang lama dari saldo awal.' },
      { type: 'baru', text: 'Persediaan perpetual metode rata-rata: kartu stok, stok awal, pemakaian bahan, stok opname, peringatan stok minimum.' },
      { type: 'baru', text: 'HPP otomatis saat invoice barang diposting; penjualan ditolak bila stok tidak cukup.' },
      { type: 'tingkat', text: 'Master produk: pilihan "Lacak stok" untuk membedakan bahan/barang dagang dengan barang pesanan.' },
      { type: 'tingkat', text: 'Dashboard menampilkan utang supplier, nilai persediaan, dan selisih buku besar vs kartu stok / daftar tagihan.' },
    ],
  },
  {
    version: '0.5.2', date: '2026-10-12', title: 'Logo penuh',
    changes: [
      { type: 'perbaikan', text: 'Logo di kop sidebar tampil penuh tanpa bingkai putih; tepi putih/transparan pada logo dipotong otomatis.' },
      { type: 'tingkat', text: 'Logo yang diunggah di Pengaturan → Perusahaan langsung dirapikan (tepi kosong dibuang) sebelum disimpan, jadi invoice juga ikut rapi.' },
    ],
  },
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
