# Commander and TG Integration Prep

Last Updated: 2026-03-30

## Goal

Prepare Lobster Pool to integrate with the Commander orchestration subproject and TG command terminal without rebuilding its internal orchestration layer.

## Boundary

Do not duplicate the subproject's owned implementation:

- Commander orchestration logic
- senate workflow composition
- TG command terminal flows
- model binding choices for Commander and the 9 elders
- low-cost direct strategy branch logic

The parent system should only own:

- async service entry contract
- status polling contract
- live server timeout isolation
- long-term service/runtime boundary

## Delivered in Main Repo

### AI child service

- `POST /run-dragon-team-async`
- `GET /run-dragon-team-async/{job_id}`

These endpoints wrap the existing `run_dragon_team` flow in a background job so Commander/TG can use a non-blocking entrypoint.

### Backend proxy

- `POST /api/v1/ai/run-dragon-team-async`
- `GET /api/v1/ai/run-dragon-team-async/{jobId}`

### Regression

- `dragon-senate-saas-v2/scripts/test_run_dragon_team_async_inprocess.py`
- `backend/test/run-run-dragon-async-proxy-tests.cjs`

## Integration Rule

Commander / TG should prefer async submit + status polling and avoid using synchronous `/run-dragon-team` as the primary live command path.

## Current Scope

This prep does:

1. Fast acceptance response for long-running dragon team jobs
2. Background execution using the existing graph implementation
3. Job status tracking and result retrieval

This prep intentionally does not do:

1. Rebuild Commander graph logic
2. Replace TG command terminal logic
3. Change Commander-owned prompt/model decisions
