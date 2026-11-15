@echo off
setlocal EnableDelayedExpansion
REM ==========================================================================
REM  DEPLOY NERACA - sekali klik
REM  1. Unggah semua file apps-script\*.gs ke project "Neraca API" (clasp push)
REM  2. Buat versi baru deployment Web App (URL tetap sama)
REM  3. Panggil API sekali -> upgradeSchema berjalan otomatis
REM  4. (opsional) kirim kode web ke GitHub
REM ==========================================================================
cd /d "%~dp0"
title Deploy Neraca

where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js belum terpasang. Unduh versi LTS di https://nodejs.org lalu jalankan file ini lagi.
  goto gagal
)
where clasp >nul 2>nul
if errorlevel 1 (
  echo Memasang alat deploy Google ^(clasp^) - hanya sekali ...
  call npm install -g @google/clasp@3
  if errorlevel 1 goto gagal
)

if not exist "%USERPROFILE%\.clasprc.json" (
  echo.
  echo === PERSIAPAN SEKALI SAJA ===
  echo 1. Buka https://script.google.com/home/usersettings lalu NYALAKAN "Google Apps Script API".
  echo 2. Setelah itu browser akan terbuka untuk login. Pakai akun Google pemilik project Neraca API.
  pause
  call clasp login
  if errorlevel 1 goto gagal
)

if not exist "apps-script\.clasp.json" (
  echo.
  echo Buka project Neraca API di script.google.com - ikon gerigi "Setelan project" - salin "ID skrip".
  set /p SID="Tempel ID skrip lalu Enter: "
  if "!SID!"=="" goto gagal
  > "apps-script\.clasp.json" echo {"scriptId":"!SID!","rootDir":"."}
)

if not exist "apps-script\.deploy-url" (
  echo.
  echo Buka Neraca API - Terapkan - Kelola deployment - salin "URL aplikasi web" ^(berakhiran /exec^).
  set /p WURL="Tempel URL lalu Enter: "
  if "!WURL!"=="" goto gagal
  > "apps-script\.deploy-url" echo !WURL!
)
set /p WURL=<"apps-script\.deploy-url"
for /f "tokens=5 delims=/" %%a in ("%WURL%") do set DID=%%a
if not "%DID:~0,4%"=="AKfy" (
  echo [X] URL di apps-script\.deploy-url tidak dikenali: %WURL%
  echo     Hapus file itu lalu jalankan lagi, tempel URL yang berakhiran /exec.
  goto gagal
)

echo.
echo [1/3] Mengunggah semua file Apps Script ...
pushd apps-script
call clasp push -f
if errorlevel 1 ( popd & goto gagal )
echo.
echo [2/3] Membuat versi baru deployment ^(URL tetap^) ...
call clasp update-deployment %DID% -d "Deploy %date% %time%"
if errorlevel 1 call clasp deploy -i %DID% -d "Deploy %date% %time%"
if errorlevel 1 ( popd & goto gagal )
popd

echo.
echo [3/3] Menjalankan upgradeSchema otomatis ...
curl -s -L -H "Content-Type: text/plain" -d "{\"action\":\"system.ping\"}" "%WURL%"
echo.
echo     ^(cek: "kode" dan "database" harus sama, mis. "1.0.0"/"0.9.0"^)

echo.
set /p WEB="Kirim juga kode web ke GitHub sekarang? (Y/n): "
if /i "!WEB!"=="n" goto selesai
call "%~dp0kirim-ke-github.bat"
goto selesai

:gagal
echo.
echo [X] Deploy berhenti. Baca pesan di atas, perbaiki, lalu jalankan lagi.
pause
exit /b 1

:selesai
echo.
echo === SELESAI === Buka aplikasi lalu refresh.
pause
