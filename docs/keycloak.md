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
     - ✅ Direct access grants
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

11. **Copy the realm public key into the backend environment.** The backend
    verifies every token against `PUBLICKEY`, so a key that does not match this
    realm rejects all sign-ins with a 401:

    ```bash
    curl -s http://localhost:4000/realms/learningapp \
      | python3 -c 'import sys,json;print("PUBLICKEY="+json.load(sys.stdin)["public_key"])' \
      >> .env      # then delete any older PUBLICKEY line
    ```

    The same value is in the admin console under **Realm settings → Keys → RS256
    → Public key**.

12. **Recreate the backend** so it picks up the new value:

    ```bash
    docker compose up -d backend
    ```

    `docker compose restart backend` is not enough — compose substitutes `.env`
    when it creates the container, not when it restarts one.

13. **Check it end to end:**

    ```bash
    TOKEN=$(curl -s -d client_id=learning-client -d username=testuser \
      -d password=test123 -d grant_type=password \
      http://localhost:4000/realms/learningapp/protocol/openid-connect/token \
      | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
    curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" \
      http://localhost:5002/table-members/    # expect 200
    ```

> **Note**: The app is pre-configured to work with realm name `learningapp` and client ID `learning-client`. If you use these exact names, you won't need to modify any configuration files.

### Using Different Realm/Client Names

If you want to use different realm or client names, you'll need to update the following configuration file:

**File to update**: `config/keycloak.json`

```json
{
  "realm": "your-realm-name",           // Change this to your realm name
  "auth-server-url": "http://localhost:4000/",
  "ssl-required": "external",
  "resource": "your-client-id",         // Change this to your client ID
  "public-client": true,
  "confidential-port": 0
}
```

**Important**: If you change the realm name AND plan to use Google OAuth (see Google OAuth Setup section below), you must also update:
- The Google OAuth redirect URI in Google Cloud Console
- The redirect URI format will change to: `http://localhost:4000/realms/YOUR_REALM_NAME/broker/oauth2/endpoint`

## Admin role management

The **Users** page has two switches per person, **Author access** and **Admin
access**. They change the roles in Keycloak itself, so the change is in the
person's next token (within a few minutes) and anyone looking at the realm sees
the same lists. Without the setup below the page still shows who holds which
role, but the switches are turned off.

| Role | Keycloak realm role | What it allows |
|---|---|---|
| Author | `contributor` | Create their own courses and quizzes, assign learning, the dashboard — everything except the Users page |
| Admin | `admin` | Everything an author can do, plus the Users page: accounts and roles |

Being named as an author on one course is separate from both: it lets someone
edit that course but not create their own, and is set on the course itself.

People given a role the older way — as a client role on `learning-client` (see
[CMS.md](CMS.md)) — are still recognised, and removing a role from the Users
page removes both.

1. **Create the realm roles** (skip any that exist): **Realm roles → Create
   role**, name `admin`, **Save**; then again for `contributor`.
2. **Create the service client**: **Clients → Create client**
   - **Client ID**: `learning-admin-api`
   - **Next** → **Client authentication**: ON · **Service accounts roles**: ✅ ·
     untick **Standard flow** and **Direct access grants** → **Save**
3. **Give it permission to manage users**: open the client → **Service accounts
   roles** tab → **Assign role** → filter by **clients** → pick
   `realm-management` roles **view-users**, **manage-users**,
   **view-clients** and **view-realm** → **Assign**. (`view-realm` is what lets
   it look up the `admin` and `contributor` roles; without it every switch
   fails with a 403.)
4. **Copy its secret**: **Credentials** tab → **Client secret**.
5. **Give the backend the credentials** in the root `.env` (Docker) or
   `backend/.env` (running locally):

   ```bash
   KEYCLOAK_SERVICE_CLIENT_ID=learning-admin-api
   KEYCLOAK_SERVICE_CLIENT_SECRET=<the secret>
   # Only when running the backend outside Docker:
   KEYCLOAK_ADMIN_URL=http://localhost:4000
   ```

6. Recreate the backend (`docker compose up -d backend`).

Someone must have signed in to the app at least once before they can be made
an admin — until then they have no Keycloak account to give the role to. An
admin cannot remove their own access; another admin has to.
