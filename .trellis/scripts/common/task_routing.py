"""Routing metadata schema enforced at the task lifecycle boundary."""

from __future__ import annotations

from collections.abc import Mapping


ROUTING_METADATA_VALUES: dict[str, frozenset[str]] = {
    "risk_level": frozenset({"L1", "L2", "high"}),
    "execution_mode": frozenset({"inline", "native", "channel"}),
    "review_mode": frozenset({"native", "channel"}),
    "handoff_mode": frozenset({"none", "relay"}),
}


def validate_routing_value(key: str, value: object) -> str | None:
    """Return an error for an invalid recognized routing value, if any."""
    allowed = ROUTING_METADATA_VALUES.get(key)
    if allowed is None or (isinstance(value, str) and value in allowed):
        return None
    expected = " | ".join(sorted(allowed))
    return f"meta.{key} must be one of: {expected}; received {value!r}"


def validate_routing_metadata(
    meta: object,
    *,
    require_complete: bool,
) -> list[str]:
    """Validate recognized routing metadata without constraining custom keys.

    Planning tasks may omit routing keys. Starting a task requires all four
    keys, so callers can fail before any pointer, status, or hook mutation.
    """
    values = meta if isinstance(meta, Mapping) else {}
    errors: list[str] = []
    for key in ROUTING_METADATA_VALUES:
        if key not in values:
            if require_complete:
                errors.append(f"meta.{key} is required before task.py start")
            continue
        error = validate_routing_value(key, values[key])
        if error:
            errors.append(error)
    return errors


def routing_remediation() -> str:
    """Return the stable repair hint for a task blocked by routing validation."""
    return (
        "Set risk_level (L1|L2|high), execution_mode (inline|native|channel), "
        "review_mode (native|channel), and handoff_mode (none|relay) with "
        "task.py set-meta before starting."
    )
