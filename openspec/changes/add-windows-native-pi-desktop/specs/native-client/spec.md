## ADDED Requirements

### Requirement: The client uses native Windows UI
The application SHALL implement its product UI with WinUI 3 and SHALL NOT use
Electron, WebView2, or a cross-platform web/custom-rendered UI framework.

#### Scenario: Render transcript content
- **WHEN** a Pi message contains supported Markdown and code blocks
- **THEN** the application parses it to an internal AST and renders native accessible WinUI elements without executing HTML

### Requirement: Sensitive actions use one-shot approval
The application MUST require a one-shot user decision before workspace-external
access, destructive shell operations, dependency changes, external Git actions,
system changes, downloads followed by execution, or ambiguous compound commands.

#### Scenario: User denies a tool call
- **WHEN** the user selects Deny
- **THEN** the Desktop safety extension returns an official blocked tool result to Pi and the session remains usable

### Requirement: Project trust and tool approval are separate
The application SHALL use Pi's project trust store for project resources and
SHALL explain that trust is not a sandbox or tool approval.

#### Scenario: Project requires trust
- **WHEN** a workspace contains trust-requiring Pi resources
- **THEN** the user can trust once, trust and persist, or deny before those resources load

### Requirement: Accessibility and language parity are release gates
The application SHALL support keyboard operation, UI Automation, High Contrast,
Reduced Motion, 200% scaling, Chinese-default resources, and English parity for
core flows.

#### Scenario: Keyboard approval flow
- **WHEN** a keyboard-only user opens and resolves an approval dialog
- **THEN** focus order is logical and focus returns to the invoking surface after the dialog closes
