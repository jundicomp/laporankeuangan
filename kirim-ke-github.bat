@echo off
REM Kirim semua perubahan di folder ini ke GitHub. Klik dua kali setiap kali ada update kode.
cd /d "%~dp0"
set /p MSG="Catatan update (Enter = Update kode): "
if "%MSG%"=="" set MSG=Update kode
git add -A
git commit -m "%MSG%"
git pull --rebase origin main
git push origin main
echo.
echo Selesai. Cek progres build di https://github.com/jundicomp/laporankeuangan/actions
pause
