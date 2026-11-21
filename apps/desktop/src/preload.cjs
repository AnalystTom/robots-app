const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel) {
  return (listener) => {
    const handler = () => listener();
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.off(channel, handler);
  };
}

contextBridge.exposeInMainWorld("robotsDesktop", {
  platform: process.platform,
  nativeWindowFrame: process.platform === "win32",
  clipboard: {
    writeText: (text) => ipcRenderer.invoke("desktop.clipboard.write", text),
  },
  badge: {
    set: (count) => ipcRenderer.invoke("desktop.badge.set", count),
  },
  computer: {
    managesHostChoice: true,
    requestAccess: () => ipcRenderer.invoke("desktop.computer.requestAccess"),
    revokeAccess: () => ipcRenderer.invoke("desktop.computer.revokeAccess"),
    onConfigure: subscribe("desktop.computer.configure"),
  },
  server: {
    change: () => ipcRenderer.invoke("desktop.server.change"),
  },
  network: {
    state: () => ipcRenderer.invoke("desktop.network.state"),
    setMode: (mode) => ipcRenderer.invoke("desktop.network.setMode", mode),
  },
  settings: {
    onOpen: subscribe("desktop.settings.open"),
  },
  device: {
    state: () => ipcRenderer.invoke("desktop.device.state"),
    setAllowed: (allowed) => ipcRenderer.invoke("desktop.device.setAllowed", allowed),
  },
  locale: {
    set: (locale) => ipcRenderer.invoke("desktop.locale.set", locale),
  },
  menu: {
    onCommand: (listener) => {
      const handler = (_event, command) => listener(command);
      ipcRenderer.on("desktop.menu.command", handler);
      return () => ipcRenderer.off("desktop.menu.command", handler);
    },
  },
  monitoring: {
    enabled: () => ipcRenderer.invoke("desktop.monitoring.enabled"),
  },
  passkeys: {
    rpIds: () => ipcRenderer.invoke("desktop.passkeys.rpIds"),
  },
  ...(process.platform === "darwin"
    ? {
        speech: {
          start: (language, session) =>
            ipcRenderer.invoke("desktop.speech.start", language, session),
          stop: (session) => ipcRenderer.invoke("desktop.speech.stop", session),
          abort: (session) => ipcRenderer.invoke("desktop.speech.abort", session),
          onEvent: (listener) => {
            const handler = (_event, payload) => listener(payload);
            ipcRenderer.on("desktop.speech.event", handler);
            return () => ipcRenderer.off("desktop.speech.event", handler);
          },
        },
      }
    : {}),
  ...(process.platform === "darwin"
    ? {
        macApps: {
          permissions: () => ipcRenderer.invoke("desktop.macApps.permissions"),
          allow: (grant) => ipcRenderer.invoke("desktop.macApps.allow", grant),
        },
      }
    : {}),
  window: {
    close: () => ipcRenderer.invoke("desktop.window.close"),
    minimize: () => ipcRenderer.invoke("desktop.window.minimize"),
    toggleMaximize: () => ipcRenderer.invoke("desktop.window.toggleMaximize"),
    state: () => ipcRenderer.invoke("desktop.window.state"),
  },
  update: {
    state: () => ipcRenderer.invoke("desktop.update.state"),
    check: () => ipcRenderer.invoke("desktop.update.check"),
    download: () => ipcRenderer.invoke("desktop.update.download"),
    install: () => ipcRenderer.invoke("desktop.update.install"),
  },
  oauth: {
    open: (url) => ipcRenderer.invoke("desktop.oauth.open", url),
    cancel: (url) => ipcRenderer.invoke("desktop.oauth.cancel", url),
    onCallback: (listener) => {
      const handler = (_event, callback) => listener(callback);
      ipcRenderer.on("desktop.oauth.callback", handler);
      return () => ipcRenderer.off("desktop.oauth.callback", handler);
    },
  },
  mcpBrowser: {
    clear: (serverId) => ipcRenderer.invoke("desktop.mcpBrowser.clear", serverId),
    onOAuthCallback: (listener) => {
      const handler = (_event, callback) => listener(callback);
      ipcRenderer.on("desktop.mcpBrowser.callback", handler);
      return () => ipcRenderer.off("desktop.mcpBrowser.callback", handler);
    },
  },
});
