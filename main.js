const { app, BrowserWindow, WebContentsView, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const config = require('./config.json');

const TOOLBAR_H = 46;
let mainWin = null, toolbarView = null, webView = null, web = null;
let exitWin = null;
let allowQuit = false;
let suppressBlur = false;
let violations = 0;

if (!app.requestSingleInstanceLock()) app.quit();

function isAllowed(urlString) {
  try {
    const u = new URL(urlString);
    if (u.protocol !== 'https:') return false;
    if (!config.allowedHosts.includes(u.hostname)) return false;
    if (u.hostname === 'docs.google.com' && !u.pathname.startsWith(config.docsGooglePathPrefix)) return false;
    return true;
  } catch { return false; }
}

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
    canGoBack: web.navigationHistory.canGoBack(),
    canGoForward: web.navigationHistory.canGoForward(),
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
  toolbarView.webContents.loadFile('toolbar.html');

  // --- Konten ujian (bawah)
  webView = new WebContentsView({
    webPreferences: {
      partition: 'persist:ujian', // login Google tetap tersimpan
      devTools: false, contextIsolation: true, sandbox: true, spellcheck: false
    }
  });
  web = webView.webContents;

  mainWin.contentView.addChildView(webView);
  mainWin.contentView.addChildView(toolbarView);
  layout();
  mainWin.on('resize', layout);
  mainWin.on('enter-full-screen', layout);
  mainWin.on('show', layout);

  web.loadURL(config.startUrl);

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
    if (isAllowed(url)) web.loadURL(url);
    else toast('Halaman ini tidak diizinkan saat ujian.');
    return { action: 'deny' };
  });
  web.on('context-menu', (e) => e.preventDefault());

  ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']
    .forEach((ev) => web.on(ev, sendNavState));
  toolbarView.webContents.on('did-finish-load', sendNavState);

  web.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;
    web.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      `<body style="font-family:Segoe UI;background:#312e81;color:#fff;display:grid;place-items:center;height:100vh;margin:0;text-align:center">
       <div><h2>Tidak dapat terhubung ke internet</h2><p>Periksa koneksi, lalu klik tombol di bawah.</p>
       <button onclick="location.href='${config.startUrl}'" style="padding:10px 20px;border:0;border-radius:8px;font-size:15px;cursor:pointer">Coba lagi</button></div></body>`));
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
  if (response === 0) web.loadURL(config.startUrl);
}

ipcMain.on('nav', (e, action) => {
  if (!web || web.isDestroyed()) return;
  if (action === 'back' && web.navigationHistory.canGoBack()) web.navigationHistory.goBack();
  else if (action === 'forward' && web.navigationHistory.canGoForward()) web.navigationHistory.goForward();
  else if (action === 'reload') web.reload();
  else if (action === 'home') goHome();
  else if (action === 'exit') openExitDialog();
});

function openExitDialog() {
  if (exitWin) { exitWin.focus(); return; }
  exitWin = new BrowserWindow({
    width: 380, height: 240, parent: mainWin, modal: true,
    frame: false, resizable: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, devTools: false }
  });
  exitWin.setAlwaysOnTop(true, 'screen-saver');
  exitWin.loadFile('exit.html');
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
