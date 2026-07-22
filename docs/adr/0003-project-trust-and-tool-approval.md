# ADR 0003: Project trust and tool approval are independent

- Status: Accepted
- Date: 2026-07-22

## Decision

Project trust controls loading project-local Pi resources. One-shot tool
approval controls a sensitive action. Installing Git, Node, Pi, the pi-67
manager, and the pi-67 distro are five separately confirmed bootstrap steps.

The Desktop safety extension activates only when `PI67_DESKTOP=1` and is
explicitly loaded by a Desktop RPC launch. It fails closed when no GUI response
is available.

## Consequences

Trusting a project is not a sandbox bypass. Denying one action does not mutate
project trust, and trust does not silently approve destructive, external, or
system actions.
