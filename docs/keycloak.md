# Connect the app to Keycloak locally

1. Install Docker.
2. Start Keycloak:

```bash
docker compose up -d keycloak
```

   Use compose rather than a bare `docker run` — the `keycloak_data` volume it
   mounts is what keeps the realm, its client and its signing key across a
   container rebuild. A plain `docker run` (or `docker compose down -v`) throws
   all of that away, and the realm has to be rebuilt and `PUBLICKEY` re-copied.

3. Open the Keycloak Admin Console at `http://localhost:4000/`
4. **Login** with username: `admin` and password: `admin`

### Create the Realm

5. **Create a new realm** (the app is configured to use `learningapp`):
   - Click the dropdown in the top-left corner (currently shows "master")
   - Click **"Create Realm"**
   - **Realm name**: `learningapp`
   - Click **"Create"**

### Create the Client

6. **Create a new client** (the app is configured to use `learning-client`):
   - In the left sidebar, click **"Clients"**
   - Click **"Create client"** button
   - **Client type**: `OpenID Connect`
   - **Client ID**: `learning-client`
   - Click **"Next"**

7. **Configure client authentication**:
   - **Client authentication**: OFF (public client)
   - **Authorization**: OFF
   - **Authentication flow**: 
     - ✅ Standard flow
     - ✅ Direct access grants (local only, for testing with curl — never on a
       shared realm)
   - Click **"Next"**

8. **Configure login settings**:
   - **Root URL**: `http://localhost:5173`
   - **Home URL**: `http://localhost:5173`
   - **Valid redirect URIs**: `http://localhost:5173/*`
   - **Valid post logout redirect URIs**: `http://localhost:5173/*`
   - **Web origins**: `+` (this allows CORS from all valid redirect URIs)
   - Click **"Save"**

### Create a Test User (Optional but Recommended)

9. **Create a test user**:
   - In the left sidebar, click **"Users"**
   - Click **"Add user"** button
   - **Username**: `testuser` (or any username you prefer)
   - **Email**: `test@example.com` (optional)
   - **First name**: Test (optional)
   - **Last name**: User (optional)
   - Click **"Create"**

10. **Set user password**:
    - After creating the user, click on the **"Credentials"** tab
    - Click **"Set password"**
    - **Password**: Enter a password (e.g., `test123`)
    - **Password confirmation**: Enter the same password
    - **Temporary**: Toggle **OFF** (so user doesn't have to change password on first login)
    - Click **"Save"**
    - Confirm by clicking **"Save password"** in the dialog

### Point the Backend at the Realm

The realm and client are named in one place: the backend's environment. The
browser asks the backend for them at start-up (`GET /auth-config`), so nothing
about the realm is baked into the frontend image.

| Variable | What it is | Local default |
|---|---|---|
| `KEYCLOAK_URL` | Browser-facing Keycloak address | `http://localhost:4000` |
| `KEYCLOAK_REALM` | The realm | `learningapp` |
| `KEYCLOAK_CLIENT_ID` | The app's public client — the one whose roles count | `learning-client` |
| `KEYCLOAK_IDP_HINT` | Alias of the Google identity provider, for the Google button | `oauth2` locally |
| `KEYCLOAK_ADMIN_URL` | Where the backend itself reaches Keycloak | `http://keycloak:8080` in compose |
| `PUBLICKEY` | Optional pinned realm key | unset — keys are fetched from the realm |

11. **Optional: pin the realm public key.** Left unset, the backend fetches the
    realm's signing keys itself (and again when the realm rotates them). To pin
    one instead:

    ```bash
    curl -s http://localhost:4000/realms/learningapp \
      | python3 -c 'import sys,json;print("PUBLICKEY="+json.load(sys.stdin)["public_key"])' \
      >> .env      # then delete any older PUBLICKEY line
    ```

12. **Recreate the backend** so it picks up new values:

    ```bash
    docker compose up -d backend
    ```

    `docker compose restart backend` is not enough — compose substitutes `.env`
    when it creates the container, not when it restarts one.

13. **Check it end to end** — sign in at `http://localhost:5173`, or with the
    password grant if you enabled **Direct access grants** on the local client:

    ```bash
    TOKEN=$(curl -s -d client_id=learning-client -d username=testuser \
      -d password=test123 -d grant_type=password \
      http://localhost:4000/realms/learningapp/protocol/openid-connect/token \
      | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
    curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" \
      http://localhost:5002/table-members/    # expect 200
    ```

**Google sign-in:** if you change the realm name, the Google OAuth redirect URI
in Google Cloud Console changes too:
`http://localhost:4000/realms/YOUR_REALM_NAME/broker/<idp alias>/endpoint`.

## Deployed: the shared central realms

Staging and production sign in through the company-wide realms on
`auth.ttgteams.com` — `central-staging` and `central` — which other
applications share. Everything the app does is therefore scoped to its own
client:

- Its roles are **client roles on `learning-client`**. Realm roles are ignored
  entirely, so a realm-wide `admin` held for another app means nothing here.
- Tokens issued to any other client in the realm are refused, even though they
  are signed with the same key.
- The app never creates, edits or deletes a Keycloak account. Deleting someone
  on the Users page deletes their data here and removes the app's roles; their
  company sign-in is untouched.

The settings live in Infisical (project `learning-app-l-lb-j`, environments
`staging` and `prod`), which the operator syncs into the backend's secret:

```
KEYCLOAK_URL=https://auth.ttgteams.com
KEYCLOAK_REALM=central-staging            # central in prod
KEYCLOAK_CLIENT_ID=learning-client
KEYCLOAK_IDP_HINT=google
KEYCLOAK_ADMIN_URL=https://auth.ttgteams.com
KEYCLOAK_SERVICE_CLIENT_ID=learning-admin-api
KEYCLOAK_SERVICE_CLIENT_SECRET=<from the client's Credentials tab>
```

The backend reads its environment at start-up, so restart it after a change.

## Admin role management

The **Users** page has two switches per person, **Author access** and **Admin
access**. They change the person's roles on the app's client in Keycloak, so
the change is in their next token (within a few minutes) and anyone looking at
the client sees the same lists. Without the setup below the page still shows
who holds which role, but the switches are turned off.

| Role | Client role on `learning-client` | What it allows |
|---|---|---|
| Author | `contributor` | Create their own courses and quizzes, assign learning, the dashboard — everything except the Users page |
| Admin | `admin` | Everything an author can do, plus the Users page: accounts and roles |

Being named as an author on one course is separate from both: it lets someone
edit that course but not create their own, and is set on the course itself.

1. **Create the client roles** on the app's client (skip any that exist):
   **Clients → `learning-client` → Roles → Create role**, name `admin`,
   **Save**; then again for `contributor`.
2. **Keep the app's tokens to the app's roles**: **Clients → `learning-client`
   → Client scopes → `learning-client-dedicated` → Scope** → turn **Full scope
   allowed** OFF. (The backend ignores other roles anyway; this keeps them out
   of the token altogether.)
3. **Create the service client**: **Clients → Create client**
   - **Client ID**: `learning-admin-api`
   - **Next** → **Client authentication**: ON · **Service accounts roles**: ✅ ·
     untick **Standard flow** and **Direct access grants** → **Save**
4. **Give it just enough permission**: open the client → **Service accounts
   roles** tab → **Assign role** → filter by **clients** → pick
   `realm-management` roles **view-users** and **view-clients** → **Assign**.
   Then let it map only the app's roles, using fine-grained admin permissions:
   - **Clients → `learning-client` → Permissions** → turn permissions on →
     open **map-roles** → add a client policy naming `learning-admin-api`.
   - **Users → Permissions** (realm) → turn on → open **map-roles** → add the
     same policy.

   With both, the service account can grant and remove `learning-client`'s
   roles and nothing else — it cannot edit, delete or create accounts, and
   cannot hand out any other role in the realm. Do not give it
   `manage-users`: in a shared realm that is every user in the company.
5. **Copy its secret**: **Credentials** tab → **Client secret**.
6. **Give the backend the credentials** in the root `.env` (Docker),
   `backend/.env` (running locally) or Infisical (k8s):

   ```bash
   KEYCLOAK_SERVICE_CLIENT_ID=learning-admin-api
   KEYCLOAK_SERVICE_CLIENT_SECRET=<the secret>
   # Only when running the backend outside Docker:
   KEYCLOAK_ADMIN_URL=http://localhost:4000
   ```

7. Recreate the backend (`docker compose up -d backend`).

Someone must have signed in to the app at least once before they can be made
an admin — until then they have no Keycloak account to give the role to. An
admin cannot remove their own access; another admin has to.

## Central profile

On someone's first sign-in (no row bound to their Keycloak account yet), the
backend calls the central profile service's `POST /persons/resolve` with their
Keycloak id, first and last name and email from the token, so everyone who
uses the app has a central profile. A @ttgteams.com address is sent as
`work_email`, anything else as `email`. Returning users are not sent again.

If central cannot be reached the sign-in fails and the next request tries
again. A 409 (the email already belongs to another person in central) is logged
and the sign-in goes ahead.

It needs a service-account client in the realm with central's `person.write`
role, and these in Infisical:

```
CENTRAL_PROFILE_URL=http://central-profile-backend-service.central-profile.svc
CENTRAL_PROFILE_TOKEN_URL=https://auth.ttgteams.com/realms/central/protocol/openid-connect/token   # central-staging in staging
CENTRAL_PROFILE_CLIENT_ID=<the client>
CENTRAL_PROFILE_CLIENT_SECRET=<its secret>
```

Without them the call is skipped, which is what local development wants.
