# Connect other devices

Use RoBots running on one computer from your phone, tablet or another computer: open it to your
local network or your private network (such as a Tailscale tailnet), then sign the other device in
with a one-time pairing code instead of typing your password there.

Nothing is reachable from other devices until you turn it on. A device that can reach RoBots
still has to sign in or pair.

## Pair a device

1. On a device that is already signed in, open **Settings → Devices** and select **Create code**.
2. On the new device, either scan the QR code, open the link, or open RoBots' address and select
   **Pair with a code** on the sign-in page, then type the code.
3. The new device is signed in to your account and appears under **Paired devices**, with when it
   was last seen and its address. **Sign out** ends one device's session; **Sign out all** ends
   every paired device except the one you are using.

A code:

- is 12 characters (`ABCD-EFGH-JKLM`) from an alphabet without look-alike characters, about 60
  bits;
- works once and expires after five minutes; creating another does not cancel the first;
- is stored only as a SHA-256 hash, and is consumed in the same statement that reads it, so two
  devices racing with one code cannot both sign in;
- travels in the link's fragment (`/pair#token=…`), which browsers never send to a server; the
  page removes it from the address bar and history before anything else runs.

The exchange (`POST /api/auth/pairing/exchange`) creates an ordinary session, as a password
sign-in would: an `HttpOnly`, `SameSite=Lax` cookie for browsers (`Secure` when the device came
over HTTPS), and a signed bearer token in the response for apps. It is refused when the request's
`Origin` is not one this server trusts (see below), so a page on another site cannot sign your
browser in to someone else's account. After five wrong codes from one address in 15 minutes, or
100 from any address, the exchange refuses everyone until the window passes; in production the
database-backed auth rate limit also applies. Pairing, failed codes and sign-outs are recorded in
the [audit log](self-host-audit-log.md) without the code.

`GET /.well-known/robots/environment` answers a public id derived from `BETTER_AUTH_SECRET`, so a
client can check it is talking to the server it expects before it sends a code.

## The desktop app's "This computer"

When the desktop app runs RoBots on this computer, **Settings → Devices → Network access** chooses
who can open it:

| Choice                      | What happens                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Only this computer**      | The default. The web port listens on `127.0.0.1` only.                                                                                                                                                                                                                                                                                                                              |
| **Local network**           | The web port listens on every interface, but the web server closes any connection that is not from loopback, a private LAN range (RFC 1918), or a private overlay network (100.64.0.0/10, IPv6 unique-local). This computer's private addresses are trusted for sign-in. Listed when the computer has a private address.                                                            |
| **Private network (HTTPS)** | The stack stays on loopback. The app publishes it at this computer's HTTPS name on the private network (`https://<machine>.<tailnet>.ts.net`), after checking that the network is connected, can issue a certificate, and that nothing else is already served at that name's HTTPS port; it never replaces someone else's configuration. Switching away removes only what it added. |

Turning either on asks for confirmation in a system dialog the page cannot answer, then restarts
the stack. The addresses the choice opened are listed under it, and the pairing link and QR code
use them. The choice is saved with the stack and applied every time it starts.

## Self-hosted and `pnpm dev`

The same pieces are environment variables.

Local network, with the Compose stack's `.env`:

```env
ROBOTS_WEB_BIND=0.0.0.0
ROBOTS_WEB_PRIVATE_PEERS_ONLY=true
ROBOTS_EXTRA_AUTH_ORIGINS=http://192.168.1.20:5173
```

- `ROBOTS_WEB_BIND` publishes the web port on that address (the default is `127.0.0.1`).
- `ROBOTS_WEB_PRIVATE_PEERS_ONLY=true` makes the web server close connections from anything but
  loopback and private networks before reading them. Leave it unset behind a public reverse proxy.
- `ROBOTS_EXTRA_AUTH_ORIGINS` lists every address devices open; see
  [Reaching RoBots from a second address](self-host-configuration.md#reaching-robots-from-a-second-address).
- A hostname other than an IP also goes in `ROBOTS_ALLOWED_HOSTS`.

Private network HTTPS: point the private network's HTTPS proxy at the web port, then trust its
name. With Tailscale:

```sh
tailscale serve --bg --https=443 http://127.0.0.1:5173
```

```env
ROBOTS_EXTRA_AUTH_ORIGINS=https://machine.your-tailnet.ts.net
ROBOTS_ALLOWED_HOSTS=machine.your-tailnet.ts.net
```

Remove it later with `tailscale serve --https=443 --set-path=/ off`.

For `pnpm dev`, `ROBOTS_DEV_TAILNET=1` does the HTTPS part for you (see the top of
`scripts/dev.mjs`), and `ROBOTS_DEV_HOST=0.0.0.0` with `ROBOTS_WEB_PRIVATE_PEERS_ONLY=true` and the
matching `ROBOTS_EXTRA_AUTH_ORIGINS` opens the dev server to the LAN.

Then pair devices from **Settings → Devices** as above.

## Phones

The pairing link opens in the phone's browser, which works today. The iOS and Android apps sign in
to a custom server with email and password (see [Apps and clients](self-host-clients.md)); pairing
them with a code or QR code (`robots://pair?url=…`, which the API already answers with a bearer
token) is not built yet.
