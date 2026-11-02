# gemsbang on Cloudflare

The beta runs as one Cloudflare Worker on `gemsbang.com` (architecture §2.3). The Worker hands
every request to one Durable Object, and that object runs the relay on its own SQLite. Its code is
`src/relay/worker.ts`, and its configuration is `wrangler.jsonc` beside this file. The plugin
signs in to `https://gemsbang.com` unless `GEMSBANG_SERVICE` names another.

Nothing here deploys on its own. Each step below changes the Cloudflare account or the domain, so
each is the maintainer's to take.

## What it needs

- The `gemsbang.com` zone on the Cloudflare account. It is there already.
- The Workers Paid plan. Email Service sends to any address only on a paid plan.
- Email sending turned on for `gemsbang.com`. This adds the SPF and DKIM records that the mail
  needs.

## Steps

    npm run build
    npx wrangler login
    npx wrangler email sending enable gemsbang.com
    npx wrangler email sending dns get gemsbang.com
    npx wrangler deploy -c cloudflare/wrangler.jsonc

1. `npm run build` makes `dist/relay/worker.js`. This is what `main` points at.
2. `wrangler login` signs in to the account in a browser.
3. `email sending enable` onboards the domain for sending, and `dns get` shows the records it
   added. They usually take 5–15 minutes to propagate.
4. `deploy` uploads the Worker. The `v1` migration creates the SQLite-backed object, and the
   custom domain route binds `gemsbang.com`.

## Checking it

    curl https://gemsbang.com/

The answer should be `{"name":"gemsbang.com","kind":"gemsbang"}`.

Then, in Claude Code with the plugin and no `GEMSBANG_SERVICE` set, open the panel, sign in with a
real email, and check that the code arrives from `noreply@gemsbang.com`.

## What one object means

One object orders every write, and it holds a few dozen people's chats easily (plan X). A wait on
someone's box is held inside the object for up to 25 seconds, and that time is billed as duration.
A card's deadline is the object's alarm.

Splitting the relay into one object per person, group and avatar waits until the load asks for it.
The documents are already kept one per entity.
