# Bootstrap Guidelines Closeout

## Outcome

The generated full-template bootstrap was replaced by thin, package-specific
authority maps as part of
`.trellis/tasks/08-22-review-trellis-multi-agent-flow`.

- [x] Every configured package/layer index identifies its real responsibility.
- [x] Active maps point to `AGENTS.md`, package entrypoints, and colocated tests.
- [x] Inapplicable frontend/backend layers are explicitly marked inactive.
- [x] Generated leaf templates are retained only for Trellis update
  compatibility and are not loaded as project authority.

## Decision

Pi-67 does not duplicate repository rules across dozens of placeholder leaves.
Future tasks may replace an individual inactive leaf only after a verified,
package-specific convention is worth preserving. Live source, tests, Git,
runtime evidence, and repository authority documents continue to outrank
generated scaffolding.

## Identity

`bigKING67` is the developer's historical alias; `sixseven` is the canonical
assignee used for ongoing work.
