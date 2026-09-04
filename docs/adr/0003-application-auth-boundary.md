# ADR 0003 — Application Authentication Boundary

Status: `ACCEPTED`

Date: `2026-09-04`

## Context

The Xiaomi router itself has administrative authentication.

However, `miwifi-webui` is a separate application that stores:

* historical data;
* device information;
* audit records;
* router credentials;
* AI investigation information.

Using the Xiaomi router password directly as the application's user authentication would tightly couple two security domains and would make future authorization/session behavior difficult to control.

v1 is expected to begin with a single human administrator.

## Decision

`miwifi-webui` has its own application authentication boundary.

The application administrator account is separate from the Xiaomi router administrator credential.

v1 will begin as a single-user application but use a normal user/session architecture rather than skipping authentication.

Expected initial direction:

* first-run bootstrap administrator;
* no public signup;
* Argon2id application password hashing;
* server-side sessions;
* HttpOnly cookies;
* session revocation;
* CSRF/origin protection for state-changing application requests.

Router credentials are managed separately and encrypted at rest.

## Rationale

Separating identities:

* prevents reuse/exposure of router credentials;
* lets the application independently revoke sessions;
* supports audit attribution;
* allows future multi-user roles;
* allows password changes without altering router authentication;
* keeps router-session lifecycle invisible to the UI.

## Consequences

### Positive

* clean security separation;
* future user-management path;
* application sessions can be secured independently;
* router passwords do not become frontend login credentials;
* audit records have an application actor.

### Negative

* users initially manage two credentials:

  * application password;
  * router password.
* local recovery must be provided;
* session persistence/security must be implemented.

## Bootstrap direction

The first application administrator must be created through an explicit bootstrap flow.

For v1, bootstrap must be restricted to localhost.

The bootstrap path must permanently stop accepting initial-account creation after the first administrator has been successfully created.

A future trusted setup mechanism may replace the localhost restriction only through an explicit reviewed architecture/security decision.

## Password recovery

v1 does not need email infrastructure.

Recovery should use an explicit local administrative process such as a container/CLI command rather than public password-reset email.

## Alternatives considered

### Use Xiaomi router password as application login

Rejected.

This mixes unrelated security boundaries and exposes router credentials more broadly.

### No authentication because application is LAN-only

Rejected.

LAN location is not sufficient authorization for access to network administration/history data.

### Full multi-user/RBAC immediately

Deferred.

The initial product does not require the implementation complexity, but the authentication architecture should not prevent later extension.

## Revisit when

Reconsider the single-user limitation when multi-user administration becomes a confirmed product requirement.

The separation between application identity and router identity should remain unless there is an exceptionally strong reason to change it.
