## ADDED Requirements

### Requirement: Windows prerequisites are inventoried before mutation
The application SHALL inventory Windows architecture/build, Git, Node/npm, Pi,
pi-67, the agent directory, and runtime health before proposing installation or
repair actions.

#### Scenario: Existing compatible component
- **WHEN** a compatible component is already installed
- **THEN** the application reuses it and does not install another copy

#### Scenario: Missing component
- **WHEN** a required component is missing
- **THEN** the application presents its purpose, source, tested version, expected permissions, and exact next action before requesting confirmation

### Requirement: Each system change is separately confirmed
The application MUST require a separate confirmation for Git, Node, Pi, pi-67
manager, and pi-67 distro installation or update.

#### Scenario: User denies a prerequisite
- **WHEN** the user denies one prerequisite installation
- **THEN** the application preserves completed inventory, marks the dependency unresolved, and allows safe resume later

### Requirement: Existing Pi data is preserved
The application MUST NOT reset dirty repositories, overwrite non-git agent
directories without an explicit reviewed backup plan, or delete Pi data during
Desktop uninstall.

#### Scenario: Dirty agent repository
- **WHEN** the agent repository has uncommitted changes
- **THEN** the application reports the dirty state and does not reset or overwrite it

#### Scenario: Desktop uninstall
- **WHEN** the user uninstalls Pi-67 Desktop
- **THEN** Pi credentials, sessions, the agent directory, and workspaces remain untouched
