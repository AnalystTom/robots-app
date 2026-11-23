import { hostingPrice } from "./provider.js";

export const registrationPath = "/api/registration";
export const localArchive = "robots-local-linux-amd64.tar.gz";
const price = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: hostingPrice.currency,
  maximumFractionDigits: 0,
}).format(hostingPrice.amount / 100);

function page(title: string, content: string) {
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title} · RoBots</title>
    <style>
        *{box-sizing:border-box}
        body{margin:0; background:#f7f7f2; color:#202525; font:17px/1.5 system-ui,sans-serif}
        main{max-width:720px; margin:clamp(32px,10vh,100px) auto; padding:0 24px}
        header{font-weight:800; letter-spacing:-.06em; font-size:25px}
        h1{font-size:clamp(36px,7vw,58px); line-height:1.05; letter-spacing:-.055em; margin:44px 0 28px}
        h2{font-size:22px; letter-spacing:-.035em; margin:0}
        p{color:#535959; margin:.5em 0 1.2em}
        section{padding:22px 0; border-top:1px solid #cccfc8}
        .row{display:flex; justify-content:space-between; gap:24px; align-items:baseline}
        a{color:#16564c; text-underline-offset:4px}
        a:focus-visible,button:focus-visible{outline:3px solid #358272; outline-offset:4px}
        button{color:white; background:#215b50; border:none; border-radius:8px; padding:12px 18px; font:inherit; font-weight:600; cursor:pointer}
        code{background:#e8eae3; padding:2px 5px; overflow-wrap:anywhere}
        footer{margin-top:26px}
        form{margin:12px 0}
        @media(max-width:420px){.row{flex-wrap:wrap; gap:0 12px}
        }
  </style>
  </head>
  <body>
    <main>
      <header>RoBots</header>
      <h1>${title}</h1>
      ${content}
    </main>
  </body>
</html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "same-origin",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      },
    },
  );
}

export const setupPage = () =>
  page(
    "Choose your setup",
    `<section>
      <div class="row"><h2>Run locally</h2><strong>Free</strong></div>
      <p>Run RoBots on your computer with Docker.</p>
      <a href="${registrationPath}/local">Set up locally</a>
    </section>
    <section>
      <div class="row"><h2>Hosted workspace</h2><strong>US${price} / month</strong></div>
      <p>Use your own model account. Checkout is simulated during private testing.</p>
      <a href="/sign-up">Create a hosted account</a>
    </section>
    <footer>Already registered? <a href="/sign-in">Sign in</a></footer>`,
  );
export const localPage = () =>
  page(
    "Set up locally",
    `<p>For Linux x86-64 with Docker Engine and Docker Compose.</p>
    <ol>
      <li><a download href="${registrationPath}/${localArchive}">Download the local installer</a> and extract the archive.</li>
      <li>In the extracted folder run <code>bash install-local.sh</code>.</li>
      <li>Open the signup address printed in your terminal. Create your account and connect your model.</li>
    </ol>
    <footer><a href="${registrationPath}">Back to setup</a></footer>`,
  );
export const checkoutPage = (active: boolean) =>
  page(
    active ? "Manage test subscription" : "Test checkout",
    `<section>
      <div class="row"><h2>Hosted workspace</h2><strong>US${price} / month</strong></div>
      <p>This test uses simulated payments. No card or charge.</p>
      <form method="post"><button name="action" value="${active ? "end" : "subscribe"}">${active ? "End test subscription" : "Confirm test subscription"}</button></form>
      <form method="post"><button style="background:transparent;color:#16564c;padding-left:0" name="action" value="cancel">Back to RoBots</button></form>
    </section>`,
  );
