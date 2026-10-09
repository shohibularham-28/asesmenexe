# Aplikasi Ujian (Windows)

Browser ujian terkunci. Membuka **Portal Ujian** (https://wima15.github.io/ases/#siswa)
lalu siswa memilih ujian yang tetap berupa **Google Form**.

## Fitur
- Layar penuh (kiosk), selalu di atas aplikasi lain
- Hanya domain portal & Google Form yang boleh dibuka (domain lain diblokir)
- Link `target=_blank` dibuka di jendela yang sama
- Alt+Tab / pindah aplikasi terdeteksi: jendela dikembalikan + peringatan muncul
- DevTools, klik kanan, Ctrl+W/N/T/P/S, F11/F12, Alt+F4 diblokir
- Toolbar: Back, Forward, Reload, Portal, dan Keluar
- Login Google tersimpan selama sesi (tidak perlu login ulang tiap soal)
- Keluar hanya lewat **Ctrl+Shift+Q** + kata sandi pengawas

## Cara membuat file .exe

### Opsi A: di komputer Windows
1. Pasang Node.js LTS (https://nodejs.org)
2. Buka terminal di folder ini:
   ```
   npm install
   npm run build
   ```
3. Hasil ada di folder `dist/`: installer (`-nsis.exe`) dan versi portable (`-portable.exe`).

Untuk mencoba tanpa build: `npm start`

### Opsi B: lewat GitHub (tanpa pasang apa pun)
1. Upload folder ini ke repo GitHub
2. Tab **Actions** → **Build Windows App** → **Run workflow**
3. Unduh `.exe` dari bagian **Artifacts**

## Pengaturan (config.json)
- `startUrl`: alamat portal
- `exitPassword`: **ganti** kata sandi keluar sebelum dibagikan ke siswa
- `allowedHosts`: daftar domain yang boleh diakses

## Catatan
- Alt+Tab dan tombol Windows tidak bisa diblokir total oleh aplikasi biasa; aplikasi hanya mendeteksi dan menegur.
  Untuk pengamanan lebih ketat, gunakan juga mode Kiosk/Assigned Access Windows.
- Jika Google Form meminta file upload atau domain lain, tambahkan domainnya di `allowedHosts`.

## Login Google
Aplikasi menyamar sebagai Chrome biasa (tanpa tanda "Electron") supaya login Google tidak ditolak.
Sesi login tersimpan (partition `persist:ujian`). Jika Google tetap menolak ("browser tidak aman"),
cara paling andal adalah membuat Google Form **tidak mewajibkan login** (Setelan form → Respons → matikan "Batasi ke pengguna di ...").
