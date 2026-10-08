const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const config = require('./config.json');

let mainWin = null;
let exitWin = null;
let allowQuit = false;
let violations = 0;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function isAllowed(urlString) {
  try {
    const u = new URL(urlString);
    if (u.protocol !== 'https:') return false;
    if (!config.allowedHosts.includes(u.hostname)) return false;
    // docs.google.com hanya boleh untuk Google Form
    if (u.hostname === 'docs.google.com' && !u.pathname.startsWith(config.docsGooglePathPrefix)) return false;
    return true;
  } catch { return false; }
}

function toast(msg) {
  if (!mainWin || mainWin.isDestroyed()) return;
  const js = `(() => {
    let t = document.getElementById('__ujian_toast');
    if (!t) { t = document.createElement('div'); t.id='__ujian_toast';
      t.style.cssText='position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#b91c1c;color:#fff;padding:10px 18px;border-radius:10px;font:600 14px Segoe UI,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35)';
      document.body.appendChild(t); }
    t.textContent=${JSON.stringify(msg)}; t.style.display='block';
    clearTimeout(window.__ujian_tt); window.__ujian_tt=setTimeout(()=>t.style.display='none',3500);
  })();`;
  mainWin.webContents.executeJavaScript(js).catch(() => {});
}

function injectUi() {
  const js = `(() => {
    if (document.getElementById('__ujian_home')) return;
    const b = document.createElement('button');
    b.id='__ujian_home'; b.textContent='🏠 Portal';
    b.style.cssText='position:fixed;right:14px;bottom:14px;z-index:2147483646;background:#312e81;color:#fff;border:0;border-radius:999px;padding:8px 14px;font:600 13px Segoe UI,sans-serif;opacity:.85;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.3)';
    b.onclick=()=>{ if(confirm('Kembali ke Portal Ujian? Jawaban yang belum dikirim bisa hilang.')) location.href=${JSON.stringify(config.startUrl)}; };
    document.body.appendChild(b);
  })();`;
  mainWin.webContents.executeJavaScript(js).catch(() => {});
}

function createMain() {
  mainWin = new BrowserWindow({
    fullscreen: true,
    kiosk: true,
    alwaysOnTop: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#312e81',
    webPreferences: {
      partition: 'persist:ujian', // login Google tetap tersimpan
      devTools: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false
    }
  });
  mainWin.setAlwaysOnTop(true, 'screen-saver');
  Menu.setApplicationMenu(null);

  mainWin.loadURL(config.startUrl);

  // Navigasi hanya ke domain yang diizinkan
  mainWin.webContents.on('will-navigate', (e, url) => {
    if (!isAllowed(url)) { e.preventDefault(); toast('Halaman ini tidak diizinkan saat ujian.'); }
  });
  mainWin.webContents.on('will-redirect', (e, url) => {
    if (!isAllowed(url)) { e.preventDefault(); toast('Pengalihan ke halaman luar diblokir.'); }
  });
  // Link target=_blank → buka di jendela yang sama bila diizinkan
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowed(url)) mainWin.loadURL(url);
    else toast('Halaman ini tidak diizinkan saat ujian.');
    return { action: 'deny' };
  });

  mainWin.webContents.on('did-finish-load', injectUi);
  mainWin.webContents.on('did-navigate-in-page', injectUi);
  mainWin.webContents.on('context-menu', (e) => e.preventDefault());

  // Gagal memuat (misal tidak ada internet)
  mainWin.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;
    mainWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      `<body style="font-family:Segoe UI;background:#312e81;color:#fff;display:grid;place-items:center;height:100vh;margin:0;text-align:center">
       <div><h2>Tidak dapat terhubung ke internet</h2><p>Periksa koneksi, lalu klik tombol di bawah.</p>
       <button onclick="location.href='${config.startUrl}'" style="padding:10px 20px;border:0;border-radius:8px;font-size:15px;cursor:pointer">Coba lagi</button></div></body>`));
  });

  // Blokir pintasan keyboard berbahaya
  mainWin.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const k = (input.key || '').toLowerCase();
    const ctrl = input.control || input.meta;

    if (ctrl && input.shift && k === 'q') { event.preventDefault(); openExitDialog(); return; }

    const blocked =
      k === 'f11' || k === 'f12' ||
      (ctrl && ['w', 'n', 't', 'p', 's', 'o', 'u', 'l'].includes(k)) ||
      (ctrl && input.shift && ['i', 'j', 'c', 'n', 't'].includes(k)) ||
      (input.alt && (k === 'f4' || k === 'arrowleft' || k === 'arrowright')) ||
      (input.alt && k === 'tab');
    if (blocked) event.preventDefault();
  });

  // Deteksi keluar dari jendela ujian (Alt+Tab, klik aplikasi lain, dll)
  mainWin.on('blur', () => {
    if (allowQuit || exitWin) return;
    violations++;
    setTimeout(() => {
      if (mainWin && !mainWin.isDestroyed()) { mainWin.show(); mainWin.focus(); mainWin.moveTop(); }
      toast(`Peringatan #${violations}: jangan berpindah ke aplikasi lain selama ujian.`);
    }, 150);
  });

  mainWin.on('close', (e) => { if (!allowQuit) e.preventDefault(); });
  mainWin.on('minimize', (e) => { e.preventDefault(); mainWin.restore(); });
  mainWin.on('leave-full-screen', () => { if (!allowQuit) mainWin.setFullScreen(true); });
}

function openExitDialog() {
  if (exitWin) { exitWin.focus(); return; }
  exitWin = new BrowserWindow({
    width: 380, height: 240,
    parent: mainWin, modal: true,
    frame: false, resizable: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, devTools: false }
  });
  exitWin.setAlwaysOnTop(true, 'screen-saver');
  exitWin.loadFile('exit.html');
  exitWin.on('closed', () => { exitWin = null; });
}

ipcMain.handle('verify-exit', (e, pw) => {
  if (pw === config.exitPassword) { allowQuit = true; app.quit(); return true; }
  return false;
});
ipcMain.on('cancel-exit', () => { if (exitWin) exitWin.close(); });

app.on('second-instance', () => { if (mainWin) { mainWin.show(); mainWin.focus(); } });
app.whenReady().then(createMain);
app.on('window-all-closed', () => { if (allowQuit) app.quit(); });
