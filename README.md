# Neraca — Aplikasi Keuangan Bisnis

React (Vite) di GitHub Pages · API di Google Apps Script · database di Google Sheets.

- Web: https://jundicomp.github.io/laporankeuangan/
- Status: **Langkah 1 selesai** — login, akun owner, peran & hak akses, pengguna, audit log, aktivasi modul, profil.

```
laporankeuangan/
├─ .github/workflows/deploy.yml   build web → GitHub Pages otomatis
├─ apps-script/                   backend (Google Apps Script)
│  ├─ appsscript.json             manifest
│  ├─ Main.gs                     router: izin per aksi, batch, diagnostik
│  ├─ Util.gs                     akses sheet + cache, lock, ID, audit, penomoran
│  ├─ Setup.gs                    skema tab, COA, modul, peran & izin, setupTemplate(), upgradeSchema()
│  ├─ Auth.gs                     owner pertama, login, sesi, ganti password/username
│  └─ Admin.gs                    bootstrap, pengguna, peran, modul, perusahaan, audit
└─ web/src/
   ├─ api/client.ts               panggilan API + token + batch
   ├─ auth/session.tsx            status login & data bootstrap
   ├─ nav.ts                      peta menu (izin + modul)
   ├─ components/                 layout sidebar, komponen kecil
   └─ pages/                      login, setup owner, beranda, pengguna, audit, pengaturan, profil
```

---

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

## Berikutnya: Langkah 2

Chart of accounts, form jurnal umum, buku besar, neraca saldo, kunci periode — dengan `ledger.post()` sebagai satu-satunya pintu masuk jurnal.
