# OpenClaw Design Language Adoption

Updated: 2026-04-14

## Why this exists

We adopted the `awesome-design-md` idea into OpenClaw, not by copying another company's visual identity, but by turning our own product style into a canonical `DESIGN.md`.

Reference source:
- [VoltAgent awesome-design-md](https://github.com/VoltAgent/awesome-design-md)

What we are borrowing:
- the `DESIGN.md` document shape
- the idea that AI agents should read one design truth source
- the separation between engineering instructions and visual instructions

What we are not borrowing:
- any single vendor's brand language as-is
- one-to-one color or typography cloning
- generic "looks modern" design drift

## New truth source

The new visual truth source is:
- [`/DESIGN.md`](/F:/openclaw-agent/DESIGN.md)

This file should be the first stop when:
- designing a new page
- refactoring a shell surface
- asking an AI agent to build UI
- reviewing whether a page still feels like OpenClaw

## OpenClaw synthesis

OpenClaw's design language is now explicitly defined as:
- a tenant growth command deck
- dark operational surfaces
- warm copper and gold for action
- cyan for signal, routing, telemetry, and live system state
- glass-like layered panels instead of flat admin cards
- command-first page hierarchy instead of commodity dashboard layout

The resulting blend is intentionally:
- warmer than a pure infra console
- more operational than a marketing site
- more supervised than a consumer AI app

## File mapping

`DESIGN.md` is descriptive. These files remain the implemented runtime anchors:

- [`web/src/app/globals.css`](/F:/openclaw-agent/web/src/app/globals.css)
- [`web/tailwind.config.ts`](/F:/openclaw-agent/web/tailwind.config.ts)
- [`web/src/components/ui/Button.tsx`](/F:/openclaw-agent/web/src/components/ui/Button.tsx)
- [`web/src/components/ui/Card.tsx`](/F:/openclaw-agent/web/src/components/ui/Card.tsx)
- [`web/src/components/operations/SurfacePrimitives.tsx`](/F:/openclaw-agent/web/src/components/operations/SurfacePrimitives.tsx)
- [`web/src/components/layout/AppSidebar.tsx`](/F:/openclaw-agent/web/src/components/layout/AppSidebar.tsx)

Information architecture still follows:
- [`docs/OPENCLAW_FRONTEND_LAYOUT_2026-04-13.md`](/F:/openclaw-agent/docs/OPENCLAW_FRONTEND_LAYOUT_2026-04-13.md)

## How to use it

For AI-assisted page work:
- tell the agent to follow `DESIGN.md`
- specify the target page archetype from the document
- call out whether the page is action-heavy, signal-heavy, or governance-heavy

For manual frontend work:
- reuse existing shell and surface primitives first
- check whether a page fits one of the existing page archetypes before inventing a new layout
- keep warm actions and cool signals in balance

## Immediate practical effect

This gives the repo something it previously lacked:
- one AI-readable design truth source
- one shared vocabulary for heroes, cards, surfaces, pills, and console layouts
- one place to review visual drift before it spreads across more pages

## Next recommended step

The next high-value step is not another document. It is to make new or refactored pages explicitly cite one of these `DESIGN.md` archetypes:
- Control Deck
- Mainline Workspace
- Entity Table
- Operations Console
- Runtime Dashboard
- Detail Drilldown
