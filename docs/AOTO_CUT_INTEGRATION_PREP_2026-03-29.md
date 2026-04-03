# Aoto Cut Integration Prep

Last Updated: 2026-03-29

## Goal

Prepare Lobster Pool to integrate with the Aoto Cut content-production subdomain without rebuilding its internal product surface.

## Rule

Do not duplicate Aoto Cut's owned modules:

- industry workbench
- customer memory for content
- template extraction
- topic generation
- script and compliance
- material pool
- storyboard package
- digital human pipeline
- final asset generation
- generated material registration

Lobster Pool should consume and emit standard objects only.

## Standard Inputs To Aoto Cut

- `tenant_context`
- `industry_profile`
- `customer_profile`
- `campaign_goal`
- `approval_policy`
- `execution_policy`

## Standard Outputs From Aoto Cut

- `topic_candidates`
- `script_asset`
- `compliance_report`
- `storyboard_package`
- `material_bundle`
- `media_bundle`
- `archive_record`
- `publish_ready_package`

## Code Delivered

- Backend contract module:
  - `backend/src/subprojects/aoto-cut.types.ts`
  - `backend/src/subprojects/aoto-cut.service.ts`
  - `backend/src/subprojects/aoto-cut.controller.ts`
  - `backend/src/subprojects/aoto-cut.module.ts`

- Contract test:
  - `backend/test/run-aoto-cut-contract-tests.cjs`

## Available Endpoints

- `GET /api/v1/subprojects/aoto-cut/contract`
- `GET /api/v1/subprojects/aoto-cut/packages`
- `POST /api/v1/subprojects/aoto-cut/packages`

## Current Scope

This integration prep only does:

1. Publish the standard contract shape
2. Accept and store handoff packages
3. List stored handoff packages by tenant and package type

This prep intentionally does not do:

1. Render or rebuild Aoto Cut UI pages
2. Recreate Aoto Cut database models for content production internals
3. Replace Aoto Cut pipeline logic

## Next Safe Integration Step

When the Aoto Cut side is ready, wire its output adapter to `POST /api/v1/subprojects/aoto-cut/packages` using one of the standard output object names as `package_type`.
