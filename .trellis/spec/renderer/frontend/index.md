# Renderer Development Map

## Responsibility

`apps/renderer` owns the React product UI, feature Controllers, and design-system
implementation. It runs in the sandboxed renderer process.

## Authority to load

1. `PRODUCT.md`, `DESIGN.md`, and `DESIGN.dark.md` for product and visual intent.
2. `AGENTS.md` for process, Slash action, Plan/Search, and security contracts.
3. `apps/renderer/package.json`, the nearest feature Controller/component, and
   colocated `*.test.ts` / `*.test.tsx` files.
4. `~/.codex/rules/frontend.md` and the routed `design-craft` skill for L1+
   visible UI work.

## Pre-Development Checklist

- Do not import Electron, Node, filesystem APIs, or the Pi SDK.
- Use the narrow preload bridge and validated protocol types for process I/O.
- Renderer-owned Slash actions call existing feature Controllers rather than
  sending model prompts through `command.invoke`.
- Keep transcript rendering virtualized and streaming updates batched.
- Update design authority and add targeted visible-behavior tests when UI or
  token behavior changes; browser previews do not prove packaged Electron.

## Quality Check

- Re-run targeted Controller/component tests and inspect the complete visible
  state flow, not only isolated components.
- Confirm no Electron, Node, filesystem, or Pi SDK import entered Renderer.
- For visible work, follow routed visual review and bind packaged claims to the
  exact Electron artifact.

The generated leaf files in this directory are inactive scaffolding unless a
later task replaces one with verified Renderer-specific guidance.
