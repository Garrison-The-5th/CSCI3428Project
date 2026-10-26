# ---- Build stage ----
FROM node:24-slim AS build

# Set working directory for the frontend inside the container
WORKDIR /usr/src/frontend

# No Keycloak settings are baked in: the app reads its realm and client from the
# backend at start-up (GET /auth-config), so this one image serves every
# environment and the environment's settings (Infisical in k8s) choose the realm.

# Copy frontend package.json and package-lock.json to container
COPY frontend/package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the frontend application code
COPY frontend/ .

# Build the React app with Vite
RUN npm run build

# ---- Serve stage ----
# Fleet pattern for static frontends: multi-stage build served by nginx,
# rather than a Node process running a dev server or `npx serve`.
FROM nginx:alpine

COPY --from=build /usr/src/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Replace the entrypoint to bypass nginx config modification scripts
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]

EXPOSE 80
