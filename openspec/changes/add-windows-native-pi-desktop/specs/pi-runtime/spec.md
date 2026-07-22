## ADDED Requirements

### Requirement: Real Pi RPC is the sole execution runtime
The application SHALL execute agent work only through the user's compatible
installed `pi --mode rpc` process and SHALL NOT embed or silently fall back to a
second Pi SDK/runtime.

#### Scenario: Start a compatible runtime
- **WHEN** the user opens a session and a compatible installed Pi is found
- **THEN** the application starts that Pi runtime in RPC mode and reports its exact version and path

#### Scenario: Runtime is incompatible
- **WHEN** the installed Pi lacks the required RPC capability
- **THEN** the application blocks agent execution and offers the tested runtime installation path without starting an embedded fallback

### Requirement: Pi session is canonical
The application SHALL treat the Pi JSONL session as canonical and SHALL keep
Desktop indexes and projections disposable and rebuildable.

#### Scenario: Rebuild Desktop state
- **WHEN** the Desktop SQLite database is missing or corrupt but the Pi session exists
- **THEN** the application rebuilds the thread projection from Pi without modifying the Pi session

#### Scenario: Sequential TUI and GUI use
- **WHEN** a Pi session is closed in TUI, resumed in Desktop, closed, and resumed in TUI
- **THEN** all accepted turns remain available in order without format translation

### Requirement: RPC framing is bounded and observable
The application MUST parse stdout as LF-delimited JSON, serialize stdin through
one bounded writer, and expose malformed frames, timeouts, exits, and
backpressure as structured failures.

#### Scenario: Unicode separator in JSON
- **WHEN** a JSON string contains U+2028 or U+2029
- **THEN** the parser keeps the character inside the frame and does not split the message

#### Scenario: Process exits during a request
- **WHEN** Pi exits before a pending request receives a response
- **THEN** the request fails with an observable process-exit error and the UI does not render success
