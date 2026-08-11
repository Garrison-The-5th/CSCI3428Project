# Content Management System (CMS)

## Overview
Role-based access control separating admin and user capabilities, and how to create an
admin user in Keycloak to test it.

## Setup & Testing

### Creating an Admin User in Keycloak

To test the admin features, you need to create a user and assign the "admin" role:

#### Step 1: Access Keycloak Admin Console
1. Navigate to your Keycloak admin console
2. Log in with your admin credentials
3. Select your realm

#### Step 2: Create Admin Role
1. Go to **Clients** and select the **Roles** tab
2. Click on **Create role**
3. Specify the **Role name** as **admin** and save

#### Step 3: Create a New User
1. Go to **Users** in the left sidebar
2. Click **Add user** button
3. Fill in the required fields:
   - **Username**: Enter the username (e.g., `admin-user`)
   - **Email**: Enter a valid email address
   - **First Name** / **Last Name**: Optional but recommended
4. Click **Create**

#### Step 4: Set User Password
1. After creating the user, go to the **Credentials** tab
2. Click **Set Password**
3. Enter a password and confirm it
4. Toggle **Temporary** to OFF (to avoid forced password reset)
5. Click **Save**


#### Step 5: Assign Admin Role
1. Navigate to the user you want to assign the role to and click on the **Role Mappings** tab
2. Under **Assign role**, select **Client roles**
3. In **Available Roles**, find and select **admin**
4. Click **Assign** to assign the role
5. Verify that **admin** appears in **Assigned Roles**

#### Step 6: Test the Admin Access
1. Log in to your application with the new admin user
2. You should see the admin navigation menu with:
   - Admin Dashboard
   - Users
3. Navigate to `/admin/users` to confirm admin-only routes are reachable


## Key Features

### 1. Role-Based Access Control
- **Backend**: JWT token processing to extract user roles from Keycloak
- **Frontend**: Implemented role-based routing with admin and user separation
- **Routes Protection**: Added `isAdmin` prop to `ProtectedRoute` component for granular access control

### 2. Enhanced Authentication Middleware
- **File**: `/backend/src/controllers/authController/authMiddleware.ts`
- **Improvements**:
  - Extracts roles array from JWT token (`resource_access[clientId].roles`)
  - Defaults to "user" role if no roles are assigned
  - Passes role to `AuthService.getOrCreateUser()` for database synchronization
  - Type-safe role handling

### 3. Navigation Updates
- **Dynamic Navbar**: Renders different menu items based on user role (admin vs. user)
- **Admin Routes**:
  - `/admin` - Admin Dashboard
  - `/admin/users` - User Management
- **User Routes**:
  - `/` - Home
  - `/profile` - User Profile
  - `/contact` - Contact Us

### 4. Route Protection Enhancements
- **Cross-Access Prevention**: Admins and regular users cannot access each other's routes
- **Unauthorized Page**: Redirects to `/unauthorized` when access is denied
- **Exact Path Matching**: Added `end` prop to `NavLink` to prevent multiple active menu items


## Files Modified

### Frontend
- `src/App.tsx` - Added role-based routing
- `src/components/ProtectedRoute.tsx` - Enhanced with admin access control
- `src/components/Navbar/Navbar.tsx` - Added `end` prop for exact matching
- `src/utils/getNavbarData.tsx` - Dynamic navigation based on roles

### Backend
- `src/controllers/authController/authMiddleware.ts` - Role extraction from JWT
- `src/services/authService/authService.ts` - Role handling in user operations


## Troubleshooting

### Issue: User doesn't have admin access after role assignment
**Solution**: 
- Clear browser cache and cookies
- Log out and log back in
- Verify the role is assigned in Keycloak under **Users → [Username] → Role Mappings → Client Roles**
- Check that the client ID in your environment variables matches the one in Keycloak

### Issue: Getting "Unauthorized" error when accessing admin routes
**Solution**:
- Ensure the JWT token contains the correct `resource_access[clientId].roles` structure
- Verify `PUBLICKEY` environment variable is correctly configured in backend
- Check browser console for JWT decoding errors
- Confirm the user has the "admin" role in the correct client

### Issue: Both admin and user menu items are showing
**Solution**:
- Ensure the `end` prop is added to `NavLink` components in `Navbar.tsx`
- Clear React state by refreshing the page
- Verify that `isAdmin` is correctly calculated from `keycloak.hasResourceRole('admin')`
