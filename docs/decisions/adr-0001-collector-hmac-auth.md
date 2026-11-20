# ADR-0001 — Collector API authentication (v1, frozen)

## Status
Accepted (frozen v1, 2026-11-18).

## Context
novr-collection is a stateless collector service. Pulse calls it over HTTP to
trigger collection and page results. The boundary must be authenticated and
replay-resistant, and both sides must sign byte-identically.

## Decision
Callers authenticate with HMAC-SHA256 over a canonical string:

  METHOD \n PATH \n CANONICAL_QUERY \n X-Consumer-Id \n X-Key-Id \n X-Date \n X-Nonce \n X-Content-SHA256

- Headers: X-Consumer-Id, X-Key-Id, X-Date, X-Nonce, X-Content-SHA256, X-Signature.
- Signature: base64url(HMAC-SHA256(secret, canonicalString)). NO version prefix.
- Query canonicalisation: percent-decode then encodeURIComponent; sorted by key then value;
  a literal '+' is preserved (NOT treated as space) — callers MUST send spaces as %20.
- Identity = X-Consumer-Id (stable) + X-Key-Id (rotatable) => per-consumer scoping and
  zero-downtime key rotation.
- Replay: single-use nonce per TTL (default 10 min, process-local; a shared store is required
  before horizontal scaling). Clock skew bounded to ±300 s.
- Contract version: the X-Novr-Contract: 1 response header and the `contract` field on /readyz.
- All authentication failures return a single public 401 { error: { code: 'UNAUTHENTICATED' } };
  the failing precondition is recorded only in server logs, so the API is not an oracle.

## Consequences
- Positive: strong request integrity, replay resistance, per-consumer scoping, rotation.
- Negative: a process-local nonce store limits replay protection to a single instance until a
  shared store is added; signers must match the canonicalisation exactly (the '+/%20' rule is
  the known trap).

## Superseded
This supersedes an earlier Phase-0 draft (X-Novr-Key-Id / X-Novr-Signature: v1= / RFC-3986
query / collect:* scopes / SIGNATURE_INVALID), which was replaced by the implemented scheme.
