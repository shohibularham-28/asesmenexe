const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('exitApi', {
  verify: (pw) => ipcRenderer.invoke('verify-exit', pw),
  cancel: () => ipcRenderer.send('cancel-exit')
});
