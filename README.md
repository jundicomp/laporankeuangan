# Neraca — Aplikasi Keuangan Bisnis

React (Vite) di GitHub Pages · API di Google Apps Script · database di Google Sheets.

Repo ini sekarang berisi **Langkah 0**: membuktikan jalur React → Apps Script → Google Sheets bekerja, sekaligus membuat spreadsheet database lengkap (34 tab, COA standar 76 akun, daftar modul untuk menu aktivasi).

```
neraca/
├─ .github/workflows/deploy.yml   build web → GitHub Pages otomatis
├─ apps-script/                   backend (Google Apps Script)
│  ├─ appsscript.json             manifest: zona waktu, scope, setelan Web App
│  ├─ Main.gs                     doPost router + aksi Langkah 0
│  ├─ Util.gs                     error, akses sheet, lock, ID
│  └─ Setup.gs                    skema 34 tab, COA, modul, setupTemplate()
└─ web/                           frontend React + TypeScript
   └─ src/
      ├─ api/client.ts            panggilan API (text/plain, tanpa preflight CORS)
      └─ App.tsx                  halaman uji koneksi Langkah 0
```

---

## A. Pasang backend Apps Script (±10 menit)

Cara paling cepat, tanpa instal apa pun:

1. Buka <https://script.google.com> → **New project**. Beri nama `Neraca API`.
2. **Project Settings** (ikon gerigi) → centang **Show "appsscript.json" manifest file in editor**.
3. Kembali ke **Editor**, lalu salin isi file dari folder `apps-script/`:
   - `appsscript.json` → timpa isi manifest yang ada.
   - Ganti nama `Code.gs` jadi `Main.gs`, tempel isi `Main.gs`.
   - Tambah file script baru `Util` dan `Setup`, tempel isinya.
4. Pilih fungsi **setupTemplate** di toolbar → **Run**. Izinkan akses saat diminta.
   Di **Execution log** muncul link spreadsheet *"Neraca — Database"* — buka dan cek tab-tabnya.
5. **Deploy → New deployment** → tipe **Web app**:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
   Klik **Deploy**, salin **Web app URL** (berakhiran `/exec`).

Setiap kali kode Apps Script diubah: **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. URL tetap sama.

> Alternatif untuk developer: `npm i -g @google/clasp`, `clasp login`, salin `.clasp.json.example` jadi `.clasp.json` dan isi `scriptId`, lalu `clasp push` dari folder `apps-script`.

## B. Jalankan frontend

**Lokal:**

```bash
cd web
npm install
npm run dev
```

Buka alamat yang muncul, tempel URL `/exec`, klik **Jalankan uji**.

**Di GitHub Pages:**

1. Buat repo baru di GitHub, push isi folder ini ke branch `main`.
2. **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables → New variable**: `VITE_API_URL` = URL `/exec` tadi.
4. Push apa saja ke `main` (atau jalankan workflow manual di tab **Actions**). Aplikasi tayang di `https://<username>.github.io/<nama-repo>/`.

## C. Kriteria lulus Langkah 0

Di halaman uji, kelima baris harus hijau:

| Uji | Artinya |
|---|---|
| Server menjawab | Web App ter-deploy dan bisa diakses |
| Spreadsheet terhubung | `setupTemplate()` sukses, 34 tab ada |
| Menulis baris | LockService + appendRow jalan |
| Membaca kembali | Data yang ditulis benar-benar tersimpan |
| Kecepatan | Rata-rata ping < 3 detik |

Catat angka kecepatan rata-ratanya — itu acuan kita untuk desain cache di Langkah 1.

## D. Kalau ada yang merah

- **NETWORK** — URL salah, atau akses Web App bukan *Anyone*.
- **BAD_RESPONSE** — biasanya membuka URL `/dev` bukan `/exec`, atau lupa deploy *New version* setelah mengubah kode.
- **NOT_SETUP** — `setupTemplate()` belum dijalankan.
- **Tab kurang dari 30** — spreadsheet lama tertaut; jalankan `resetSetup()` lalu `setupTemplate()`.

## E. Catatan keamanan

Di Langkah 0, Web App terbuka untuk siapa saja yang tahu URL-nya, tapi hanya aksi `system.*` dan `test.*` (tab `T_Ping`) yang tersedia. **Jangan isi data keuangan asli dulu.** Login, token sesi, hash password, dan hak akses per peran dibangun di Langkah 1 — setelah itu semua aksi selain ping wajib membawa token.

## Berikutnya: Langkah 1

Login & sesi, router dengan pengecekan izin per peran, audit log, penomoran dokumen, pembacaan `SYS_Modul`, serta layout aplikasi (sidebar, route guard) di React.
