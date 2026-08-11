# Connect the app to Keycloak locally

1. Install Docker.
2. Run the Keycloak container:

```bash
docker run -p 127.0.0.1:4000:8080 -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin quay.io/keycloak/keycloak:26.3.3 start-dev
```

3. Open the Keycloak Admin Console at `http://localhost:4000/`
4. **Login** with username: `admin` and password: `admin`

### Create the Realm

5. **Create a new realm** (the app is configured to use `myapp`):
   - Click the dropdown in the top-left corner (currently shows "master")
   - Click **"Create Realm"**
   - **Realm name**: `myapp`
   - Click **"Create"**

### Create the Client

6. **Create a new client** (the app is configured to use `myapp-client`):
   - In the left sidebar, click **"Clients"**
   - Click **"Create client"** button
   - **Client type**: `OpenID Connect`
   - **Client ID**: `myapp-client`
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

> **Note**: The app is pre-configured to work with realm name `myapp` and client ID `myapp-client`. If you use these exact names, you won't need to modify any configuration files.

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
