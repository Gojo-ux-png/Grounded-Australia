# Grounded Australia

An Australian agricultural Q&A community MVP built with Vinext and Cloudflare.

## Product surface

- Public question discovery, location/category filters and search
- Demo Farmer, Experienced Contributor and Verified Expert identities
- Durable questions, answers, votes, comments, saves, follows, invitations and reports
- D1 community records and R2 image uploads
- XP levels, selected answers, expert profiles and leaderboard

## Local development

```bash
pnpm install
pnpm dev
```

Generate migrations after changing `db/schema.ts` with `pnpm db:generate`, then validate with `pnpm test`.
