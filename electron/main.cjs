// earwise — Electron main process (Windows desktop app).
//
// Runs the demand scanner (bundled to build/scanner.mjs) in-process via Node,
// then wraps it in a native window with real Windows powers a web app can't
// have: a system-tray icon, native notifications, and (below) the hooks for
// global shortcuts.

const { app, BrowserWindow, shell, Tray, Menu, Notification, nativeImage } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const path = require('path')

const HOST = '127.0.0.1'
const PORT = Number(process.env.EARWISE_PORT || 4321)
const APP_URL = `http://${HOST}:${PORT}`
const ROOT = path.join(__dirname, '..')
const ICON = path.join(ROOT, 'build', 'icon.png')

let server = null
let win = null
let tray = null

function waitForServer(url, timeoutMs) {
  const started = Date.now()
  return new Promise((resolve) => {
    const check = () => {
      http
        .get(url, (res) => {
          res.resume()
          resolve(true)
        })
        .on('error', () => {
          if (Date.now() - started > timeoutMs) return resolve(false)
          setTimeout(check, 700)
        })
    }
    check()
  })
}

// Where the scanner writes its data. Packaged → the per-user app dir (writable);
// dev → unset, so the scanner uses the repo's scan-output/ + .env.local.
function dataHome() {
  if (!app.isPackaged) return ''
  const dir = app.getPath('userData')
  // First run: seed the Anthropic key from a repo the user pointed us at, so the
  // packaged app works without them hunting for the right file.
  const repo = process.env.EARWISE_PROJECT
  if (repo && fs.existsSync(path.join(repo, '.env.local'))) {
    const dst = path.join(dir, '.env.local')
    if (!fs.existsSync(dst)) {
      try {
        fs.copyFileSync(path.join(repo, '.env.local'), dst)
      } catch {
        /* leave it — the user can add the key manually */
      }
    }
  }
  return dir
}

function startServer() {
  const scanner = path.join(ROOT, 'build', 'scanner.mjs')
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(PORT) }
  const home = dataHome()
  if (home) env.EARWISE_HOME = home
  server = spawn(process.execPath, [scanner], { cwd: ROOT, env, stdio: 'ignore' })
  server.on('error', () => {
    server = null
  })
}

function notify(title, body) {
  if (!Notification.isSupported()) return
  new Notification({ title, body, icon: ICON }).show()
}

function createTray() {
  if (tray) return
  const img = nativeImage.createFromPath(ICON)
  tray = new Tray(img.resize({ width: 16, height: 16 }))
  tray.setToolTip('earwise — demand scanner')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open earwise', click: () => (win ? (win.show(), win.focus()) : main()) },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  )
  tray.on('click', () => {
    if (win) {
      win.show()
      win.focus()
    }
  })
}

async function openWindow() {
  win = new BrowserWindow({
    width: 1304,
    height: 620,
    minWidth: 960,
    minHeight: 560,
    title: 'earwise',
    backgroundColor: '#00000000',
    backgroundMaterial: 'mica',
    autoHideMenuBar: true,
    show: false,
    icon: ICON,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  win.once('ready-to-show', () => win.show())
  await win.loadURL(APP_URL)
  notify('earwise is listening', 'Your scanner is up — fresh demand will land here as it comes in.')
}

async function main() {
  let up = await waitForServer(APP_URL, 4000)
  if (!up) {
    startServer()
    up = await waitForServer(APP_URL, 120000)
  }
  if (!up) {
    win = new BrowserWindow({ width: 560, height: 300, title: 'earwise', autoHideMenuBar: true })
    await win.loadURL(
      `data:text/html,<body style="background:%23faf9f5;color:%23201f1c;font-family:system-ui;display:flex;align-items:center;justify-content:center;text-align:center;height:100vh;margin:0"><div><h2 style="color:%23d97757">earwise couldn't start</h2><p style="color:%236b6a66">The scanner server didn't respond.<br>Run <code>npm run dashboard</code> in a terminal and try again.</p></div></body>`,
    )
    return
  }
  await openWindow()
  createTray()
}

app.setName('earwise')
app.setAppUserModelId('com.earwise.app')

app.whenReady().then(main)

app.on('window-all-closed', () => {
  if (server) server.kill()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && win === null) main()
})
