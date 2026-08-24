# Fleet image-build config. The deploy workflow discovers this repo's images
# FROM the tags below (docker buildx bake --print), so they must be the real
# Docker Hub repos under tartigrade/.
# CI injects VERSION; never hardcode a version here.
variable "VERSION" { default = "latest" }

group "default" { targets = ["backend", "frontend"] }

target "backend" {
  # Root context: backend/Dockerfile's COPY paths are backend/-prefixed,
  # matching how docker-compose.yml already builds this image.
  context    = "."
  dockerfile = "backend/Dockerfile"
  tags       = ["tartigrade/learning-app-backend:${VERSION}"]
}

target "frontend" {
  # Root context: the build copies config/keycloak*.json, a sibling of
  # frontend/, and bundles it into the Vite build (see frontend/src/utils/keycloak.ts).
  context    = "."
  dockerfile = "frontend/Dockerfile"
  # Bake the PRODUCTION Keycloak config (realm learningapp on
  # auth.ttgteams.com). Local `docker compose` builds keep the dev default.
  args       = { KEYCLOAK_CONFIG = "keycloak_ttg.json" }
  tags       = ["tartigrade/learning-app-frontend:${VERSION}"]
}
