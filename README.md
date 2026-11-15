# Neraca — Aplikasi Keuangan Bisnis

React (Vite) di GitHub Pages · API di Google Apps Script · database di Google Sheets.

- Web: https://jundicomp.github.io/laporankeuangan/
- Status: **Langkah 5 selesai** — pembelian & tagihan supplier, pembayaran utang bertahap, umur utang, persediaan perpetual (rata-rata) dengan kartu stok, pemakaian bahan, stok opname, HPP otomatis. Sebelumnya, MVP (Langkah 4) — invoice penjualan + cetak/PDF, piutang & pelunasan bertahap (termasuk potongan PPh 23), umur piutang, dashboard keuangan. (Langkah 1–3: login & akses, jurnal, buku besar, neraca saldo, tutup buku, kas & bank, master data, laporan LR & posisi keuangan, impor Excel, backup harian.)

```
laporankeuangan/
├─ .github/workflows/deploy.yml   build web → GitHub Pages otomatis
├─ apps-script/                   backend (Google Apps Script)
│  ├─ appsscript.json             manifest
│  ├─ Main.gs                     router: izin per aksi, batch, diagnostik
│  ├─ Util.gs                     akses sheet + cache, lock, ID, audit, penomoran
│  ├─ Setup.gs                    skema tab, COA, modul, peran & izin, setupTemplate(), upgradeSchema()
│  ├─ Auth.gs                     owner pertama, login, sesi, ganti password/username
│  ├─ Admin.gs                    bootstrap, pengguna, peran, modul, perusahaan, audit
│  ├─ Ledger.gs                   postJournal_ (satu pintu jurnal), buku besar, neraca saldo, COA, periode
│  ├─ Master.gs                   pelanggan, supplier, produk/jasa + impor
│  ├─ Cash.gs                     rekening kas/bank, pemasukan, pengeluaran, transfer
│  ├─ Report.gs                   laba rugi & posisi keuangan (SAK EP)
│  ├─ Sales.gs                    invoice, pelunasan, umur piutang, penagihan, dashboard
│  ├─ Purchase.gs                 tagihan pembelian, pembayaran utang, umur utang
│  ├─ Stock.gs                    persediaan rata-rata: mutasi, kartu stok, pemakaian, opname, stok awal
│  └─ Backup.gs                   backup harian ke Drive, impor saldo awal
└─ web/src/
   ├─ api/client.ts               panggilan API + token + batch
   ├─ auth/session.tsx            status login & data bootstrap
   ├─ nav.ts                      peta menu (izin + modul)
   ├─ components/                 layout sidebar, komponen kecil
   └─ pages/                      dashboard, penjualan, piutang, kas & bank, jurnal, laporan, master, pengaturan, …
```

---

## Update ke Langkah 6 (dari Langkah 5)

1. Di project **Neraca API**: ganti isi `main.gs`, `Setup`, `Report`, `Sales`.
2. Tambah 3 file baru (**+ → Skrip**): `Closing`, `Recon`, `Calk`.
3. Simpan, jalankan **upgradeSchema** (menambah tab `T_Rekon`, `T_CALK`, dan kolom `rekon` di `T_JurnalDetail`).
4. **Terapkan → Kelola deployment → ✏️ → Versi baru → Terapkan.**
5. Klik dua kali `kirim-ke-github.bat`.

Yang baru: **Laporan** → tab Arus kas, Perubahan ekuitas, CALK, Neraca lajur. **Tutup Buku** → kartu "Tutup buku tahunan" (jurnal penutup). **Rekonsiliasi Bank** muncul di menu setelah modul *Rekonsiliasi bank* diaktifkan di Pengaturan.

## Update ke Langkah 5 (dari Langkah 4)

1. Di project **Neraca API**: ganti isi `main.gs`, `Setup`, `Ledger`, `Master`, `Cash`, `Sales`.
2. Tambah 2 file baru (**+ → Skrip**): `Stock` dan `Purchase`.
3. Simpan, jalankan **upgradeSchema** (menambah kolom di `M_Produk`, `T_StokMutasi`, `T_Dokumen`).
4. **Terapkan → Kelola deployment → ✏️ → Versi baru → Terapkan.**
5. Klik dua kali `kirim-ke-github.bat`.

Mulai pakai:
1. **Pengaturan → Aktivasi modul**: nyalakan **Utang & jadwal bayar** (Pembelian ikut menyala) dan **Persediaan perpetual**.
2. **Master Data → Produk**: untuk bahan & barang dagang pilih tipe *barang* dan **Lacak stok: ya**; barang pesanan (spanduk, cetakan) pilih *tidak*.
3. **Persediaan → Stok awal**: rinci saldo awal persediaan per barang (qty × harga pokok) sampai halaman menyatakan cocok dengan buku besar.
4. **Utang → Utang lama**: catat tagihan supplier yang belum dibayar dari sebelum memakai aplikasi.

## Update ke Langkah 4 (dari Langkah 3)

1. Di project **Neraca API**: ganti isi `main.gs`, `Util`, `Setup`, `Admin`, `Ledger`, `Cash`.
2. Tambah 1 file baru (**+ → Skrip**): `Sales`.
3. Simpan, jalankan **upgradeSchema**. Log menampilkan kolom baru di `T_Dokumen`, `T_Pembayaran`, `T_KasBank`.
4. **Terapkan → Kelola deployment → ✏️ → Versi baru → Terapkan.**
5. Klik dua kali `kirim-ke-github.bat`.

Mulai pakai: **Pengaturan → Perusahaan → Ubah profil** (logo, rekening bank, penanda tangan — tampil di invoice). Bila ada piutang lama dari saldo awal, catat lewat **Piutang → Piutang lama (saldo awal)** supaya umur piutang cocok dengan buku besar. Setelah itu buat invoice di **Penjualan**.

## Update ke Langkah 3 (dari Langkah 2)

1. Di project **Neraca API**: ganti isi `appsscript.json`, `main.gs`, `Setup`, `Ledger`.
2. Tambah 4 file baru (**+ → Skrip**): `Master`, `Cash`, `Report`, `Backup`.
3. Simpan, jalankan **upgradeSchema**. Google akan minta izin tambahan (**Google Drive** untuk backup dan **trigger** untuk jadwal harian) — klik Izinkan. Log menampilkan `+ backup otomatis harian pukul 02.00`.
4. **Terapkan → Kelola deployment → ✏️ → Versi baru → Terapkan.**
5. Klik dua kali `kirim-ke-github.bat`.

Mulai pakai: **Impor & Backup → Impor saldo awal** (template Excel berisi semua akun neraca), lalu **Master Data**, lalu catat transaksi di **Kas & Bank**. Lihat hasilnya di **Laporan**.

## Update ke Langkah 2 (dari Langkah 1)

1. Di project **Neraca API**: ganti isi `main.gs`, `Util`, `Setup`, `Admin` dengan versi baru (`Auth` tidak berubah, tapi aman ditimpa juga).
2. Tambah file baru: **+ → Skrip** → `Ledger`, tempel isi `Ledger.gs`.
3. Simpan, jalankan **upgradeSchema**. Log akan menampilkan kolom baru di `T_Jurnal` dan, bila ada, perbaikan kode akun/periode yang sempat diubah Google Sheets menjadi tanggal.
4. **Terapkan → Kelola deployment → ✏️ → Versi baru → Terapkan.**
5. Klik dua kali `kirim-ke-github.bat`.

Setelah itu: menu **Jurnal & Buku Besar** dan **Tutup Buku** aktif. Mulai dengan jurnal jenis **SA · Saldo awal** per tanggal mulai pembukuan.

## Update ke Langkah 1 (dari Langkah 0)

### 1. Perbarui Apps Script

Buka project **Neraca API** di script.google.com. Isi file bisa disalin dari GitHub (buka file → tombol *Copy raw file*).

| File di editor | Tindakan |
|---|---|
| `main.gs` | ganti seluruh isi dengan `Main.gs` |
| `Util.gs` | ganti seluruh isi |
| `Setup.gs` | ganti seluruh isi |
| `Auth.gs` | **baru** — klik **+ → Skrip**, beri nama `Auth`, tempel |
| `Admin.gs` | **baru** — klik **+ → Skrip**, beri nama `Admin`, tempel |
| `appsscript.json` | tidak berubah |

Simpan (Ctrl+S), lalu pilih fungsi **upgradeSchema** → **Jalankan**. Di *Log eksekusi* muncul:

```
upgradeSchema 0.2.0 selesai.
+ 9 peran bawaan
KODE SETUP OWNER: XXXXXXXX
```

Catat **kode setup** itu.

### 2. Deploy versi baru (URL tetap sama)

**Terapkan → Kelola deployment → ✏️ Edit → Versi: Versi baru → Terapkan.**
Jangan pilih "Deployment baru" — itu membuat URL baru.

### 3. Perbarui web

Di folder proyek: `git add -A`, `git commit -m "Langkah 1"`, `git push`. Tunggu workflow di tab **Actions** hijau (±1 menit).

### 4. Buat akun owner

Buka web-nya → muncul halaman **Buat akun owner** → isi kode setup, nama perusahaan, nama, username, password. Setelah itu kode setup tidak berlaku lagi.

---

## Instal baru (tanpa Langkah 0)

1. script.google.com → **New project** `Neraca API` → Project Settings → centang *Show appsscript.json*.
2. Buat file `Main`, `Util`, `Setup`, `Auth`, `Admin` dan tempel isinya; timpa `appsscript.json`.
3. Jalankan **setupTemplate** (membuat spreadsheet "Neraca — Database" + kode setup owner di log).
4. **Terapkan → Deployment baru → Aplikasi web**, *Jalankan sebagai: Saya*, *Akses: Siapa saja*. Salin URL `/exec`.
5. GitHub repo → Settings → Pages → *Source: GitHub Actions*; Settings → Secrets and variables → Actions → Variables → `VITE_API_URL` = URL `/exec`.
6. Push ke `main`, buka web, buat akun owner.

## Setiap kali kode Apps Script diperbarui

1. Tempel file yang berubah.
2. Jalankan **upgradeSchema** (aman diulang; hanya menambah yang belum ada).
3. **Kelola deployment → Edit → Versi baru → Terapkan.**

---

## Keamanan

- Password disimpan sebagai hash SHA-256 berulang + salt per pengguna, tidak pernah tersimpan polos.
- Token sesi berlaku 8 jam, disimpan di sessionStorage (hilang saat tab ditutup).
- 3× salah password → akun dikunci 15 menit. Semua login tercatat di riwayat.
- Setiap aksi dicek izinnya **di server** — menyembunyikan menu di React hanya untuk kenyamanan.
- Ganti peran, nonaktifkan pengguna, atau reset password → semua sesi pengguna itu langsung dicabut.
- Owner pertama hanya bisa dibuat dengan kode setup dari log Apps Script.
- Jangan bagikan file spreadsheet "Neraca — Database" ke orang lain; akses data seharusnya lewat aplikasi.

## Peran bawaan

Owner · Direktur · Finance · Accounting · Admin · Kasir · Gudang · HR & Payroll · Auditor. Matriks izinnya bisa dilihat di menu **Pengguna & Akses → Peran & izin**.

## Aturan akuntansi yang ditegakkan server

- Semua jurnal posted lewat satu fungsi `postJournal_` — debit = kredit, minimal 2 baris, akun harus detail & aktif, tanggal di periode terbuka.
- Jurnal posted tidak bisa diedit atau dihapus. Pembatalan membuat jurnal pembalik (JR) bertanggal sama + alasan wajib; jurnal asal tetap terlihat berstatus *Dibatalkan*.
- Nomor jurnal otomatis per jenis per tahun: `JU/2026/10/0001`. Draft belum punya nomor.
- Jurnal penyesuaian bisa diberi pembalik otomatis tanggal 1 bulan berikutnya.
- Bila modul **Approval bertingkat** aktif, pengguna tanpa izin *setujui jurnal* hanya bisa mengajukan; pembuat tidak boleh menyetujui jurnalnya sendiri.
- Periode yang dikunci menolak posting & pembatalan. Membuka kembali hanya owner, wajib alasan.
- Akun yang sudah dipakai tidak bisa diubah saldo normalnya atau dijadikan header; nonaktif hanya bila saldonya nol.

## Aturan Kas & Bank

- Pemasukan: debit rekening, kredit akun pendapatan/lawan. Pengeluaran: debit akun beban/lawan, kredit rekening. Transfer: debit tujuan, kredit asal.
- Jurnal dibuat otomatis (KM/KK/TR) dan tidak bisa dibatalkan dari menu Jurnal — batalkan dari Kas & Bank supaya dokumen & jurnal tetap sinkron.
- Saldo kas tunai dan kas kecil tidak boleh minus; rekening bank boleh (overdraft) dengan tetap tercatat.
- Peran tanpa izin *lihat saldo rekening bank* (mis. Kasir) tidak melihat dan tidak bisa bertransaksi di rekening bank.

## Aturan Penjualan & Piutang

- Invoice draft belum bernomor dan belum masuk pembukuan. Saat **diposting**: Dr Piutang usaha (total), Dr Potongan penjualan (diskon), Cr Pendapatan per akun, Cr PPN keluaran. Angka dihitung ulang di server.
- Nomor invoice otomatis `INV/2026/10/0001` (format bisa diubah di tab `SYS_Setting`, kunci `format_nomor_invoice`).
- Jatuh tempo otomatis = tanggal + TOP pelanggan (atau TOP default perusahaan), bisa diubah per invoice.
- Batas kredit pelanggan: posting yang membuat piutang melewati batas ditahan dengan peringatan; bisa tetap diposting dengan centang konfirmasi (tercatat di audit log).
- Pelunasan boleh bertahap. Jurnal: Dr Kas/Bank (uang diterima) + Dr akun potongan (PPh 23 dipotong → Pajak dibayar di muka, biaya transfer, dll.), Cr Piutang. Pelunasan otomatis tampil di Kas & Bank tapi hanya bisa dibatalkan dari invoice-nya.
- Invoice yang sudah menerima pembayaran tidak bisa dibatalkan sebelum pembayarannya dibatalkan.
- Piutang lama (sebelum memakai aplikasi) dicatat sebagai invoice saldo awal tanpa jurnal baru. Umur piutang selalu dibandingkan dengan saldo buku besar akun piutang; selisih ditandai di halaman Piutang dan dashboard.
- Cetak/PDF: tombol **Cetak / PDF** di invoice → pilih *Simpan sebagai PDF* di jendela cetak; nama file otomatis = nomor invoice.

## Aturan Pembelian, Utang & Persediaan

- Tagihan pembelian diposting: Dr Persediaan (barang yang dilacak stoknya) / Dr akun biaya pilihan per baris · Dr PPN masukan · Cr Utang usaha. Diskon nota dibagi proporsional ke baris sehingga harga pokok stok sudah bersih.
- Nomor internal `BL/2026/10/0001`; nomor tagihan supplier yang sama untuk supplier yang sama diperingatkan (bisa dilewati dengan konfirmasi).
- Pembayaran utang bertahap: Dr Utang usaha · Cr Kas/Bank · Cr akun potongan (PPh 23 yang kita potong → 2-1203 Utang PPh 23). Kas tunai tidak boleh minus. Pembayaran tampil di Kas & Bank, dibatalkan dari tagihannya.
- Persediaan memakai rata-rata tertimbang. Saldo persediaan = jumlah nilai semua mutasi aktif, dan setiap mutasi dibuat bersama jurnalnya, jadi kartu stok selalu sama dengan buku besar (selisih ditandai).
- Invoice barang yang dilacak stoknya otomatis mencatat HPP (Dr 5-1101, Cr Persediaan). Penjualan ditolak bila stok kurang (kecuali `stok_minus_boleh` = `ya` di `SYS_Setting`).
- Pemakaian bahan: Dr akun pilihan (default 5-1101 HPP) / Cr Persediaan. Stok opname: selisih ke 5-1301 Selisih persediaan. Stok awal tidak membuat jurnal.
- Tagihan pembelian tidak bisa dibatalkan bila barangnya sudah terjual/terpakai sehingga stok akan minus.

## Aturan siklus akhir periode

- **Neraca lajur**: akun laba rugi memakai mutasi periode, akun neraca memakai saldo kumulatif; kolom penyesuaian = jurnal JP dalam periode. Jurnal penutup tidak ikut.
- **Jurnal penutup (JT)** bertanggal akhir tahun buku: pendapatan & beban → 3-9999 Ikhtisar laba rugi → 3-2101 Saldo laba; prive (3-3101) ikut ditutup ke saldo laba (bisa dimatikan). Hanya satu per tahun buku, hanya setelah tahun berakhir, dan periode akhir tahun harus masih terbuka. Pembatalannya membuat jurnal JT pembalik.
- Laporan laba rugi dan dashboard selalu mengabaikan JT, jadi angka tahun yang sudah ditutup tetap tampil; neraca & perubahan ekuitas memperhitungkannya.
- **Arus kas** metode tidak langsung: laba bersih + akumulasi penyusutan ± perubahan aset lancar & liabilitas jangka pendek (operasi), perubahan aset tetap (investasi), pinjaman bank & ekuitas non-laba (pendanaan). Kenaikan kas dicocokkan dengan saldo kas & bank; jurnal saldo awal (SA) dihitung sebagai saldo pembuka.
- **CALK**: angka per catatan diambil otomatis (tahun ini vs tahun lalu); teks tiap catatan bisa diubah per tahun buku dan dikembalikan ke teks bawaan.
- **Rekonsiliasi bank**: baris jurnal ke akun rekening yang muncul di koran dicentang. Saldo hitung = saldo buku − setoran dalam perjalanan + pengeluaran beredar; final hanya bila sama dengan saldo koran. Transaksi Kas & Bank yang sudah cocok tidak bisa dibatalkan sampai rekonsiliasinya dibuka kembali.

## Berikutnya

Aset tetap & penyusutan, payroll, pajak → anggaran, paket laporan bankable, multi perusahaan.
