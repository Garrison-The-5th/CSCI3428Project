# ---- Build stage ----
FROM node:24-slim AS build

# Set working directory for the frontend inside the container
WORKDIR /usr/src/frontend

# Copy config folder with keycloak.json from root (needed for build)
COPY config/ ../config/

# Which Keycloak client config to bake in.
#
# Defaults to the local realm so that a plain `docker compose up` produces a
# stack somebody can actually sign in to (§1.13, "fully testable locally using
# the containerized environment"). Previously the prod config was copied
# unconditionally, so the only image the compose file could build pointed at the
# production identity provider and was unusable locally.
#
# The deploy pipeline passes --build-arg KEYCLOAK_CONFIG=keycloak_ttg.json.
#
# The guard matters: with the default the source and destination are the same
# file, and `cp x x` fails rather than being a no-op, which broke the build.
ARG KEYCLOAK_CONFIG=keycloak.json
RUN if [ "${KEYCLOAK_CONFIG}" != "keycloak.json" ]; then \
      cp "../config/${KEYCLOAK_CONFIG}" ../config/keycloak.json; \
    fi

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
