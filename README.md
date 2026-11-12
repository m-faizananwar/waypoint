# Waypoint

A request intake API where AI proposes and people decide.

Someone submits an operations request ("locked out after a password reset", "invoice charged twice"). A background worker asks an LLM to propose a category, priority and team. Nothing is applied until an approver accepts the proposal, edits it, or rejects it. Every step is recorded in an audit trail.

**Stack:** NestJS 11, TypeScript, PostgreSQL with Prisma, BullMQ on Redis, OIDC with Keycloak, Jest and Supertest, Docker Compose, GitHub Actions.

## How a request moves

```
POST /requests ──► SUBMITTED ──► (BullMQ worker) TRIAGING ──► AWAITING_APPROVAL ──► APPROVED
                                        │                            └────────────► REJECTED
                                        └── all retries fail ──► TRIAGE_FAILED ──(re-triage)──► SUBMITTED
```

| Endpoint | Who | What it does |
|---|---|---|
| `POST /requests` | requester | Submit. Needs an `Idempotency-Key` header. Returns 201 the first time, then 200 with `Idempotent-Replayed: true` on a retry. |
| `GET /requests` | anyone signed in | Requesters see their own, approvers see all. Filter with `?status=`, paginate with `?limit=&offset=`. |
| `GET /requests/:id` | owner or approver | The request with its full audit trail. Other users get 404, so ids can't be probed. |
| `POST /requests/:id/approve` | approver | Applies the proposal. Any field can be overridden, and overrides are recorded. |
| `POST /requests/:id/reject` | approver | Needs a note. |
| `POST /requests/:id/retriage` | approver | Puts a failed or stuck request back on the queue. |
| `GET /health` | public | Checks the database and Redis. |

## Design decisions

**The model can only propose.** LLM output is parsed against a strict Zod schema with fixed sets of categories, priorities and teams. Unknown keys are rejected, so a model can't set `status` or any other field. The request text goes to the model as untrusted data, and the prompt says so.

**Bad output gets one repair, then a fallback.** If the response fails validation, the validation errors go back to the model once. If that fails too, or the API is down or slow, triage falls back to a deterministic rules model. Triage gets worse instead of stopping. The record keeps which model answered (`proposalModel`). Low-confidence proposals are flagged with `needsReview`.

**Separation of duties.** Roles come from the OIDC token (`requester`, `approver`). An approver can't decide on their own request, and requesters can't see other people's.

**Safe under concurrency.** Every state change is a conditional `UPDATE ... WHERE status = <expected>`. When two approvers act at once, exactly one wins and the other gets a 409. The same pattern stops two workers from triaging one request. Idempotent submission is backed by a unique index on `(requesterId, idempotencyKey)`, so five simultaneous retries create one row. A reused key with a different body is a 409, not a silent overwrite.

**History and state can't disagree.** Each audit event is written in the same transaction as the state change it describes. Each triage attempt, retries included, gets its own event.

**Jobs survive failure.** Triage jobs retry three times with exponential backoff. The job id is the request id, so enqueueing twice does nothing. If Redis is down at submit time, the request is still saved as `SUBMITTED` and can be re-triaged later. After the last failed attempt the request moves to `TRIAGE_FAILED`, so nothing waits silently.

**OIDC done properly.** Tokens are verified against the provider's JWKS (cached and rate limited, so key rotation needs no restart), with issuer, audience, expiry and RS256 all checked. It works with Keycloak locally and any OIDC provider, such as Entra ID, in production.

**Configuration fails fast.** Environment variables are validated with Zod at boot, and every problem is listed at once.

## Run it

```bash
docker compose up -d postgres redis keycloak
cp .env.example .env
npm install
npx prisma migrate deploy
npm run start:dev
```

Get a token for a demo user and submit a request. The demo users exist only in the local Keycloak realm: `alice` is a requester, and `bob` is a requester and an approver.

```bash
TOKEN=$(curl -s -X POST localhost:8080/realms/waypoint/protocol/openid-connect/token \
  -d grant_type=password -d client_id=waypoint-web -d username=alice -d password=alice-local-dev | jq -r .access_token)

curl -X POST localhost:3000/requests -H "authorization: Bearer $TOKEN" \
  -H "idempotency-key: $(uuidgen)" -H 'content-type: application/json' \
  -d '{"title":"Locked out after password reset","body":"MFA never sends a code"}'
```

Without `LLM_API_KEY` the worker uses the rules model, so everything runs offline. Set `LLM_API_KEY` (plus `LLM_BASE_URL` and `LLM_MODEL`) to use any OpenAI-compatible endpoint.

To run the whole stack in containers, use `docker compose --profile app up --build`.

## Tests

```bash
npm test            # unit: schema parsing, repair and fallback, rules model, roles, config
npm run test:e2e    # end to end against real Postgres and Redis
```

The end-to-end suite runs the real app and the real token verification. A small in-process OIDC fixture serves a JWKS and signs tokens, and only the LLM is replaced with a fake. It covers:
- forged, expired and wrong-audience tokens
- role checks
- idempotent replays and concurrent duplicates
- background triage and LLM fallback
- overrides and the audit trail
- self-approval
- a race between two approvers
- retries ending in `TRIAGE_FAILED`

CI runs the typecheck, both suites and a Docker build on every push.

## Project layout

```
src/
  auth/       OIDC JWT strategy, global auth and role guards, decorators
  requests/   controller, service (state machine, idempotency), DTOs
  triage/     proposal schema, LLM and rules models, fallback service, BullMQ worker
  audit/      transactional audit helper
  health/     database and Redis health check
  config/     environment validation, Redis options
prisma/       schema and migrations
keycloak/     realm with roles, clients and demo users for local development
test/         e2e suite and OIDC fixture
```
