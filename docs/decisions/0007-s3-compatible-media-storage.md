# ADR-0007: S3-compatible object storage abstraction, MinIO for local dev

## Status
Accepted

## Context
The platform needs object/media storage for product images, assets,
and potentially generated exports/reports. It must run fully locally
(remote-first/local-first requirement) while remaining portable to
whatever cloud object storage is chosen for production later
(decision deferred — see `DEPLOYMENT.md` §4).

## Decision
Access object storage only through an **S3-compatible abstraction
layer**; use **MinIO** as the local-development S3-compatible backend.
Production backend (AWS S3, or another S3-compatible provider) is
decided later but must work through the same abstraction without code
changes to calling services.

## Reasoning
- The S3 API is a de facto standard with many compatible
  implementations, so coding against that abstraction rather than a
  specific vendor SDK preserves portability.
- MinIO is self-hostable, Docker-Compose-friendly (ADR-0009), and
  S3-API-compatible, making local development a faithful stand-in for
  production object storage.

## Consequences
- No application code should call a cloud-specific storage API
  directly; all access goes through the shared abstraction.
- Production object storage choice remains an open `DECISION_REQUIRED`
  (see `DEPLOYMENT.md` §4) and does not block local development.
