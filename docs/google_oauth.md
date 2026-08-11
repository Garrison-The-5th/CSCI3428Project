# Google OAuth Setup with Keycloak

This guide walks through setting up Google OAuth as an Identity Provider in Keycloak, allowing users to sign in with their Google accounts.

> **Note**: If you set `VITE_ENABLE_GOOGLE_LOGIN = false` in your frontend `.env` ([see Disabling Google OAuth Login](#disabling-google-oauth-login-optional)), the Google button won't show even if you complete this setup. Make sure the flag is `true` if you want to use Google OAuth.

## Prerequisites

- Keycloak running on `http://localhost:4000`
- Google Cloud Console access
- A Google Workspace or Google Cloud project

## Step 1: Create OAuth 2.0 Client in Google Cloud Console

1. **Go to Google Cloud Console**: https://console.cloud.google.com/
2. **Navigate to**: APIs & Services → Credentials
3. **Click**: "Create Credentials" → "OAuth 2.0 Client IDs"
4. **Configure OAuth consent screen** (if not already done):
   - User Type: External (or Internal for Workspace)
   - App name, support email, and developer contact information
   - Save and continue through scopes and test users
5. **Create OAuth Client**:
   - Application type: **Web application**
   - Name: Choose a descriptive name (e.g., "Boilerplate App - Local Dev")

6. **Add Authorized JavaScript origins**:
   ```
   http://localhost:4000
   ```

7. **Add Authorized redirect URIs** (CRITICAL - must match Keycloak exactly):
   ```
   http://localhost:4000/realms/myapp/broker/oauth2/endpoint
   ```
   **Note**: Replace `myapp` with your actual realm name and `oauth2` with your identity provider alias

8. **Save and download** the credentials JSON file
9. **Note your**:
   - Client ID: `259435586420-xxxxxx.apps.googleusercontent.com`
   - Client Secret: `GOCSPX-xxxxxxxxxxxxxxxx`

## Step 2: Configure Google OAuth Identity Provider in Keycloak

1. **Open Keycloak Admin Console**: http://localhost:4000/admin
2. **Login**: `admin` / `admin` (or your admin credentials)
3. **Select your realm**: Click the realm dropdown (top-left) → Select `myapp`

### Create the Identity Provider

4. **Navigate to**: Identity providers (left sidebar)
5. **Click**: "Add provider" dropdown
6. **Select**: "Google" from the list (NOT "OpenID Connect v1.0" or generic "OAuth 2.0")

### Configure Provider Settings

#### General Settings

7. **Alias**: `oauth2`
   - **IMPORTANT**: This must match the alias in your redirect URI and in your frontend code
   - Used in: `keycloak.login({ idpHint: 'oauth2' })`

8. **Display name**: `Google`
   - This is what users see on the button ("Sign in with Google")

9. **Enabled**: Toggle **ON** (blue)

10. **Redirect URI**: Copy this exact URI - you'll need it for Google Console
    ```
    http://localhost:4000/realms/myapp/broker/oauth2/endpoint
    ```

#### OAuth2 Settings

11. **Client ID**: Paste from Google Console
    ```
    259435586420-c66g239ei6xxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
    ```

12. **Client Secret**: Paste from Google Console
    ```
    GOCSPX-6SQxzQtz-xxxxxxxxxxxxxxxxx
    ```

#### Advanced Settings

13. **Scroll down** to "Advanced settings" section

14. **Scopes**: Add the required OAuth scopes
    ```
    openid email profile
    ```
    - **openid**: Required for OpenID Connect
    - **email**: Access user's email address
    - **profile**: Access user's basic profile info (name, picture)

15. **Store tokens**: OFF (default)
16. **Stored tokens readable**: OFF (default)
17. **Trust Email**: OFF (default - can enable if you trust Google-verified emails)
18. **Account linking only**: OFF
19. **Hide on login page**: OFF (must be OFF to show the Google button)

#### User Profile Claims Mapping (Optional but Recommended)

20. **Scroll to**: "User profile claims"
21. **Verify mappings**:
    - ID Claim: `sub`
    - Username Claim: `preferred_username`
    - Email Claim: `email`
    - Name Claim: `name`
    - Given name Claim: `given_name`
    - Family name Claim: `family_name`

22. **Click**: "Save" at the bottom

## Step 3: Verify Google Cloud Console Configuration

Go back to Google Cloud Console and ensure the redirect URI matches exactly:

1. **Google Cloud Console** → **APIs & Services** → **Credentials**
2. **Click your OAuth 2.0 Client ID**
3. **Authorized redirect URIs** must include:
   ```
   http://localhost:4000/realms/myapp/broker/oauth2/endpoint
   ```
4. **Save** if you made changes
5. **Wait 5 minutes** for Google's changes to propagate (usually instant, but can take up to 5 minutes)

## Step 4: Frontend Implementation

The frontend login page includes a direct Google login button:

**Key Points**:
- `idpHint` must match the **Alias** you set in Keycloak (`oauth2`)
- This bypasses the Keycloak login screen and goes directly to Google
- Users can also click "Login with Keycloak" to see all login options

## Step 5: Testing

1. **Start your application**: `npm run dev`
2. **Navigate to**: http://localhost:5173/login
3. **You should see two buttons**:
   - "Continue with Google" (white button with Google logo)
   - "Login with Keycloak" (blue button)

### Test Google OAuth Flow

4. **Click "Continue with Google"**
5. **You should be redirected to Google's login page**
6. **Sign in with your Google account**
7. **Grant permissions** (if prompted)
8. **You should be redirected back** to your app at http://localhost:5173
9. **Check**: You should be authenticated and see protected content

### Test Keycloak Login with Google Option

10. **Logout** from the app
11. **Click "Login with Keycloak"**
12. **You should see the Keycloak login page** with:
    - Username/password fields (for local Keycloak users)
    - **"Sign in with Google"** or **"Google"** button/link
13. **Click the Google option** - same flow as above

## Configuration Summary

### Keycloak Settings (Identity Provider)
```yaml
Alias: oauth2
Display Name: Google
Enabled: ON
Client ID: <from Google Console>
Client Secret: <from Google Console>
Scopes: openid email profile
Hide on login page: OFF
```

### Google Cloud Console Settings (OAuth Client)
```yaml
Application type: Web application
Authorized JavaScript origins:
  - http://localhost:4000
Authorized redirect URIs:
  - http://localhost:4000/realms/myapp/broker/oauth2/endpoint
```
## Production Considerations

When deploying to production:

1. **Update redirect URIs** in both Keycloak and Google Console to use your production domain:
   ```
   https://yourdomain.com/realms/myapp/broker/oauth2/endpoint
   ```

2. **Update JavaScript origins**:
   ```
   https://yourdomain.com
   https://auth.yourdomain.com (if Keycloak is on subdomain)
   ```
   
3. **Review Google's OAuth policies**: https://developers.google.com/identity/protocols/oauth2

# Disabling Google OAuth Login (Optional)

By default, the login page displays a "Continue with Google" button along with the standard "Login with Keycloak" button. If you don't plan to use Google OAuth, you can easily disable it.

## How to Disable

**File to modify**: your `.env` file in frontend. See the `example.env.frontend.dev` as an example.

**Steps**:
1. Open your `frontend/.env`.
2. Set the `VITE_ENABLE_GOOGLE_LOGIN` environment variable to `false` and save the file.
   
**Result**: The Google login button and the "OR" divider will be hidden, showing only the "Login with Keycloak" button.

**To re-enable**: Simply change the flag in `.env` back to `true`

> **Note**: This is just a UI flag. If you want to fully remove Google OAuth functionality, you should also delete or disable the Identity Provider in your Keycloak Admin Console.

---