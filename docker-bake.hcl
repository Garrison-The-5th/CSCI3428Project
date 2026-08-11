// Build recipe for the fleet reusable staging workflow
// (TTGteams/k8s-gitops/.github/workflows/reusable-deploy-staging.yml).
// docker buildx bake builds every target in parallel — no artifacts.
// VERSION is injected by CI; defaults to "latest" for local builds.
variable "VERSION" {
  default = "latest"
}

group "default" {
  targets = ["backend", "frontend"]
}

target "backend" {
  context    = "."
  dockerfile = "backend/Dockerfile"
  tags       = ["tartigrade/boilerplate-backend:${VERSION}"]
}

target "frontend" {
  context    = "."
  dockerfile = "frontend/Dockerfile"
  tags       = ["tartigrade/boilerplate-frontend:${VERSION}"]

  // The Dockerfile now defaults to the local realm so that `docker compose up`
  // produces a signed-in-able stack (§1.13). Deployed images must override it,
  // or staging and production would ship pointing at localhost:4000.
  args = {
    KEYCLOAK_CONFIG = "keycloak_ttg.json"
  }
}
