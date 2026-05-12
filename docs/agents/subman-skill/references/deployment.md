# SubMan Deployment Reference

## Commands

Install dependencies:

```bash
bun install
```

Local Vite dev server:

```bash
bun run dev
```

Cloudflare Workers local runtime:

```bash
bun run dev:cf
```

Static/type checks:

```bash
bun run check
bun run lint
```

Build and deploy:

```bash
bun run build
bun run deploy
```

## Cloudflare Secrets

The Server API needs two Worker secrets:

```bash
bun wrangler secret put GITHUB_TOKEN
bun wrangler secret put SUBMAN_API_TOKEN
```

- `GITHUB_TOKEN`: GitHub token with `gist` permission. Keep only in Cloudflare
  Secrets.
- `SUBMAN_API_TOKEN`: custom bearer token used by trusted backend scripts.

## Health Check

After deployment, verify secret configuration:

```bash
curl -sS "https://subman.example.com/api/health"
```

Expected successful shape:

```json
{
  "ok": true,
  "config": {
    "githubToken": true,
    "submanApiToken": true
  }
}
```

## Deployment Notes

- Use `bun run build` before `bun run deploy`.
- `GET /api/health` does not reveal secret values.
- The browser UI can still operate locally with localStorage when no browser
  GitHub token is configured.
- The trusted Server API path depends on Worker secrets, not browser-local auth
  state.

