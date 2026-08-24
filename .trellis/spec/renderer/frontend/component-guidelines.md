# Component Guidelines

> How components are built in this project.

---

## Overview

<!--
Document your project's component conventions here.

Questions to answer:
- What component patterns do you use?
- How are props defined?
- How do you handle composition?
- What accessibility standards apply?
-->

(To be filled by the team)

---

## Component Structure

<!-- Standard structure of a component file -->

(To be filled by the team)

---

## Props Conventions

<!-- How props should be defined and typed -->

(To be filled by the team)

---

## Styling Patterns

<!-- How styles are applied (CSS modules, styled-components, Tailwind, etc.) -->

(To be filled by the team)

---

## Accessibility

<!-- A11y requirements and patterns -->

(To be filled by the team)

### Grouped Listbox Sections

- Build grouped choices with React Aria `ListBoxSection` and `Header`; do not
  model section headings as disabled options. Headings must stay outside the
  arrow-key, typeahead, Enter, and selected-option sequence.
- Derive group membership from the authoritative projected identity rather
  than display labels. Preserve the source group order and source option order
  so selection does not silently reorder the catalog.
- Keep the complete stable option identity in row detail when readable labels
  can collide. Opening the Popover must still reveal and focus the selected
  option, including a selected recovery option that is no longer configured.
- Cover section semantics, empty recovery rendering, keyboard traversal, and
  exactly-once selection dispatch in targeted tests. Verify the same tokenized
  section treatment in light and dark themes.

---

## Common Mistakes

<!-- Component-related mistakes your team has made -->

(To be filled by the team)
