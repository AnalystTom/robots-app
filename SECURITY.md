# Security

## Reporting vulnerabilities

Email **security@tryrobots.app** only. Do not open public GitHub issues for security bugs.

Please include:

- Steps to reproduce
- Impact (what an attacker could do)
- Whether the issue is already public

We will acknowledge your report and work on a fix. Please do not file a public issue for unfixed vulnerabilities.

## Other contact

- Bugs and support questions: [GitHub issues](https://github.com/AnalystTom/robots-app/issues)

## Scope

This policy covers the RoBots self-hosted product in **this repository**.

Out of scope:

- Third-party AI models and their APIs
- Composio, E2B, and other external services
- Operator misconfiguration (exposed secrets, open databases, weak passwords)

## Prompt injection and outbound data

Pages, search results, files, connector data and inbound messages can carry text written to steer a bot into sending your data somewhere. The backend limits where data can go without a person seeing it:

- **Fetching pages.** `web_fetch` reads public web pages without asking, and sends its whole URL to the site it names. Injected text can steer it to any public site with data in the path or query; that trade-off is accepted, and an Ask rule for `web_fetch` turns the asks back on. It still asks before a risky target: an IP address on a private or internal network, `localhost` or another local or internal name, a cloud metadata host, a name outside the public suffix list, a URL with a user name or password, or a program or installer download. A risky target is not passed by a trusted site, a search result, an owner-named site or an Always allow rule. Downloads are recognized by the file extension in the URL only. A site you blocked is refused. With Auto Review on, a risky target goes to the reviewer, which sees only the full URL, the bot's description and your own words (your message or the routine's instructions), never the pages, results or inbound messages the run read. If it passes, the site is trusted for the rest of the run. Otherwise, or with Auto Review off, an approval card shows the full URL. Webhook runs have nobody to ask, so they refuse a risky target the reviewer did not pass. The fetch itself never reaches a private, internal or metadata address, after DNS and on every redirect, whatever was approved. `paid_request` still asks before a site the run was not given. Because a routine's instructions name sites for its runs, a routine written after a run took in outside content needs a person's approval when it names a site that run was not given; neither Auto Review nor a rule can pass it.
- **Web search.** Queries go only to the search provider the deployment configured, not to a site the text chose, so they are not gated.
- **Connector reads.** A read sends its arguments to the connector's server. Once a run has taken in outside content, a read on a connector the run had not already used is treated like a write: your approval rules and Auto Review apply to it. Webhook and other runs you did not start count as outside content from the start.
- **Link icons.** The server fetches an icon only from a link's registrable domain, never its subdomain or path, so a link cannot leak data through DNS or the request when it is rendered.

Known gaps:

- **Shell and browser.** Commands and pages on a bot computer can reach any public host. `SANDBOX_COMPUTER_EGRESS=restricted` (see [self-hosting](docs/self-host-docker-computers.md#restricted-computer-egress)) blocks private networks and cloud metadata, not public hosts. A bot that runs `curl` or opens a page can send data anywhere the computer can reach, and page scripts can too.
- **Open redirects and trusted sites.** Once a site is trusted for a run, any URL on it is allowed, including a redirect on that site to another host.
- **Saved state.** Memory, skills and earlier conversation are treated as yours. Text that an earlier run saved there is not flagged as outside content, including a skill a routine's instructions pull in, whose sites that routine's runs may fetch.
- **Public pages.** `web_fetch` reads any public site without asking, so text injected into a run can send your data out in the URL, its path or its query, such as `https://collector.example/c2VjcmV0`. This is accepted. To approve every fetch yourself, add an Ask rule for `web_fetch` in **Settings → Approvals**. There is no malware or phishing reputation check, so a public site known for either is read like any other.
- **Auto Review on risky targets.** The reviewer is a model judging whether a target fits your words. It never reads what the run took in, but injected text can still pick the URL it judges, so it may pass a target that looks plausible for the task or data hidden in an innocent-looking URL. Turn Auto Review off to have a person approve every risky target in runs you can answer; webhook runs then refuse them.

## Supported versions

We support security fixes on the current `main` branch and the latest release (beta).

There is no bug bounty program at this time.
