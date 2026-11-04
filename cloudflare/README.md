# gemsbang on Cloudflare

The beta runs as one Cloudflare Worker on `gemsbang.com` (architecture §2.3). The Worker hands
every request to one Durable Object, and that object runs the relay on its own SQLite. Its code is
`src/relay/worker.ts`, and its configuration is `wrangler.jsonc` beside this file. The plugin
signs in to `https://gemsbang.com` unless `GEMSBANG_SERVICE` names another.

Nothing here deploys on its own. Each step below changes the Cloudflare account or the domain, so
each is the maintainer's to take.

## What it needs

- The `gemsbang.com` zone on the Cloudflare account. It is there already.
- The Workers Free plan is enough: it runs SQLite-backed Durable Objects, within its daily limits.
- A Resend key that may send from `mustapi.com`. For the beta the codes come from
  `no-reply@mustapi.com` (`MAIL_FROM`), the domain the maintainer's Resend already sends for, so
  no domain is added to Resend (its free plan holds one, by most accounts, and sends 100 mails a
  day). Mailing from `gemsbang.com` later means adding it in Resend, with the DNS records Resend
  lists, and changing `MAIL_FROM`.

## Steps

    npm run build
    npx wrangler login
    npx wrangler deploy -c cloudflare/wrangler.jsonc
    npx wrangler secret put RESEND_API_KEY -c cloudflare/wrangler.jsonc

1. `npm run build` makes `dist/relay/worker.js`. This is what `main` points at.
2. `wrangler login` signs in to the account in a browser.
3. `deploy` uploads the Worker. The `v1` migration creates the SQLite-backed object, and the
   custom domain route binds `gemsbang.com`.
4. `secret put` asks for the Resend key and keeps it on Cloudflare, out of the repository. The
   codes are mailed from `MAIL_FROM` (`no-reply@mustapi.com`) as "Gemsbang", and the sign-in
   names that sender. Without the key no mail goes; a mail Resend refuses is written to the
   Worker's log.

## Other accounts: Google, GitHub, Facebook, WeChat

Each account signs people in once both of its secrets are set; until then its key is not on the
sign-in page. Register one app per account and give it this address to come back to, with the
account's name at the end:

    https://gemsbang.com/login/callback/google
    https://gemsbang.com/login/callback/github
    https://gemsbang.com/login/callback/facebook
    https://gemsbang.com/login/callback/wechat

Then store its two values:

| Account | Where the app is made | Secrets |
|---|---|---|
| Google | Google Cloud console, OAuth client of type Web application; scopes `openid email profile` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| GitHub | GitHub settings, Developer settings, OAuth Apps | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| Facebook | Meta for Developers, an app with Facebook Login; it wants a privacy policy and a data deletion page before it goes live | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` |
| WeChat | WeChat Open Platform, a website app with WeChat login; it needs a company account and the site's ICP filing | `WECHAT_APP_ID`, `WECHAT_APP_SECRET` |

    npx wrangler secret put GITHUB_CLIENT_ID -c cloudflare/wrangler.jsonc

A Google or GitHub address that account checked joins the person who already signs in with it
(Q19). Facebook's and WeChat's never do.

## Phone numbers: Twilio

Codes by text go through Twilio. Set the account, its auth token, and the number or messaging
service (`MG…`) they come from, then the calling codes numbers may be texted at:

    npx wrangler secret put TWILIO_ACCOUNT_SID -c cloudflare/wrangler.jsonc
    npx wrangler secret put TWILIO_AUTH_TOKEN -c cloudflare/wrangler.jsonc
    npx wrangler secret put TWILIO_FROM -c cloudflare/wrangler.jsonc
    npx wrangler secret put SMS_COUNTRIES -c cloudflare/wrangler.jsonc

`SMS_COUNTRIES` is a list such as `+63,+1`. Without Twilio, or without the list, no number signs
in, and the sign-in says so. Only the countries listed are texted, so nobody runs up texts to
everywhere.

## Test accounts: Smith

The emails listed in the `SHOW_CODE_TO` secret, separated by commas, get their code back in the
`/login` answer, and no mail is sent. The plugin signs in with that code straight away, so typing
the address is enough. That is how the test account Smith signs in (Q21): `SHOW_CODE_TO` is
`smith@test.gemsbang.com`, and the first sign-in names the first avatar Smith. Anyone who types
that address gets in, so keep nothing real in a test account.

    npx wrangler secret put SHOW_CODE_TO -c cloudflare/wrangler.jsonc

On this machine, `gemsbang relay serve --show-code-to smith@test.gemsbang.com` does the same.

## Checking it

    curl https://gemsbang.com/

The answer should be `{"name":"gemsbang.com","kind":"gemsbang"}`.

Then, in Claude Code with the plugin and no `GEMSBANG_SERVICE` set, open the panel, sign in with a
real email, and check that the code arrives from `no-reply@mustapi.com`.

## What one object means

One object orders every write, and it holds a few dozen people's chats easily (plan X). A wait on
someone's box is held inside the object for up to 25 seconds, and that time is billed as duration.
A card's deadline is the object's alarm.

Splitting the relay into one object per person, group and avatar waits until the load asks for it.
The documents are already kept one per entity.
