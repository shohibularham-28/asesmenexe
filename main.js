const { app, BrowserWindow, WebContentsView, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const config = require('./config.json');

const fs = require('fs');
const TOOLBAR_H = 46;
function log(...a) {
  try {
    const f = path.join(app.getPath('userData'), 'ujian-log.txt');
    fs.appendFileSync(f, `[${new Date().toISOString()}] ${a.join(' ')}\n`);
  } catch {}
}
process.on('uncaughtException', (err) => log('uncaughtException', err && err.stack));

let mainWin = null, toolbarView = null, webView = null, web = null;
let exitWin = null;
let allowQuit = false;
let suppressBlur = false;
let violations = 0;

if (!app.requestSingleInstanceLock()) app.quit();


// Matikan peringatan "tinggalkan halaman?" milik halaman (Google Form) di dalam halaman itu sendiri,
// supaya Back / Forward / Reload tidak tertahan.
const NEUTRALIZE_JS = `(() => { try {
  window.onbeforeunload = null;
  Object.defineProperty(window, 'onbeforeunload', { configurable: true, get() { return null; }, set() {} });
  if (!window.__ujianBU) { window.__ujianBU = 1;
    window.addEventListener('beforeunload', (e) => { e.stopImmediatePropagation(); }, true); }
} catch (e) {} })();`;
function neutralize() {
  if (!web || web.isDestroyed()) return Promise.resolve();
  return web.executeJavaScript(NEUTRALIZE_JS).catch(() => {});
}

function isAllowed(urlString) {
  try {
    const u = new URL(urlString);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname;
    if (h === 'docs.google.com') return u.pathname.startsWith(config.docsGooglePathPrefix);
    if (h === 'www.google.com') return /^\/(accounts|recaptcha)/.test(u.pathname);
    if (/^accounts\.google\.[a-z.]+$/.test(h)) return true; // accounts.google.com / .co.id / dll
    return config.allowedHosts.includes(h);
  } catch { return false; }
}


// Kompatibel dengan berbagai versi Electron (navigationHistory.* baru ada di versi 32+)
function hist() { return web.navigationHistory; }
function canBack() { const h = hist(); return h && typeof h.canGoBack === 'function' ? h.canGoBack() : web.canGoBack(); }
function canFwd()  { const h = hist(); return h && typeof h.canGoForward === 'function' ? h.canGoForward() : web.canGoForward(); }
function doBack()  { const h = hist(); return h && typeof h.goBack === 'function' ? h.goBack() : web.goBack(); }
function doFwd()   { const h = hist(); return h && typeof h.goForward === 'function' ? h.goForward() : web.goForward(); }

function isOnPortal(url) { return /^https:\/\/wima15\.github\.io\//.test(url || ''); }

// Google menolak login dari "Electron": tampilkan sebagai Chrome biasa
function cleanUA(ua) {
  return ua
    .replace(/\sElectron\/\S+/g, '')
    .replace(/\s[^\s\/]+\/\d+\.\d+\.\d+(?=\sChrome\/)/, '');
}
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

function toast(msg) {
  if (!web || web.isDestroyed()) return;
  const js = `(() => {
    let t = document.getElementById('__ujian_toast');
    if (!t) { t = document.createElement('div'); t.id='__ujian_toast';
      t.style.cssText='position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#b91c1c;color:#fff;padding:10px 18px;border-radius:10px;font:600 14px Segoe UI,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35)';
      document.body.appendChild(t); }
    t.textContent=${JSON.stringify(msg)}; t.style.display='block';
    clearTimeout(window.__ujian_tt); window.__ujian_tt=setTimeout(()=>t.style.display='none',3500);
  })();`;
  web.executeJavaScript(js).catch(() => {});
}

function sendNavState() {
  if (!web || web.isDestroyed() || !toolbarView || toolbarView.webContents.isDestroyed()) return;
  toolbarView.webContents.send('nav-state', {
    canGoBack: canBack() || !isOnPortal(web.getURL()),
    canGoForward: canFwd(),
    loading: web.isLoading(),
    title: web.getTitle()
  });
}

function layout() {
  if (!mainWin || mainWin.isDestroyed()) return;
  const [w, h] = mainWin.getContentSize();
  toolbarView.setBounds({ x: 0, y: 0, width: w, height: TOOLBAR_H });
  webView.setBounds({ x: 0, y: TOOLBAR_H, width: w, height: Math.max(0, h - TOOLBAR_H) });
}

function handleKeys(event, input) {
  if (input.type !== 'keyDown') return;
  const k = (input.key || '').toLowerCase();
  const ctrl = input.control || input.meta;

  if (ctrl && input.shift && k === 'q') { event.preventDefault(); openExitDialog(); return; }

  const blocked =
    k === 'f11' || k === 'f12' ||
    (ctrl && ['w', 'n', 't', 'p', 's', 'o', 'u', 'l'].includes(k)) ||
    (ctrl && input.shift && ['i', 'j', 'c', 'n', 't'].includes(k)) ||
    (input.alt && (k === 'f4' || k === 'tab'));
  if (blocked) event.preventDefault();
}

function createMain() {
  Menu.setApplicationMenu(null);
  mainWin = new BrowserWindow({
    fullscreen: true, kiosk: true, alwaysOnTop: true, frame: false,
    autoHideMenuBar: true, backgroundColor: '#312e81',
    webPreferences: { devTools: false }
  });
  mainWin.setAlwaysOnTop(true, 'screen-saver');

  // --- Toolbar (atas)
  toolbarView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'toolbar-preload.js'),
      contextIsolation: true, sandbox: true, devTools: false
    }
  });
  toolbarView.setBackgroundColor('#312e81');
  toolbarView.webContents.loadFile(path.join(__dirname, 'toolbar.html'));
  toolbarView.webContents.on('did-fail-load', (e, code, desc, url) => log('toolbar fail', code, desc, url));

  // --- Konten ujian (bawah)
  webView = new WebContentsView({
    webPreferences: {
      partition: 'persist:ujian', // login Google tetap tersimpan
      devTools: false, contextIsolation: true, sandbox: true, spellcheck: false
    }
  });
  webView.setBackgroundColor('#312e81');
  web = webView.webContents;

  mainWin.contentView.addChildView(webView);
  mainWin.contentView.addChildView(toolbarView);
  layout();
  [100, 400, 1000, 2500].forEach((t) => setTimeout(layout, t));
  mainWin.on('resize', layout);
  mainWin.on('enter-full-screen', layout);
  mainWin.on('show', layout);

  const ua = cleanUA(web.getUserAgent());
  web.setUserAgent(ua);
  webView.webContents.session.setUserAgent(ua);
  log('UA', ua);
  web.loadURL(config.startUrl).catch(() => {});

  // PENTING: abaikan peringatan "tinggalkan halaman?" milik Google Form,
  // kalau tidak, perpindahan halaman diam-diam dibatalkan.
  web.on('will-prevent-unload', (e) => e.preventDefault());

  web.on('will-navigate', (e, url) => {
    if (!isAllowed(url)) { e.preventDefault(); toast('Halaman ini tidak diizinkan saat ujian.'); }
  });
  web.on('will-redirect', (e, url) => {
    if (!isAllowed(url)) { e.preventDefault(); toast('Pengalihan ke halaman luar diblokir.'); }
  });
  web.setWindowOpenHandler(({ url }) => {
    if (isAllowed(url)) web.loadURL(url).catch(() => {});
    else toast('Halaman ini tidak diizinkan saat ujian.');
    return { action: 'deny' };
  });
  web.on('context-menu', (e) => e.preventDefault());
  ['dom-ready', 'did-finish-load', 'did-navigate-in-page', 'did-frame-finish-load']
    .forEach((ev) => web.on(ev, neutralize));

  ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']
    .forEach((ev) => web.on(ev, sendNavState));
  toolbarView.webContents.on('did-finish-load', () => { layout(); sendNavState(); });

  web.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;
    log('web fail', code, desc, url);
    const safe = String(desc).replace(/[<>&]/g, '');
    web.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      `<body style="font-family:Segoe UI;background:#312e81;color:#fff;display:grid;place-items:center;height:100vh;margin:0;text-align:center">
       <div><h2>Tidak dapat memuat halaman</h2><p>Periksa koneksi internet, lalu klik tombol di bawah.</p>
       <p style="opacity:.6;font-size:13px">Kode: ${code} (${safe})</p>
       <button onclick="location.href='${config.startUrl}'" style="padding:10px 20px;border:0;border-radius:8px;font-size:15px;cursor:pointer">Coba lagi</button></div></body>`))
  });

  web.on('before-input-event', handleKeys);
  toolbarView.webContents.on('before-input-event', handleKeys);

  mainWin.on('blur', () => {
    if (allowQuit || exitWin || suppressBlur) return;
    violations++;
    setTimeout(() => {
      if (mainWin && !mainWin.isDestroyed()) { mainWin.show(); mainWin.focus(); mainWin.moveTop(); }
      toast(`Peringatan #${violations}: jangan berpindah ke aplikasi lain selama ujian.`);
    }, 150);
  });
  mainWin.on('close', (e) => { if (!allowQuit) e.preventDefault(); });
  mainWin.on('minimize', () => mainWin.restore());
  mainWin.on('leave-full-screen', () => { if (!allowQuit) mainWin.setFullScreen(true); });
}

async function goHome() {
  suppressBlur = true;
  const { response } = await dialog.showMessageBox(mainWin, {
    type: 'question',
    buttons: ['Ya, ke Portal', 'Batal'],
    defaultId: 1, cancelId: 1,
    title: 'Kembali ke Portal',
    message: 'Kembali ke Portal Ujian?',
    detail: 'Jawaban yang belum dikirim di Google Form bisa hilang.'
  });
  suppressBlur = false;
  if (response === 0) web.loadURL(config.startUrl).catch(() => {});
}

ipcMain.on('nav', async (e, action) => {
  if (!web || web.isDestroyed()) return;
  log('nav', action, '| url:', web.getURL(), '| canBack:', canBack(), '| canForward:', canFwd());
  if (action === 'home') { goHome(); return; }
  if (action === 'exit') { openExitDialog(); return; }

  await neutralize();
  try {
    if (action === 'back') {
      if (canBack()) doBack();
      else if (!isOnPortal(web.getURL())) web.loadURL(config.startUrl).catch(() => {});
    } else if (action === 'forward') {
      if (canFwd()) doFwd();
    } else if (action === 'reload') {
      web.reload();
    }
  } catch (err) { log('nav error', action, err && err.message); }
});

function openExitDialog() {
  if (exitWin) { exitWin.focus(); return; }
  exitWin = new BrowserWindow({
    width: 380, height: 240, parent: mainWin, modal: true,
    frame: false, resizable: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, devTools: false }
  });
  exitWin.setAlwaysOnTop(true, 'screen-saver');
  exitWin.loadFile(path.join(__dirname, 'exit.html'));
  exitWin.on('closed', () => { exitWin = null; if (mainWin && !mainWin.isDestroyed()) mainWin.focus(); });
}

ipcMain.handle('verify-exit', (e, pw) => {
  if (pw === config.exitPassword) {
    allowQuit = true;
    app.exit(0); // paksa keluar, tidak bisa dihalangi halaman web
    return true;
  }
  return false;
});
ipcMain.on('cancel-exit', () => { if (exitWin) exitWin.close(); });

app.on('second-instance', () => { if (mainWin) { mainWin.show(); mainWin.focus(); } });
app.whenReady().then(createMain);
app.on('window-all-closed', () => { if (allowQuit) app.quit(); });
