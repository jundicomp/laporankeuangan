@echo off
REM Hubungkan folder ini ke https://github.com/jundicomp/laporankeuangan lalu push pertama.
REM Jalankan sekali dengan klik dua kali, atau dari terminal di folder ini.
cd /d "%~dp0"
if exist "_github\deploy.yml" (
  if not exist ".github\workflows" mkdir ".github\workflows"
  move /y "_github\deploy.yml" ".github\workflows\deploy.yml" >nul
  rmdir "_github" 2>nul
)
where git >nul 2>nul || (echo Git belum terinstal. Unduh di https://git-scm.com/download/win & pause & exit /b 1)
if not exist ".git" git init -b main
git add -A
git commit -m "Langkah 0: scaffold React + Apps Script + GitHub Pages"
git remote remove origin 2>nul
git remote add origin https://github.com/jundicomp/laporankeuangan.git
git push -u origin main
echo.
echo Selesai. Cek https://github.com/jundicomp/laporankeuangan
pause
