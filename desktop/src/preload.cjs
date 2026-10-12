// Yalnız ilk-kurulum penceresi kullanır: sunucu adresini ana sürece taşır.
// Ana pencere bunu hiç kullanmaz — yüklenen web uygulaması için köprü yok
// (yüklenen kod postacim'in kendi kodu olsa da yüzey küçük kalsın).
// .cjs: package "type":"module" altında CommonJS kalmalı (preload ESM'siz).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('postacim', {
  saveServer: (url) => ipcRenderer.invoke('postacim:save-server', url),
});
