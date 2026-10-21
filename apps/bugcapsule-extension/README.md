# BugCapsule local extension

Build with `node scripts/build-extension.ts`. Load the generated `artifacts/bugcapsule-extension` directory as an unpacked extension only in a separately authorized test browser. Building and configuring the extension do not start recording or grant access to a site.

## Recording scope

- Default: only the bundled synthetic origin `http://127.0.0.1:47832`.
- The popup displays the current tab's origin before recording.
- Expand the origin settings, enter one exact HTTP(S) origin per line (maximum 20), confirm the displayed scope, then save. Saving replaces the list and does not record anything. To return to the default, save only the bundled synthetic origin.
- Paths, queries, fragments, credentials, wildcard hosts, unsupported protocols and noncanonical origin strings are rejected. For example, enter `https://example.invalid`, not `https://example.invalid/`.
- Start is a separate user action on the active tab. The extension retains only the minimal activeTab/scripting/storage permissions, with no standing host permissions or background content scripts.
- Each recording is pinned to its starting origin, tab and session ID. Allowlisting two origins does not authorize one session to move between them. Navigation/reload requires a new explicit start. Delayed messages cannot revive a session stopped on navigation.
- URLs in recordings retain origin only. Paths, query and fragment are always omitted in this P0 implementation. Input values, page text, source attributes, images, canvas and iframe internals are omitted. Only masked DOM structure and coarse click targets are recorded.
- Changing the allowlist while a session is recording or paused is refused. Stop first. No auto-expansion, real-page capture, external authentication or publishing is part of this implementation/test task.

## Language

Select 日本語 or English in the popup. Controls and the recording indicator follow the selected language. Existing user-entered title, expected and actual descriptions are not translated or overwritten. Exported reports retain their exact text; machine state/reason identifiers remain stable.

## Verification boundary

`tests/bugcapsule-origins.test.ts` exercises exact-origin configuration, masking, cross-origin stop paths and tab/session binding with synthetic JSDOM pages. `tests/bugcapsule-extension-ui.test.ts` bundles sources in memory and tests the popup, indicator and worker using synthetic DOM and mocked extension APIs. These tests do not connect to the named `.invalid` sites or launch Chrome.

Real Chrome activeTab permission behavior, restricted pages, popup interaction, navigation/reload and worker suspension remain separately required browser checks. This environment's browser-launch restriction was not retried or bypassed. Passing synthetic tests is not evidence that those browser checks passed.

## Export size and descriptions

The shared uncompressed evidence-pack limit remains 50 MiB. Since each event appears in both report.json and events.jsonl, recording stops when projected duplicate event bytes plus a 256 KiB metadata/description reserve would exceed that limit. The stop reason is EXPORT_SIZE_LIMIT and the existing recording remains reviewable. Exports use compact JSON and check the exact sum of all three files, including manifest.json, before compression. Compression cannot bypass this limit. Title is limited to 200 UTF-16 code units; expected and actual descriptions are each limited to 10,000. These checks are enforced at export as well as by popup input limits.

Click recording retains its immediate masked snapshot and schedules one coalesced post-handler microtask snapshot. This captures synchronous UI structure inserted by page click handlers, without collecting text or attributes. A pending snapshot is dropped when recording is paused/stopped; asynchronous page updates after that microtask may still be absent and no complete replay is claimed.

## Retention

Default retention is 7 days from the first stored session status, not a sliding period refreshed by every event. The popup shows the expiry in UTC and provides an explicit 7–365 day setting. Saving applies the setting to future sessions and extends the current unexpired session from now, without shortening an existing later expiry. Expired sessions cannot be revived. Reads and export checks delete expired session data, revoke recording authorization, and clear stale preview data. A preview is rechecked immediately before download.

No background alarm permission is added. Expired data is deleted on next extension access; immediate deletion while Chrome/the extension is not running is not guaranteed. Exported copies are never deleted by local retention.
