// postacim masaüstü — Electron sarmalayıcı.
//
// Model: ince istemci. Web uygulaması sunucudan yüklenir (aynı E2EE kodu,
// aynı oturum); bu kabuğun işi tarayıcının yapamadıkları:
//  - sunucu adresi yapılandırması (ilk açılışta sor, userData'ya kaydet)
//  - http (LAN) dağıtımlarında secure-context muafiyeti → mikrofon/kamera/
//    bildirim/pencere-içi-pencere tarayıcı kısıtı olmadan çalışır
//  - ekran paylaşımı: getDisplayMedia için yerel kaynak seçimi
//  - tepsi: kapatınca tepsiye gizlenir; okunmamış sayacı rozet + ipucu
//  - her sunucu kendi kalıcı partition'ında → oturum/E2EE anahtarları karışmaz
//
// Discord ile aynı tercih: Electron + sabit Chromium. Tauri/WebKitGTK
// yolunda WebRTC (LiveKit) güvenilir değil.
import { app, BrowserWindow, Menu, Tray, desktopCapturer, ipcMain, nativeImage, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const SMOKE = process.argv.includes('--smoke');

// smoke test gerçek kullanıcı yapılandırmasını kirletmesin — config okumadan ÖNCE
if (SMOKE) {
  app.setPath('userData', path.join(app.getPath('temp'), 'postacim-smoke'));
}

// ---------- yapılandırma ----------

function configFile() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(patch) {
  const file = configFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const merged = { ...loadConfig(), ...patch };
  fs.writeFileSync(file, JSON.stringify(merged, null, 2));
}

/** "sunucu" → "https://sunucu"; şema yoksa https varsay. Geçersizse ''. */
function normalizeServer(raw) {
  let s = (raw ?? '').trim().replace(/\/+$/, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!u.hostname) return '';
    return u.origin;
  } catch {
    return '';
  }
}

function originOf(serverUrl) {
  return new URL(serverUrl).origin;
}

// env > CLI > kayıtlı. Secure-context muafiyeti switch'i app ready'den
// ÖNCE yazılmalı → adresi senkron çözüyoruz.
const argUrl = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? '';
const initialConfig = loadConfig();
const fromEnv = normalizeServer(process.env.POSTACIM_URL ?? '');
const fromArg = normalizeServer(argUrl);
const serverUrl = fromEnv || fromArg || normalizeServer(initialConfig.serverUrl ?? '');
// env/CLI ile verilen adres kalıcı varsayılan olur (bir sonraki açılış da o)
if ((fromEnv || fromArg) && serverUrl !== initialConfig.serverUrl) saveConfig({ serverUrl });

// LAN http dağıtımı: Chromium bu kaynağı güvenli sayar → getUserMedia,
// Notification, Document PiP açılır. Muafiyet yalnız kendi sunucu kaynağına.
if (serverUrl.startsWith('http://')) {
  app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', originOf(serverUrl));
}

// ---------- tek örnek ----------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  void bootstrap();
}

let win = null;
let tray = null;
let quitting = false;

async function bootstrap() {
  app.on('second-instance', () => {
    if (win) {
      win.show();
      win.focus();
    }
  });

  // Discord görünümü: menü çubuğu yok (F12/Ctrl+R kısayolları aşağıda elle bağlı)
  Menu.setApplicationMenu(null);

  await app.whenReady();

  ipcMain.handle('postacim:save-server', (_e, raw) => {
    const u = normalizeServer(raw);
    if (!u) return { ok: false };
    saveConfig({ serverUrl: u });
    // secure-context switch'i ancak yeni süreçte etkili olur → relaunch
    setTimeout(() => {
      app.relaunch();
      app.quit();
    }, 300);
    return { ok: true };
  });

  if (!serverUrl) createSetupWindow();
  else createMainWindow();

  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('window-all-closed', () => {
    // tepsiye gizlenme close handler'da; pencereler kapandıysa (tepsi yoksa) çık
    if (!tray || quitting) app.quit();
  });
}

// ---------- ilk kurulum penceresi ----------

const SETUP_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  :root{color-scheme:dark}
  body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0b0e13;color:#e8e4d8;font-family:system-ui,sans-serif}
  .box{width:340px;padding:32px;border:1px solid #c9a45c66;border-radius:10px;background:#10151c}
  h1{font-size:15px;letter-spacing:.2em;text-transform:uppercase;color:#e8a33d;margin:0 0 6px}
  p{font-size:13px;color:#9aa3ad;margin:0 0 18px;line-height:1.5}
  input{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #2b3644;
    border-radius:6px;background:#0b0e13;color:#e8e4d8;font-size:14px;outline:none}
  input:focus{border-color:#e8a33d}
  button{margin-top:12px;width:100%;padding:10px;border:0;border-radius:6px;
    background:#e8a33d;color:#0b0e13;font-size:14px;font-weight:600;cursor:pointer}
  .err{color:#e35d5d;font-size:12px;margin-top:8px;min-height:14px}
</style></head><body><div class="box">
  <h1>postacim</h1>
  <p>Sunucunun adresi ne? (ör. <b>https://posta.example</b> veya LAN'da <b>http://192.168.1.10</b>)</p>
  <input id="u" type="text" placeholder="https://sunucu-adresin" autofocus>
  <div class="err" id="e"></div>
  <button id="b">Bağlan</button>
</div><script>
  const go = async () => {
    const r = await window.postacim.saveServer(document.getElementById('u').value);
    if (!r.ok) { document.getElementById('e').textContent = 'geçersiz adres'; return; }
    document.getElementById('b').textContent = 'yeniden başlatılıyor…';
    document.getElementById('b').disabled = true;
  };
  document.getElementById('b').onclick = go;
  document.getElementById('u').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(); });
</script></body></html>`;

function createSetupWindow() {
  const setup = new BrowserWindow({
    width: 460,
    height: 380,
    resizable: false,
    show: false,
    backgroundColor: '#0b0e13',
    autoHideMenuBar: true,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  setup.removeMenu();
  setup.once('ready-to-show', () => {
    setup.show();
    smokeDone();
  });
  void setup.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SETUP_HTML)}`);
}

// ---------- ana pencere ----------

function createMainWindow() {
  const bounds = initialConfig.bounds ?? { width: 1280, height: 800 };
  const origin = originOf(serverUrl);

  win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0e13', // ilk boyama öncesi beyaz flaş olmasın
    autoHideMenuBar: true,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // her sunucu kendi kalıcı partition'ında — oturum çerezi + E2EE
      // localStorage farklı sunucular arasında asla karışmaz
      partition: `persist:${origin.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.removeMenu();

  win.once('ready-to-show', () => {
    if (win) win.show();
    smokeDone();
  });
  // smoke modunda sunucuya ulaşılamasa bile (did-fail-load) ilerle
  win.webContents.on('did-fail-load', () => smokeDone());
  void win.loadURL(serverUrl);

  wireSession(win.webContents.session, origin);
  wireWindowEvents();
  createTray();
}

/** izinler + ekran paylaşımı + dış bağlantı — yalnız kendi sunucu kaynağına */
function wireSession(ses, origin) {
  const ALLOWED = new Set(['media', 'fullscreen', 'notifications', 'pointerLock', 'clipboard-sanitized-write']);
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    try {
      callback(new URL(wc.getURL()).origin === origin && ALLOWED.has(permission));
    } catch {
      callback(false);
    }
  });
  ses.setPermissionCheckHandler((wc, permission, requestingUrl) => {
    try {
      return new URL(requestingUrl || wc.getURL()).origin === origin && ALLOWED.has(permission);
    } catch {
      return false;
    }
  });

  // ekran paylaşımı: yerel kaynak listesi. v1: ilk ekranı ver (pencere
  // seçici yok). Ekran sesi loopback yalnız Windows'ta.
  ses.setDisplayMediaRequestHandler(async (_req, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const screen = sources.find((s) => s.id.startsWith('screen:')) ?? sources[0];
      if (!screen) {
        callback(null);
        return;
      }
      callback({ video: screen, ...(process.platform === 'win32' ? { audio: 'loopback' } : {}) });
    } catch {
      callback(null);
    }
  });

  // dış bağlantılar sistem tarayıcısında; uygulama penceresi kendi sunucusunda kalır
  const wc = win?.webContents;
  if (wc) {
    wc.setWindowOpenHandler(({ url: target }) => {
      try {
        if (new URL(target).origin !== origin) void shell.openExternal(target);
      } catch {
        /* hatalı hedef — yoksay */
      }
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e, target) => {
      try {
        if (new URL(target).origin !== origin) {
          e.preventDefault();
          void shell.openExternal(target);
        }
      } catch {
        e.preventDefault();
      }
    });
  }
}

function wireWindowEvents() {
  if (!win) return;

  // okunmamış sayacı: web "(N) postacim" başlığı yazar → rozet + tepsi ipucu
  win.on('page-title-updated', (_e, title) => {
    const m = /^\((\d+)\)/.exec(title);
    const n = m ? Number(m[1]) : 0;
    try {
      app.setBadgeCount(n);
    } catch {
      // Unity/dock dışı ortamlar — önemsiz
    }
    if (tray) tray.setToolTip(n > 0 ? `postacim — ${n} okunmadı` : 'postacim');
  });

  // kapat → tepsiye gizle (Discord). Tepsi yoksa (WM desteklemiyorsa) normal kapat.
  win.on('close', (e) => {
    if (!win) return;
    saveConfig({ bounds: win.getBounds() });
    if (!quitting && tray) {
      e.preventDefault();
      win.hide();
    }
  });

  // menü yok → kısayollar elle
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') win?.webContents.toggleDevTools();
    else if (input.key === 'r' && (input.control || input.meta)) win?.webContents.reload();
  });
}

function createTray() {
  try {
    const icon = nativeImage.createFromPath(ICON).resize({ width: 22, height: 22 });
    tray = new Tray(icon);
    tray.setToolTip('postacim');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Göster', click: () => { if (win) { win.show(); win.focus(); } } },
        { type: 'separator' },
        {
          label: 'Çıkış',
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
    // sol tık: göster/gizle (KDE/GNOME alışkanlığı)
    tray.on('click', () => {
      if (win?.isVisible()) win.hide();
      else win?.show();
    });
  } catch {
    // tepsi desteklemeyen ortam — pencere davranışı normal kalır
    tray = null;
  }
}

// ---------- smoke test (--smoke): boots, pencere açılır, çık ----------

let smokeReported = false;
function smokeDone() {
  if (!SMOKE || smokeReported) return;
  smokeReported = true;
  console.log('[smoke] ok');
  setTimeout(() => app.quit(), 200);
}
if (SMOKE) {
  // güvence: herhangi bir takılmada 8 sn içinde kesin çık
  setTimeout(() => {
    if (!smokeReported) {
      console.log('[smoke] timeout');
      app.quit();
    }
  }, 8000);
}
