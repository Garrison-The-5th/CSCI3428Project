# Use the official Node.js image as base
FROM node:lts-bookworm-slim

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

# The static server is installed at build time, not fetched at start time.
#
# `npx serve` downloads the package on first run, and with no TTY under
# `docker compose up -d` it stalls waiting to confirm the install — the container
# reports healthy while nothing is listening. Baking it into the image makes
# startup deterministic and offline-safe.
RUN npm install --no-save serve

# Serve the production build on port 5173
EXPOSE 5173
CMD ["npx", "serve", "-s", "dist", "-l", "5173"]