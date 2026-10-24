# Shortcraft — Cloud setup (Supabase + Cloudflare R2)

This guide connects the backend to the cloud.

- **Supabase** keeps the database (Postgres) and, later, user login.
- **Cloudflare R2** keeps the video files.
- **OpenAI** runs the AI agents (later).

You do it once. It takes about 30 minutes.

Rules for keys:

- Keys go **only** in `backend/.env`. This file is never committed (it is in `.gitignore`).
- Never paste keys in chat, in code, in screenshots, or in other files.
- If a key leaks, delete it in the dashboard and make a new one.

Without `backend/.env`, the backend still works. It uses a local SQLite file and local disk.
Tests always work this way.

---

## Part A — Supabase (database)

1. Go to <https://supabase.com> and sign in (GitHub login is fine).
2. Click **New project**.
   - Name: `shortcraft-dev`.
   - **Database password**: click *Generate*. Copy it and keep it safe (a password manager is
     best). You need it in step 5.
   - Region: choose the one closest to you.
   - Click **Create new project**. Wait 1–2 minutes.
3. At the top of the project page, click **Connect**.
4. Find **Session pooler** (port `5432`). Copy that connection string. It looks like this:

   ```text
   postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```

   Use the **Session pooler**. It works on every network (IPv4) and supports everything the app
   needs. Do not use the *Transaction pooler* (port `6543`) for now.
5. Make your `DATABASE_URL`:
   - Change the start `postgresql://` to `postgresql+asyncpg://`.
   - Replace `[YOUR-PASSWORD]` with your database password (no brackets).
   - If the password has special characters like `@ : / # ? %`, they must be encoded
     (`@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`, `?` → `%3F`, `%` → `%25`).
     Easier: reset the password in **Project Settings → Database** and use only letters and
     numbers.
6. Copy the **Project URL**: **Project Settings → API** (or **Data API**). It looks like
   `https://<project-ref>.supabase.co`. This is `SUPABASE_URL`.
7. JWT (for login later): **Project Settings → JWT Keys**.
   - If your project uses the new **signing keys** (default for new projects), you need
     nothing more. The backend reads the public keys from `SUPABASE_URL`.
   - If you use the **Legacy JWT secret**, copy it into `SUPABASE_JWT_SECRET`.

## Part B — Cloudflare R2 (video files)

1. Go to <https://dash.cloudflare.com> and create a free account (or sign in).
2. In the left menu, click **R2 Object Storage**. If asked, enable R2 (a payment card may be
   needed; the free tier is enough for development).
3. Click **Create bucket**.
   - Name: `shortcraft-dev`.
   - Location: Automatic.
   - Click **Create bucket**.
4. Copy your **Account ID**. It is on the R2 overview page (right side, "Account details").
   This is `R2_ACCOUNT_ID`.
5. Make an API token. On the R2 overview page, click **Manage API tokens** (under "API").
   - Click **Create API token** (an *Account API token* is fine).
   - Name: `shortcraft-dev-backend`.
   - Permissions: **Object Read & Write**.
   - Specify bucket(s): **Apply to specific buckets only** → choose `shortcraft-dev`.
   - TTL: Forever (or a date you like).
   - Click **Create API Token**.
6. The next page shows the keys **only once**. Copy:
   - **Access Key ID** → `R2_ACCESS_KEY_ID`
   - **Secret Access Key** → `R2_SECRET_ACCESS_KEY`

   (You do not need the "Token value" or the endpoint URL. The backend builds the endpoint
   from the Account ID.)
7. Allow the browser to upload (CORS):
   - Open the bucket `shortcraft-dev` → **Settings** → **CORS Policy** → **Add CORS policy**
     (or **Edit**).
   - Open the file `backend/infra/r2-cors.json`, copy everything, and paste it.
   - Change `https://app.example.com` to your real website later (or remove that line now).
   - Click **Save**.

   Why: the editor sends files directly from the browser to R2. Without CORS the browser
   blocks it. `ExposeHeaders: ETag` is needed for big (multipart) uploads.

## Part C — OpenAI (AI agents, later)

The agents are not built yet. You can do this now or later.

1. Go to <https://platform.openai.com> and sign in.
2. Open **API keys** (menu: Settings → API keys, or <https://platform.openai.com/api-keys>).
3. Click **Create new secret key**. Name it `shortcraft-dev`. Copy the key (shown once).
4. Put it in `OPENAI_API_KEY`. Add a little credit under **Billing** if your account has none.
5. Optional: agent tracing with LangSmith (<https://smith.langchain.com> → Settings →
   API keys) → `LANGSMITH_API_KEY`, and set `LANGSMITH_TRACING=true`.

## Part D — Fill `backend/.env`

1. In the `backend` folder, copy the example file:

   ```bash
   cd backend
   cp .env.example .env
   ```

2. Open `backend/.env` and fill these lines (keep the others as they are):

   ```ini
   DATABASE_URL=postgresql+asyncpg://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres

   STORAGE_BACKEND=r2
   R2_ACCOUNT_ID=<account id>
   R2_BUCKET=shortcraft-dev
   R2_ACCESS_KEY_ID=<access key id>
   R2_SECRET_ACCESS_KEY=<secret access key>

   SUPABASE_URL=https://<project-ref>.supabase.co
   # only if you use the legacy secret:
   SUPABASE_JWT_SECRET=

   OPENAI_API_KEY=
   ```

3. Save the file. No quotes are needed around values.

## Part E — Run and check

Run these in the `backend` folder, one by one.

1. Install packages:

   ```bash
   uv sync
   ```

2. Create the tables in Supabase:

   ```bash
   uv run alembic upgrade head
   ```

   You should see `Running upgrade ...` lines and no error.
3. Check the database:

   ```bash
   uv run python -m scripts.check_db
   ```

   You should see `PASS  connect: PostgreSQL ...` and `ALL PASS`.
4. Check R2:

   ```bash
   uv run python -m scripts.check_storage
   ```

   It uploads a tiny test file, downloads it, checks CORS, tests a multipart upload, and
   deletes everything. You should see `PASS` on every line and `ALL PASS`.
5. Run the tests (they do not use the cloud):

   ```bash
   uv run pytest
   ```

6. Start the server:

   ```bash
   uv run uvicorn app.main:app --reload --port 8000
   ```

   Open <http://localhost:8000/api/v1/health/ready>. You should see `"database": "ok"`.
   API docs: <http://localhost:8000/docs>.

To go back to local mode (no cloud), set `STORAGE_BACKEND=local` and empty `DATABASE_URL=`.

---

## Troubleshooting

**`check_storage`: "bucket CORS" FAIL, or the browser says "blocked by CORS policy"**

- Do Part B step 7 again. Check that the origin in the error (for example
  `http://localhost:3000`) is in `AllowedOrigins`. No slash at the end.
- After saving, wait a minute and try again.

**Big uploads fail at the end / "ETag" is empty in the browser**

- The CORS policy must have `"ExposeHeaders": ["ETag"]`. Without it the browser cannot read
  the part ETags, and `complete` fails.

**`check_storage`: 403 / AccessDenied / SignatureDoesNotMatch**

- The key pair is wrong or has extra spaces. Copy them again (or make a new token).
- The token must have **Object Read & Write** and include the bucket `shortcraft-dev`.
- `R2_BUCKET` must match the bucket name exactly.
- Your computer clock must be correct (presigned URLs depend on time).

**`check_db`: SSL error, or "connection was closed"**

- Supabase needs SSL. The backend adds `ssl=require` for Supabase hosts automatically.
- If you added `?sslmode=...` yourself, use `?sslmode=require`.

**"prepared statement ... already exists" / "does not exist"**

- This happens with the **Transaction pooler** (port `6543`). The backend turns off prepared
  statements for that port automatically. If you still see it, use the **Session pooler**
  (port `5432`) string instead.
- For migrations you can set a separate `DATABASE_URL_MIGRATIONS` (Session pooler or Direct
  connection).

**`check_db`: password authentication failed / "invalid literal for int()"**

- The password is wrong, or it has special characters that are not encoded. See Part A
  step 5. The user name must be `postgres.<project-ref>` for the pooler.

**`check_db`: timeout or "could not translate host name" / "getaddrinfo failed"**

- Free Supabase projects **pause after about 1 week without use**. Open the project in the
  dashboard and click **Restore project**. Wait a few minutes.
- The **Direct connection** (`db.<ref>.supabase.co`) is IPv6 only. If your network has no
  IPv6, use the **Session pooler**.

**The app does not start: "STORAGE_BACKEND=r2 but these settings are missing"**

- One of the `R2_...` lines is empty in `backend/.env`. The message lists which ones.

**401 "Invalid token" from the API**

- The frontend sent a Supabase token that the backend cannot verify. Check `SUPABASE_URL`
  (and `SUPABASE_JWT_SECRET` only if you use the legacy secret). Login is optional for now
  (`AUTH_REQUIRED=false`), so requests without a token still work.
