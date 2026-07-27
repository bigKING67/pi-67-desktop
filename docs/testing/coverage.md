# Coverage gates

`corepack pnpm run check` runs the Vitest suite with V8 coverage and enforces
package-specific branch floors. Coverage is a regression gate, not a substitute
for Electron, packaged runtime, or native-platform evidence.

## Inventory boundary

The unit-coverage inventory is explicit so an unimported production module does
not disappear from the denominator:

- every TypeScript module under `packages/*/src`;
- testable Agent Host and Electron Main modules;
- Renderer `.ts` state, protocol, projection, and presentation logic.

Side-effect bootstrap modules (`main`, `preload`, process entrypoints) and React
`.tsx` surfaces are excluded from the unit metric. Their behavior is exercised
through Playwright renderer tests, real Electron E2E, and packaged smoke tests.
This keeps unlike evidence types separate instead of reporting UI files as
meaningless zero-coverage unit modules.

## Enforced branch floors

| Scope | Current floor | Long-term target |
| --- | ---: | ---: |
| Global unit inventory | 70% | 80% |
| `packages/domain` | 90% | 90% or higher |
| `packages/protocol` | 80% | 90% |
| `packages/extension-compat` | 85% | 90% |
| `packages/pi-runtime` | 75% | 80% |
| `apps/agent-host` testable modules | 74% | 80% |
| `apps/desktop` testable modules | 80% | 80% or higher |
| `apps/renderer` `.ts` logic | 55% | 75% |

The floors intentionally match the first verified baseline closely enough to
stop regressions. They must only move upward. New branches in a governed scope
need tests or an explicit evidence-boundary decision; lowering a threshold to
make CI green is not an accepted fix.

Run the gate directly with:

```bash
corepack pnpm run test:coverage
```

The generated `coverage/` directory is local evidence and is not committed.
