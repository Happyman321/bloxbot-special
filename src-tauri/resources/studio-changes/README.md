# Studio change capture

BloxBot launches `proxy.mjs` in front of Roblox's native Studio MCP executable.
The legacy bundled Studio plugin is not involved. The proxy forwards the native
tool catalogue and calls; before/after capture happens automatically around tools
which can edit the DataModel. Read-only tools and play controls bypass capture.

`snapshot.luau` reads editable properties through Roblox's ReflectionService,
script editor source, instance paths/classes, attributes, and tags. Weak instance
identities preserve renames and distinguish objects with identical names. Each
Studio has its own capture scope. All calls on this connection are serialized so
an edit or Studio selection cannot interleave another capture on the connection.

Only changed objects leave Studio. Results are transferred in hex-encoded chunks
to preserve Unicode and avoid native tool-output truncation. Snapshots are saved
to the OS local data directory under `BloxBot/changes/<uuid>.json`. Tool output
contains a short `[BloxBot capture: <uuid>]` reference; source snapshots do not
inflate the model's context. Failed tools retain a reference too, so partial edits
remain reviewable. Capture failures never cause a mutation to be retried.

The frontend groups assistant messages by user request (including `parentID`),
loads referenced snapshots, and compares each object's first before-state with
its final after-state. Restored edits and create-then-delete operations disappear.
The latest request is selected by default, with older requests in the dropdown.
Intermediate results stay hidden while the request is busy or retrying. Local
file diffs are loaded separately from the request's OpenCode summary.

## Coverage and limits

- Captures cover the editable game services listed in `snapshot.luau`. Inaccessible
  properties, Studio camera state, binary asset contents, terrain voxels, and
  playtest runtime changes are not captured. Referenced asset IDs and normal
  instance properties are captured.
- The native `execute_luau` environment must support `shared` across calls and
  ReflectionService. A lost baseline or unsupported environment produces a visible
  capture warning instead of a fabricated empty diff.
- Snapshots compare state around each tool. Concurrent manual edits, edits from
  another MCP connection, and work scheduled after a tool returns cannot be
  reliably attributed to this request. Avoid concurrent editors while reviewing.
- Capture is bounded at 30,000 instances, 32 MB of changed data, and a 30-second
  timeout per internal capture call. A boundary failure is shown in Changes.
- Historical requests without saved snapshots cannot reconstruct their original
  Studio state. OpenCode child sessions retain their own request history.

## Verification

`pnpm test` includes real-shaped message/patch fixtures, request lifecycle tests,
line alignment tests, capture persistence/failure tests, and a spawned proxy/native
MCP protocol fixture. `cargo test changes::tests` checks capture path validation.

For the live Studio check: open a small disposable place, connect BloxBot, and ask
it to change a Part's Color and update a Script twice. After completion, Changes
should show one object property comparison and one original-to-final script diff.
Next ask it to restore the script within the same request; that script should have
no net change. Switch requests, reopen the chat, and verify saved snapshots remain
available. Also check a renamed object, an empty added script, a deletion, and an
operation that changes an object before raising an error.

API reference: https://create.roblox.com/docs/reference/engine/classes/ReflectionService
