# Praveen Photography — Next.js + Cloudflare R2 + PostgreSQL (Drizzle ORM)

A photo selection platform for photography clients. Admins upload compressed thumbnails to Cloudflare R2; customers browse and select their favourites. Full-resolution files never leave the admin's local disk.

---

## Stack

| Layer       | Technology                          |
|-------------|-------------------------------------|
| Framework   | Next.js 14 (App Router)             |
| Database    | **PostgreSQL** via **Drizzle ORM**  |
| Storage     | **Cloudflare R2** (thumbnails only) |
| Auth        | JWT (httpOnly cookies)              |
| Styling     | Tailwind CSS                        |

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

```bash
cp .env.local.example .env.local
# Fill in DATABASE_URL, JWT_SECRET, and Cloudflare R2 credentials
```

### 3. Set up Cloudflare R2

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → **R2**
2. Create a bucket (e.g. `praveen-photography`)
3. Enable **Public Access** on the bucket (or set up a custom domain)
4. Go to **Manage R2 API Tokens** → Create a token with **Object Read & Write** on your bucket
5. Copy the **Account ID**, **Access Key ID**, **Secret Access Key**, and **Public Bucket URL** into `.env.local`

### 4. Set up the database

**Option A — Push schema directly (fastest for dev):**
```bash
npm run db:push
```

**Option B — Generate & run migrations (recommended for production):**
```bash
npm run db:generate   # creates SQL files in /drizzle
npm run db:migrate    # applies them to the DB
```

### 5. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment Variables

| Variable              | Description                                             |
|-----------------------|---------------------------------------------------------|
| `DATABASE_URL`        | PostgreSQL connection string                            |
| `JWT_SECRET`          | Secret for signing JWT tokens                           |
| `R2_ACCOUNT_ID`       | Cloudflare account ID                                   |
| `R2_ACCESS_KEY_ID`    | R2 API token Access Key ID                              |
| `R2_SECRET_ACCESS_KEY`| R2 API token Secret Access Key                          |
| `R2_BUCKET_NAME`      | R2 bucket name                                          |
| `R2_PUBLIC_URL`       | Public URL for the bucket (e.g. `https://pub-xxx.r2.dev`) |

---

## Database Schema

Four tables, all defined in `lib/schema.ts`:

| Table       | Description                                      |
|-------------|--------------------------------------------------|
| `admins`    | Admin login credentials                          |
| `customers` | Client records with event info & selection state |
| `folders`   | Photo folders per customer                       |
| `photos`    | Thumbnail metadata + R2 object keys & URLs       |

IDs are **serial integers** (auto-increment). All foreign keys use `ON DELETE CASCADE`.

---

## Drizzle Scripts

| Script              | What it does                                  |
|---------------------|-----------------------------------------------|
| `npm run db:generate` | Generate SQL migrations from `lib/schema.ts` |
| `npm run db:migrate`  | Apply pending migrations to the database     |
| `npm run db:push`     | Push schema changes directly (dev only)      |
| `npm run db:studio`   | Open Drizzle Studio (visual DB browser)      |

---

## Migration from Cloudinary to Cloudflare R2

Changes made during this migration:

- **Removed** `lib/cloudinary.ts` → replaced with `lib/r2.ts` (AWS Signature V4, no SDK needed)
- **Renamed** DB column `cloudinary_public_id` → `r2_object_key` in `lib/schema.ts`
- **Updated** `app/api/admin/photos/route.ts` — calls `uploadThumbnailToR2` instead of `uploadThumbnailToCloudinary`
- **Updated** `app/api/admin/photos/[id]/route.ts` — calls `deleteThumbnailFromR2` instead of `deleteThumbnailFromCloudinary`
- **Updated** `next.config.js` — allows `*.r2.dev` (and optionally your custom domain) as image host
- **Updated** `.env.local.example` — replaced Cloudinary vars with R2 vars

> **Database migration note:** If you have an existing database with the `cloudinary_public_id` column, run a migration to rename it to `r2_object_key` before deploying.

---

## Project Structure

```
├── app/
│   ├── api/
│   │   ├── auth/admin/         # Admin login
│   │   ├── auth/customer/      # Customer access-code login
│   │   ├── auth/logout/        # Logout
│   │   ├── admin/customers/    # CRUD customers
│   │   ├── admin/folders/      # CRUD folders
│   │   ├── admin/photos/       # Upload & manage photos
│   │   ├── admin/stats/        # Dashboard stats
│   │   ├── admin/download/     # Get selected photos list
│   │   ├── customer/gallery/   # Customer gallery view
│   │   ├── customer/select/    # Toggle / confirm selections
│   │   └── customer/photo/     # Single photo fetch
│   ├── admin/                  # Admin UI pages
│   ├── customer/               # Customer UI pages
│   └── login/                  # Login page
├── lib/
│   ├── schema.ts               # Drizzle table definitions
│   ├── db.ts                   # Drizzle client
│   ├── auth.ts                 # JWT helpers
│   └── r2.ts                   # ✅ Cloudflare R2 upload/delete helpers (replaces cloudinary.ts)
├── drizzle/                    # Generated SQL migration files
├── drizzle.config.ts           # Drizzle Kit config
└── .env.local.example
```

---

## Supported PostgreSQL Providers

Any standard PostgreSQL connection string works:

- **Local** — `postgresql://postgres:password@localhost:5432/praveen_photography`
- **Neon** — `postgresql://user:pass@ep-xxx.aws.neon.tech/db?sslmode=require`
- **Supabase** — `postgresql://postgres:[pass]@db.[ref].supabase.co:5432/postgres`
- **Railway / Render / Fly.io** — use the `DATABASE_URL` they provide
