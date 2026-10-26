# Setting up Supabase and Google sign-in (M2), done by a person, not by Claude Code

Everything here is done in the browser profile of `admin@oksy.in` (Muhammed Ali), on **Free plans only**.
Never paste a password, key or secret into chat, a file in this repo, or an email.

## 1. Create the Supabase project (Free)
1. supabase.com: sign in with `admin@oksy.in`.
2. New project: organization on the **Free** plan, name **`oksy-data-cleanse`** (created 24-Oct, ref `ciorqudslbprfzxedcfy`), region **South Asia (Mumbai)** (`ap-south-1`).
3. Database password: click "Generate", save it in your password manager. Do not share it.
4. Note the **Project URL** and **project ref** (the part before `.supabase.co`). These are not secret.

## 2. Load the database structure (migrations)
In your own Terminal (not in Claude Code), Muhammed Ali runs:
```
supabase login
supabase link --project-ref <project ref>
supabase db push
```
`supabase login` opens the browser; sign in as `admin@oksy.in`. `db push` applies the files in `supabase/migrations` in order. Never change tables by hand in the dashboard.
Check afterwards: Table Editor shows `users_roles` with two rows (`anoop@oksy.in` ADMIN, `admin@oksy.in` APPROVER).

## 3. Google sign-in
### 3a. Google Cloud (project `oksy-data-cleanse`)
1. APIs & Services > OAuth consent screen (Google Auth Platform): app name "Oksy Data Cleanse".
   - Audience **Internal** if oksy.in is a Google Workspace and every portal user has an oksy.in account (only oksy.in accounts can then sign in).
   - **External** if helper staff will use Gmail accounts. The portal still lets in only emails an ADMIN added.
2. Clients > Create client > **Web application**, name "Oksy portal (Supabase)".
   Authorized redirect URI: `https://<project ref>.supabase.co/auth/v1/callback`
3. Copy the Client ID and Client secret **straight into step 3b**. Do not save them anywhere else.

### 3b. Supabase (Authentication)
1. Sign In / Providers: **Email: off**. **Google: on**, paste the Client ID and Client secret.
2. "Allow new users to sign up": leave **on**. The database itself refuses any email that an ADMIN has not added (`private.link_new_auth_user`), so strangers cannot get in.
3. URL Configuration: Site URL `http://localhost:3000`; Redirect URLs `http://localhost:3000/auth/callback`.
   (Add the Vercel address later, after Anoop decides on Vercel.)

## 4. Values for `apps/web/.env.local` (on this Mac, typed by Anoop or Muhammed Ali)
Copy `.env.example` to `apps/web/.env.local` and fill in only these two for M2:

| Name | Where to find it | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings > Data API (Project URL) | No |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Project Settings > API Keys > Publishable key (`sb_publishable_...`) | No, it is safe for the browser; RLS protects the data |

**Do not** add `SUPABASE_SERVICE_ROLE_KEY` (secret key) yet. It is needed only for the background worker (M3/M6).

## 5. GitHub secrets
None needed now. CI uses a throwaway local database and no secrets.

## 6. Test the login (on this Mac)
```
pnpm dev
```
Open http://localhost:3000, click "Sign in with Google":
- `anoop@oksy.in` shows Role **ADMIN** and the "Users and roles" link.
- `admin@oksy.in` shows Role **APPROVER** and no "Users and roles" link.
- Any other Google account is refused: "This Google account is not registered".
