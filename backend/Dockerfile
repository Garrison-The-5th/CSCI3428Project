# Use the official Node.js image as base
FROM node:lts-bookworm-slim

# Install OpenSSL
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Set working directory for the backend inside the container
WORKDIR /usr/src/backend

# Install dependencies
COPY backend/package*.json ./ 
RUN npm install

# Copy all backend code
COPY backend/ .

# Build your app
RUN npm run build

# Copy generated Prisma client to build output
RUN cp -r generated build/

# Expose the port your app runs on
EXPOSE 5002

# Apply any pending migrations, then start.
#
# `npm run dev` chains db:setup, so a local run has always been migrated before
# it boots. Nothing did that here, which meant every schema change needed someone
# to remember a manual step — and forgetting it starts the app against a database
# that does not match the code it was built from.
#
# `migrate deploy` only applies migrations already committed to the repo: it never
# generates one, never prompts, and does nothing when there is nothing pending, so
# it is safe on every restart. A failure here stops the container rather than
# letting it serve against the wrong schema.
CMD npx prisma migrate deploy --config prisma/prisma.config.ts && node build/src/index.js
