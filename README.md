# gemini-tg-bot

A Telegram bot that talks to Google Gemini. Conversation context follows the Telegram
reply chain.

## Requirements

- Node 24 (>=24.15), pnpm (via corepack)

## Getting started

```bash
cp .env.example .env   # fill in tokens, keys, models, whitelists
pnpm install
pnpm dev               # runs without a build; restarts on file changes
```

Production: `pnpm build && pnpm start`

## Docker

The host `./data/` directory holds both `.env` and the DB:

```bash
mkdir -p data            # create it yourself, before docker makes it root-owned
cp .env data/.env        # to keep the old DB, also copy the converted telegram_log.db here
docker compose up -d --build
```

The DB lives at `./data/telegram_log.db` (plus its WAL/SHM sidecars).

## Commands

| Command | Description |
|---|---|
| /gemini (/g) | Chat with Gemini (search, code execution) |
| /image (/img) [1k\|2k\|4k] | Generate images |
| /map | Chat with Google Maps enabled |
| /summarize | Summarize links/documents (GeekNews style) |
| /help | Help |

Replying to any message of a bot response continues the conversation. The 🔄 button on
error messages retries.

## Migrating from the old version

Old-schema DBs are converted by a one-off script (details: the DB section of
docs/SPEC.md):

```bash
sqlite3 telegram_log.db < scripts/migrate-legacy.sql
```

Without the sqlite3 CLI (same content):

```bash
node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('telegram_log.db');db.exec(require('node:fs').readFileSync('scripts/migrate-legacy.sql','utf8'));db.close();console.log('done')"
```

## Docs

- [docs/SPEC.md](docs/SPEC.md) — feature specification (canonical)
- [docs/CODING.md](docs/CODING.md) — architecture, coding, and test rules
