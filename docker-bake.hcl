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
  # Root context, matching docker-compose.yml. No Keycloak settings are baked
  # in: the realm and client come from the backend at runtime (GET /auth-config),
  # so staging and production run the same image.
  context    = "."
  dockerfile = "frontend/Dockerfile"
  tags       = ["tartigrade/learning-app-frontend:${VERSION}"]
}
