import { chmod, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

const PYTHON_SLEEPER = `#!/usr/bin/env python3
import os, pathlib, sys, time
if pathlib.Path(sys.argv[0]).name == "Xvfb":
    state = pathlib.Path(sys.argv[0]).resolve().parent.parent / "state"
    state.mkdir(exist_ok=True)
    (state / ("display-" + sys.argv[1].lstrip(":"))).write_text(str(os.getpid()))
while True:
    time.sleep(60)
`;

const XDPYINFO = `#!/bin/sh
display=""
while [ $# -gt 0 ]; do
  case "$1" in -display) display="\${2#:}"; shift ;; esac
  shift
done
marker="$(dirname "$0")/../state/display-$display"
[ -f "$marker" ] && kill -0 "$(cat "$marker")" 2>/dev/null
`;

const BROWSER = `#!/usr/bin/env python3
import http.server, sys
port = int(next(arg.split("=", 1)[1] for arg in sys.argv if arg.startswith("--remote-debugging-port=")))
class Debugger(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'{"Browser": "stub", "webSocketDebuggerUrl": "ws://127.0.0.1:%d/devtools/browser/stub"}' % port
        self.send_response(200)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args):
        pass
http.server.HTTPServer(("127.0.0.1", port), Debugger).serve_forever()
`;

const VNC = `#!/bin/bash
exec -a "$0" python3 -c 'import socket,sys,time;a=sys.argv;s=socket.socket(socket.AF_UNIX);s.bind(a[a.index("-unixsock")+1]);s.listen();[time.sleep(60) for _ in iter(int,1)]' "$@"
`;

const GATEWAY = `#!/usr/bin/env python3
import http.server, sys
host, port = sys.argv[-1].rsplit(":", 1)
class Page(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
    def log_message(self, *args):
        pass
http.server.HTTPServer((host, int(port)), Page).serve_forever()
`;

export async function stubDesktopTools(toolsDir: string) {
  const bin = path.join(toolsDir, "bin");
  await mkdir(bin, { recursive: true });
  await mkdir(path.join(toolsDir, "share", "novnc"), { recursive: true });
  await writeFile(path.join(toolsDir, "share", "novnc", "embed.html"), "<!doctype html>");
  const tools: Record<string, string> = {
    Xvfb: PYTHON_SLEEPER,
    fluxbox: PYTHON_SLEEPER,
    xdpyinfo: XDPYINFO,
    chromium: BROWSER,
    x11vnc: VNC,
    websockify: GATEWAY,
  };
  for (const [name, body] of Object.entries(tools)) {
    await writeFile(path.join(bin, name), body);
    await chmod(path.join(bin, name), 0o755);
  }
}

export async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === "string") throw new Error("no free port");
  return address.port;
}
