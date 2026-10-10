# Public Birthday Guestbook Setup

The GitHub Pages site is static, so wishes are sent to a Cloudflare Worker. The Worker stores the GitHub token as a server-side secret and appends submissions to `wishes.json` on the `main` branch of `mhasan-exe/RayyanBabe`.

Wishes in this repository are public. The form tells visitors this and requires them to acknowledge it before sending.

## Deploy the Worker

1. Install Node.js, then run `npx wrangler login` from this repository and sign in to your Cloudflare account.
2. Create a fine-grained GitHub token for only `mhasan-exe/RayyanBabe`, with **Contents: Read and write** permission. Do not put the token in `index.html` or commit it.
3. Run `npx wrangler secret put GITHUB_TOKEN` and paste the token into the terminal prompt.
4. Run `npx wrangler deploy`. The command prints the Worker URL, similar to `https://rayyan-birthday-wish.<your-subdomain>.workers.dev`.
5. In `index.html`, replace `YOUR_SUBDOMAIN` in the wish form's `data-endpoint` with the subdomain from that URL. Commit and push the updated page to GitHub Pages.

The Worker only accepts requests from `https://mhasan-exe.github.io`, limits submissions to five per minute per IP, and appends wishes with a timestamp. If the repository uses a custom Pages domain, update `ALLOWED_ORIGIN` in `wrangler.toml` to that domain's origin before deploying.

## Read Wishes

`wishes.json` starts as an empty list and is updated on each successful submission. Each entry contains the wish text and its submission time. Because the repository is public, anyone can read these entries.