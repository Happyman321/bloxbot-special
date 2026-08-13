---
name: bloxbot-client-server-security
description: Review Roblox client-server security, remotes, server validation, persistence, permissions, and exploit-prone trust boundaries. Use for security audits, anti-exploit work, RemoteEvent or RemoteFunction design, datastore safety, and suspicious client-controlled behavior.
---

# Roblox client-server security review

Default to read-only analysis. Do not modify the experience unless the user explicitly asks for fixes.

## Trust model

Treat every value originating on a client as attacker-controlled, including instance references, positions, prices, inventory claims, timing, and action order. The server owns authoritative state and decides whether an action is valid.

## Review checklist

- Inventory all RemoteEvents and RemoteFunctions, their callers, handlers, argument shapes, and return values.
- Verify type, range, ownership, state-transition, permission, distance, cooldown, and rate limits on the server.
- Ensure clients request actions rather than dictate outcomes such as currency, damage, rewards, purchases, or persistence values.
- Check that server-only modules, secrets, moderation controls, and privileged state are not replicated to clients.
- Review datastore keys, update semantics, retry behavior, session ownership, idempotency, and rollback/duplication risks.
- Look for unbounded payloads, instance injection, arbitrary asset or module loading, unsafe dynamic code, and denial-of-service paths.
- Distinguish anti-cheat signals from authorization. Detection can supplement, but never replace, server validation.

## Findings

For each finding, state the trust boundary, plausible abuse case, impact, evidence location, and minimal remediation. Rank by exploitability and impact. Avoid providing weaponized exploitation steps; use safe demonstrations or test assertions when validation is needed.
