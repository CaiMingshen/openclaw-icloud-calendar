# openclaw-icloud-calendar

Read and write your **Apple iCloud Calendar** from **OpenClaw** over standard **CalDAV**: list calendars, read events in a time window (recurring series expanded), create events, and a delete path guarded by four gates.

> 中文: [README.md](./README.md)

**Status**: compiles, **72 tests green** (DAV reader, in-memory CalDAV fake server, real DPAPI credential round-trip). **Not yet verified end-to-end against a real iCloud account** — first run `openclaw-icloud-calendar status --probe`, then prove writes on a throwaway test calendar.

---

## Why CalDAV

Apple publishes no REST API for iCloud Calendar, and EventKit is macOS-local only. The one cross-platform automation entry point is **CalDAV (RFC 4791)**:

```
OpenClaw plugin -> HTTPS -> https://caldav.icloud.com/ -> your iCloud calendars
Auth: Apple ID (email) + app-specific password
```

So the plugin behaves the same on Windows, macOS and Linux.

---

## Install

Requires OpenClaw `>=2026.5.17` and Node `^22.19 || >=24`.

```bash
# 1) from a local checkout (dev / self-use)
openclaw plugins install /absolute/path/openclaw-icloud-calendar

# 2) straight from GitHub (the repo commits its build output dist/)
openclaw plugins install github:CaiMingshen/openclaw-icloud-calendar
```

Confirm it loaded:

```bash
openclaw plugins inspect icloud-calendar --runtime --json
```

You should see the five tools: `calendar_status`, `calendar_list_calendars`, `calendar_list_events`, `calendar_create_event`, `calendar_delete_events`.

> **Why `dist/` is committed**: it makes `github:` installs build-free, with no `prepare` script executed at install time.

---

## Configuration

| Field | Default | Purpose |
| --- | --- | --- |
| `account` | empty | Apple ID email; falls back to `ICLOUD_ACCOUNT` |
| `secretEnv` | `ICLOUD_APP_PASSWORD` | environment variable holding the app-specific password |
| `secretSource` | `auto` | `auto` \| `env` \| `store` |
| `serverUrl` | `https://caldav.icloud.com/` | CalDAV entry point |
| `allowWrites` | `true` | master switch for creating events |
| `allowDeletes` | **`false`** | master switch for deletes, off by default |
| `maxDeletesPerCall` | `1` | objects one delete call may remove |
| `maxWindowDays` | `366` | read window cap (days) |
| `maxDeleteWindowDays` | `90` | delete scan window cap (days) |
| `timeoutMs` / `retries` | `30000` / `2` | request deadline and retries |
| `proxyUrl` | empty | optional HTTP proxy |

There is deliberately **no password field**: a config file is plaintext on disk, so writing the app-specific password there would defeat the OS credential store.

`serverUrl` rule: **a remote host must be HTTPS**; only `127.0.0.1` / `::1` / `localhost` may use plain HTTP — self-hosted CalDAV (Radicale, Nextcloud, Baikal) often runs in cleartext on the same machine.

---

## Credentials

### 1. Create an app-specific password (required)

1. Sign in at <https://appleid.apple.com>
2. **Sign-In and Security -> App-Specific Passwords -> Generate** (looks like `abcd-e...mnop`)
3. **Do not use the Apple ID password** — with two-factor enabled it is always rejected (HTTP 401)

### 2. Store it (three sources; `secretSource` decides priority)

| Source | Notes |
| --- | --- |
| OS credential store | Windows -> **DPAPI** (bound to the current user); macOS -> **Keychain** (`security`); Linux -> **libsecret** (`secret-tool`) |
| Environment variable | the name in `secretEnv`, default `ICLOUD_APP_PASSWORD` |
| Neither | the error names the missing variable and the next command, never echoing the secret |

Store it in the OS credential store:

```powershell
# Windows: the password travels on stdin only, not argv, not shell history
$p = Read-Host 'app-specific password'
$p | node dist/cli.js login --account you@example.com
```

```bash
# macOS / Linux
read -rs -p 'app-specific password: ' P && printf '%s' "$P" | node dist/cli.js login --account you@example.com
```

Security boundaries:

- the secret **never** enters tool arguments, session logs, or error text;
- DPAPI plaintext goes only to a PowerShell child's stdin; on disk it is a DPAPI blob (`%LOCALAPPDATA%\openclaw-icloud-calendar`, excluded by `.gitignore` as `*.dpapi.xml`);
- Linux via `secret-tool` keeps the password on stdin; **macOS Keychain is the one exception** — `security` accepts the value only as an argument, briefly visible in argv (noted in the source).

---

## Tools (model-visible)

| Tool | Description |
| --- | --- |
| `calendar_status` | config / secret provenance / connectivity self-check; **never returns the password** |
| `calendar_list_calendars` | lists calendars (name, collection URL, colour, time zone, component types); iCloud Reminders lists show `supportsEvents=false` |
| `calendar_list_events` | reads events in a window, **expanding recurring series** and skipping cancelled instances; returns the `uid` used for deletes |
| `calendar_create_event` | creates one event; two dates = all-day (end exclusive), two offset timestamps = timed |
| `calendar_delete_events` | delete, **dry-run by default**; four gates below |

### The four delete gates (against "deleted 8 events in one call")

1. **Master switch**: `allowDeletes: false` by default — no delete path exists until it is turned on;
2. **Window required**: `start` / `end` are mandatory, and the delete window cap (90 days default) is smaller than the read cap (366 days);
3. **Named exactly**: only a `uid` (from `calendar_list_events`) or `summaryEquals` (**complete, case-sensitive title**) — substring and fuzzy matches are refused;
4. **Double confirm**: `dryRun=true` by default reports matches only; a real delete needs `dryRun=false` and `confirmCount` **equal to the number of matched objects**, capped by `maxDeletesPerCall` (default 1).

Note: when a recurring series matches, the "object count" is smaller than the "occurrence count"; deleting removes the **whole series**, and the result says so explicitly.

---

## CLI (usable without the model)

```bash
openclaw-icloud-calendar status [--probe] [--json]
openclaw-icloud-calendar login  --account you@example.com      # password read from stdin
openclaw-icloud-calendar logout --account you@example.com
openclaw-icloud-calendar calendars
openclaw-icloud-calendar events --start 2026-01-05T00:00:00+08:00 --end 2026-01-12T00:00:00+08:00
openclaw-icloud-calendar add    --summary "Review" --start 2026-01-05T09:00:00+08:00 --end 2026-01-05T10:00:00+08:00 --time-zone Asia/Shanghai
openclaw-icloud-calendar delete --start 2026-01-01T00:00:00+08:00 --end 2026-02-01T00:00:00+08:00 --uid <uid>
```

---

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run plugin:validate
```

---

## License

MIT. See [LICENSE](./LICENSE).

---

## Credits

Ported from [dsh-icloud-calendar](https://github.com/CaiMingshen/dsh-icloud-calendar) (the DeepSeek Harness build); the CalDAV client, credential store, iCalendar parsing and delete gates are kept deliberately identical.
