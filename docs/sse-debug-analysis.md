# SSE Debug Analysis — Flutter not receiving real-time updates

## Date: 2026-05-26

## Issue
Flutter app does not update device/deployment states in real-time via SSE.
User must always click the refresh button to see updated data.

## Root Cause Analysis

### Primary Bug: Flutter SSE parser does NOT buffer partial lines across chunks

**File**: `ninbus-flutter/lib/data/sse/sse_service.dart` → `_parseSseStream()`

The `_parseSseStream` method processes each TCP chunk independently by splitting on `\n`.
When a chunk boundary falls in the middle of an SSE line, the partial line is lost.

**Example failure:**
```
Chunk 1: "id: 1\nevent: device.status\ndata: {\"deviceI"
                                            ↑ chunk ends here
Chunk 2: "d\":\"abc\"}\n\n"
```

- Chunk 1 split → ["id: 1", "event: device.status", "data: {\"deviceI"]
  - `data:` is set to `{"deviceI` (incomplete JSON)
- Chunk 2 split → ["d\":\"abc\"}", "", ""]
  - `d\":\"abc\"}` does NOT start with `data:` → IGNORED
  - Empty line triggers `_emitEvent` with `data = {"deviceI` → `jsonDecode` FAILS → event DROPPED

This happens silently — the catch block only prints to debug console.

### Secondary Bug: Dio receiveTimeout not disabled for SSE

**File**: `ninbus-flutter/lib/data/sse/sse_service.dart` → `_connectSseCompany()`

The Dio base configuration has `receiveTimeout: Duration(milliseconds: 30000)`.
The SSE request does NOT override this timeout. For some Dio adapters/platforms,
this can cause the streaming response to be terminated after 30 seconds of no new data.

The heartbeat interval is also 30 seconds — creating a race condition.

### Tertiary Bug: No `\r` stripping

Some HTTP transports (especially through proxies) may use `\r\n` line endings.
The parser doesn't strip `\r` from lines, causing `data: {...}\r` to produce
invalid JSON after `line.substring(6)`.

## Server-side Assessment

The server-side SSE implementation is **correct**:
- W3C SSE format is properly generated (`id: N\nevent: type\ndata: json\n\n`)
- Events are emitted from sync strategies, device routes, deployment routes
- Heartbeat runs every 30 seconds
- `connected` event is sent immediately on connection
- Connection cleanup is handled via `request.signal`

## Fix Plan

1. **Flutter SSE parser**: Add a line buffer to accumulate partial lines across chunks
2. **Flutter SSE request**: Override `receiveTimeout` to `Duration.zero` for SSE requests
3. **Flutter SSE parser**: Strip `\r` from all lines
4. **Server**: Add SSE debug endpoint to list active connections
5. **Create test simulation**: Node.js script to verify end-to-end SSE
