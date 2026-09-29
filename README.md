# Grounded Australia

An Australian agriculture Q&A community built with Vinext, React, local Cloudflare D1 and R2.

## Cloudflare release

The online preview uses Cloudflare Workers + D1 in guest mode. New registrations, account access, email and direct photo uploads remain closed until Turnstile, email and private storage are configured. See the [deployment guide (中文)](docs/cloudflare-deployment.md) for release commands and how to enable those capabilities.

Preview: [Grounded Australia](https://grounded-australia.grounded-au.workers.dev/).

The preview includes 5 clearly labeled demo profiles, 5 questions, 4 answers and 2 comments. Demo profiles have no login credentials or expert verification. Hosted demo content is hidden when registration opens.

## Local development

Requires Node >=22.13 and pnpm 11.19. Both arm64 and x64 optional binaries are installed for Macs with native and Rosetta Node installations.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Keep the server running. In a second terminal, apply the schema to the local D1 database:

```bash
pnpm db:local
# Optional illustrative content (explicitly labeled as demo):
pnpm db:seed
```

Open the Local URL printed by the development server. The database is in `.wrangler/state`, and migration backups are in `.wrangler/backups`. If no database file exists yet, visit the local page once and rerun `pnpm db:local`.

The local migration command adopts the old runtime-created schema, applies generated migrations without dropping records, and is safe to rerun. Schema creation and demo insertion no longer happen on application requests. Hosted deployments use the append-only Drizzle migrations; `scripts/local-db.mjs` is only for local operation.

## Reviewer setup

Register a normal local account first, then explicitly grant that account reviewer access:

```bash
pnpm admin:local your-registered-email@example.com
```

The email must belong to an existing account in this local database. Nobody becomes a reviewer automatically. Sign in and open `/moderation` to approve/reject expert applications, revoke verification, handle question/answer/comment reports, and review the action history. Approval requires another reviewer; a reviewer cannot certify their own application.

Members apply from `/me?tab=profile`. Application evidence is private to the applicant and reviewers. Approved field and public verification basis are shown on the profile. XP is a contribution measure and never awards professional verification.

## Implemented flows

- Compact question feed, mobile navigation, server-side town/category/state/status searches, question and directory pagination.
- Structured optional field context, a device-local question draft, photo upload and video links.
- Public profile editing, avatars, specialties, service regions and member follows.
- Private saved/followed question lists, invitations, notifications and report outcomes in `/me`.
- Expert invitations matched to the approved field, with local service regions ranked first.
- Answer votes, comments, acceptance, revisions, product relationships and video/reference links.
- Field outcomes separate from acceptance: trying, improved, unchanged or reported resolved.
- Private per-member activity responses, moderation visibility checks and same-origin mutations.
- Points and rewards: verified contributions, private points breakdown, reward catalogue, atomic redemption, cancellation and reviewer fulfilment. See [reward rules and operations](docs/rewards.md).
- Uploads bounded to 5 MB JPEG/PNG/WebP with byte-signature checks; SVG including legacy stored SVG is blocked. Browser uploads are decoded, resized and re-encoded before submission. Signature checks on the server are not a full image decoder; direct API callers do not get automatic metadata removal. Media responses set nosniff and a sandbox CSP.
- Server-rendered homepage/question content and question-specific metadata. Canonical and social URLs come from the configured SITE_URL; staging is excluded from indexing.

## Validation

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm test:preview
pnpm test:preview --without-media
pnpm test:preview --closed-registration
# Requires the running, migrated local server:
pnpm test:integration
```

`pnpm test` checks fresh migrations, reruns and explicit reviewer provisioning. Integration tests create isolated temporary member accounts and remove only their SQL records at the end. They cover account/profile authorization, private data, local expert search, invitation delivery, vote removal on legacy databases, acceptance rewards, revisions, field outcomes, moderation, invalid relationship values, a 100+ answer discussion, media validation and public HTML rendering. A tiny generated test photo remains in local R2 storage. The built-Worker preview test additionally starts and stops its own local preview server.

## Scope after the September audit

The core review recommendations are implemented locally. Points and redemption are implemented. Private messaging, AI features, paid consultation, region/topic subscriptions and a marketplace remain later phases. Cloudflare email verification, single-use password recovery, password change and sign-out-all are implemented. Real email delivery and Turnstile credentials must be configured per environment; local development does not send mail. Reviewer access must be assigned to a real registered account before operating a live review queue.

## Administrator publishing

Administrators can open `/me` → **Publish knowledge**, or `/ask?type=knowledge`, to publish practical guides with a category, location, tags, photo and video link. Guides appear in the community feed and `/search?type=knowledge`. Open a post and select **Edit knowledge** to update it. Administrator edits are recorded in the review history. Only administrators can create or edit knowledge posts.

To bootstrap an explicitly designated new administrator while registration is closed:

```bash
pnpm cf:admin:create production administrator@example.com
```

The command leaves existing accounts and passwords unchanged. It creates a new administrator with no usable password and writes a private, single-use password setup link to `.wrangler/admin-setup.md` (expires in 30 minutes). Deliver that link directly to the designated owner. Completing password setup activates the account for posting through the existing recovery flow. No email is sent. Existing verified accounts use `pnpm cf:admin production email`. Set the administrator's public name and region under `/me?tab=profile` after signing in.
