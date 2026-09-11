# Task 0013 — Docker Publishing and Image Quality

Status: `DONE`

## Objective and scope

Improve Docker image publishing quality and release infrastructure:
* Add OCI image metadata labels to both API and Web Dockerfiles.
* Implement a dedicated lightweight HTTP health check endpoint (`/healthz`) and Docker `HEALTHCHECK` for the Web service.
* Enable multi-architecture image builds (`linux/amd64` and `linux/arm64`) using Docker Buildx and QEMU.
* Automate image building and publishing to Docker Hub on PR merge into `main` and on semantic version releases (`v*`), with proper tag generation (`0.1.0`, `0.1`, `latest`, and `sha-*`).

## Requirements

* Add standard OpenContainers labels (`title`, `description`, `source`, `documentation`) to `apps/api/Dockerfile` and `apps/web/Dockerfile`.
* Add an unprivileged, unlogged `/healthz` exact-match endpoint in `apps/web/nginx.conf` and a `HEALTHCHECK` directive in `apps/web/Dockerfile` and `compose.yaml`.
* Create `.github/workflows/docker-publish.yml` with:
  * Triggers for push to `main` (when PRs merge), semver tags (`v*`), and PR validation builds (`pull_request`).
  * Explicit least-privilege permissions (`contents: read`).
  * Action pinning with full commit SHAs adhering to repository security rules (passing zizmor and trivy standards).
  * Buildx multi-arch matrix builds for `highwall777/miwifi-webui-api` and `highwall777/miwifi-webui-web` supporting `linux/amd64` and `linux/arm64`.
  * `docker/metadata-action` tag and label extraction supporting semantic releases and branch `latest`.

## Out of scope

* Application runtime business logic modifications.
* Database schema changes.
* Alternative container registries (GHCR / private registries) without explicit requirement.

## Acceptance and verification

* Both Dockerfiles declare standard OCI metadata labels.
* Web container exposes `/healthz` and executes health check successfully.
* Compose file includes health check for `web` service matching `api` service conventions.
* GitHub Actions workflow defines multi-platform publishing to Docker Hub with secrets fallback (`DOCKERHUB_USERNAME` / `highwall777` and `DOCKERHUB_TOKEN` / `DOCKER_PASSWORD`).
* No secret exposure in repository or workflow files.

## Completion record

Status: `DONE` — completed 2026-09-11.

Verification:
* Validated `apps/api/Dockerfile` and `apps/web/Dockerfile` with OCI labels and healthcheck.
* Validated `apps/web/nginx.conf` exact `/healthz` route.
* Updated `compose.yaml` and `README.md` compose references.
* Validated `.github/workflows/docker-publish.yml` action SHA pinning and permissions.
