# Group Composer models by Provider

## Goal

Make the compact Composer model picker faster to scan as configured model
catalogs grow, while preserving Pi's Provider ownership and the current model
selection contract.

## Background

- The current open picker is one flat, internally scrolling model list. Each
  row exposes the readable model name and complete `provider/model-id`, but
  Provider boundaries are only inferable from repeated row details.
- The Session projection already exposes both model Provider IDs and the
  ordered Provider catalog. The renderer must use those authoritative
  identities rather than infer a vendor from a model name.
- The user-approved direction is a grouped picker, not a new Provider registry
  or a change to which models are available.

## Requirements

- Render the currently visible models in non-collapsible Provider sections.
- Use each model's exact `provider` identity for membership and the projected
  Provider label for the section heading. Fall back to the Provider ID only if
  the matching projected Provider is unavailable.
- Keep mixed-protocol Providers intact. In particular, Groland Claude and GPT
  models remain in one `Groland` section rather than being regrouped by model
  vendor.
- Keep Provider section order stable by following the projected Provider
  catalog order. Preserve the runtime model order within each section; do not
  move the selected Provider to the top.
- Show the visible model count in each Provider heading and keep the heading
  legible while its rows scroll through the bounded Popover.
- Preserve every existing model-row behavior: readable label, complete
  `provider/model-id`, selected check, unavailable-authentication detail,
  pending/disabled state, selection callback, and compact trigger label.
- Opening the picker must reveal the current selected row without making
  section headings selectable or disrupting arrow-key, typeahead, Enter, and
  Escape behavior.
- Preserve the current visibility rule: configured models are selectable, and
  an already-selected unconfigured model remains visible for truthful recovery.
- Follow the existing Composer Popover tokens, density, focus treatment,
  viewport collision handling, and dark/light theme semantics.
- Update the current design authority and add targeted behavior/accessibility
  regression coverage for the grouped structure.

## Out of Scope

- Search input, Provider filters, recently used models, favorites, or
  collapsible Provider sections.
- Backend, protocol, Pi Session, Provider credential, model availability, or
  native-search changes.
- Hardcoding or registering `deepseek-v4-flash-vision-exp` inside Pi-67. That
  model remains dependent on a formally released Pi SDK catalog update.

## Acceptance Criteria

- [x] A multi-Provider catalog renders one labeled, counted section per actual
  Provider, with every visible model appearing exactly once.
- [x] A mixed Groland fixture keeps its Claude and GPT models in one Groland
  section, and duplicate model labels remain disambiguated by the complete
  `provider/model-id` detail.
- [x] Provider and model ordering is deterministic and does not change merely
  because the user selects a different model.
- [x] The selected model remains checked and is revealed when the Popover
  opens; mouse and keyboard selection still call the existing model-selection
  Controller exactly once.
- [x] Empty, selected-unconfigured, pending, disabled, long-label, and bounded
  overflow behavior remain truthful and usable.
- [x] Group headings are non-selectable and exposed with appropriate list
  section semantics; focus-visible and dark/light styling remain consistent
  with sibling Composer controls.
- [x] Targeted renderer tests, renderer type-check/lint/build gates, and the
  routed final visual consistency review pass.
- [x] After relevant gates pass, the unsigned macOS arm64 packaged preview is
  rebuilt, smoked, and opened from the repository artifact for manual review.

## Notes

- This is a lightweight L1 visible component change and remains PRD-only.
- Baseline visual evidence is the user-supplied packaged-app screenshot at
  796x756, SHA-256
  `4f00f3b65e10e2997775a0d934191802e62e969ace9489d6a7ddd56a97d1167f`.
