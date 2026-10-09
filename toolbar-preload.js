const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nav', {
  back: () => ipcRenderer.send('nav', 'back'),
  forward: () => ipcRenderer.send('nav', 'forward'),
  reload: () => ipcRenderer.send('nav', 'reload'),
  home: () => ipcRenderer.send('nav', 'home'),
  exit: () => ipcRenderer.send('nav', 'exit'),
  onState: (cb) => ipcRenderer.on('nav-state', (e, s) => cb(s))
});
