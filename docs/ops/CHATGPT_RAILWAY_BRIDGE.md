# ChatGPT → GitHub → Railway staging bridge

## Safety status (2026-09-22)

**BLOCKED pending an isolated staging environment.** On 2026-09-22 the
connected Railway project exposed a single environment, named `production`.
The existing `.github/workflows/staging-discovery-ops.yml` had hard-coded
that production environment and its backend service as the supposed staging
target. A `KOMERCE_ENV=staging` process variable is **not** evidence of database
or deployment isolation. Do not run `discovery-seed` or `discovery-check`
against those production IDs.

The staging workflow now fails closed *before database access* when target
IDs are absent or equal to the verified production IDs. Configure a separately
provisioned staging environment/service and a **separate staging database**,
then provide repository variables
`KOMERCE_STAGING_RAILWAY_ENVIRONMENT_ID` and
`KOMERCE_STAGING_RAILWAY_SERVICE_ID`, and secrets
`RAILWAY_STAGING_TOKEN` and `RAILWAY_STAGING_DATABASE_URL`.
Verify that the database URL really belongs to the isolated staging
database before running any seed; variable names alone do not establish
isolation. Do not copy production credentials or reference production
Postgres into staging.

The workflow's authorized commands are `railway-check` (scoped token
verification), `discovery-check` (staging database read/check), and
`discovery-seed` (staging-only seed plus bounded Railway variable update).
The old documentation mentioned `discovery-modal-v2-seed`, but that option
is not enabled in the current workflow. No command in this bridge takes
a screenshot or proves a real desktop/mobile interaction.

## Historical context

The owner-issued bridge used GitHub issue commands such as
`[staging-op] railway-check` and the workflow
`.github/workflows/staging-discovery-ops.yml`. A check performed on
2026-09-03 established access to a project token **at that time**; it
did not establish a separate staging target as of 2026-09-22.

## Required visual acceptance for Discovery

After a separate staging environment is configured, use a browser to
inspect **actual rendered** cards and details on desktop and mobile:
service and local physical offer must show the correct media, provider,
zone and description. A service has exactly one contact action and never
a product buybox or checkout; confirm the inquiry flow on a synthetic
test recipient only. Do not activate the local rail in production on the
basis of unit tests, merged PRs or a seed alone. Real partner identities,
media rights and availability require independent validation.
