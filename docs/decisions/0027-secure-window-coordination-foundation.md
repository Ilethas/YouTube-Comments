# ADR 0027: Secure window coordination foundation (M1)

Status: accepted and implemented, 2026-10-17. Scope: M1 only; schema remains 12.

## Context

The multi-window audit found that one mutable mainWindow reference supplied both
IPC authority and native dialog parents. A second window would overwrite that
authority, and asynchronous commands could use an unrelated parent. The owner
requested a production foundation while keeping exactly one normal reader window.
The broader MULTI_WINDOW_DESIGN remains a proposal except for this scoped decision
and the provisional dragging policy below. Historical M0/M0.5 evidence is intact.

## Decision

`WindowCoordinator` owns runtime registration and document leases. The sole
`createApplicationWindow` factory fixes preload, sandbox, context isolation,
disabled Node integration and enabled web security. It denies window.open,
renderer frame navigation and redirects before any trusted document loads.
Coordinator listeners register before loading the exact main-computed application
URL (file URL in built output, exact Vite URL in development).

Registration generates an opaque runtime windowId; it grants no IPC authority by
itself. An exact trusted top-level `did-frame-navigate` commit issues a fresh opaque
rendererLease and captures its WebFrameMain. Main-frame navigation start, in-page
navigation, renderer process loss and native close revoke the lease. Closed or
destroyed windows unregister and release listeners. A failed navigation stays
unauthorized until another full trusted commit. A prevented native close stays
revoked until main explicitly re-registers and reloads that window; current production
has no such close preflight. Asynchronous close/preflight leases are M3. Subframe events cannot
replace a top-level lease. Reload retains windowId and replaces the rendererLease;
explicit unregister/re-registration replaces both and detaches the old listeners.

Every reader channel is registered once at app startup, independently of window
creation. The guard requires the exact registered live WebContents, a current
lease, the captured frame equal to current mainFrame and event.senderFrame, a
non-destroyed/non-detached frame, and the exact expected document URL. Electron
objects throwing during destruction fail closed. Loading the right URL in an
unregistered window grants nothing. No renderer windowId or lease claim is accepted.

The frozen main-only `ReaderCallerContext` contains windowId, rendererLease and
`isCurrent()`. IPC passes it as an internal third dispatch argument; preload,
request arity, payload validation and response DTOs remain unchanged. The context
is an in-process capability, never a renderer bearer token. The coordinator resolves
native parents only by the exact current context object, never by focus or a claimed
identity. Direct trusted service tests may omit context; production dialog adapters
resolve no parent without one and never open an unparented fallback dialog.

Helper selection carries the accepted context through the serialized queue,
picker, file validation and identity probe. Origin loss cancels with the existing
null result, with no saved selection. Backup selection and restore preflight
recheck the origin after asynchronous boundaries. Save/Open/confirmation results
from an expired origin are discarded; a dialog rejection due to origin loss is
also cancellation. Native dialogs settle through Electron; M1 adds no forced
dialog dismissal or all-window close barrier. No dialog reparents to a peer.

Backup becomes app-owned once its selected destination is validated and the
snapshot starts. Restore becomes app-owned immediately after affirmative native
confirmation with a still-current origin. Those accepted operations finish under
the existing shutdown/recovery protocol, even after origin loss. Existing staged
restore artifacts and safety/recovery behavior are retained. Startup recovery
messages remain application-level, owned by the newly created reader window.

One ReaderService/repository still owns the profile. Registration removal never
closes it. Squirrel gating, scheme/identity/profile setup, lock, offline recovery,
pre-migration protection, seeding rules and app shutdown ordering are retained.
macOS activation recreates a reader only with an initialized service, no registered
window and no shutdown underway. Existing acquisition progress goes to the single
authorized reader; no shared-change protocol or progress fanout is introduced.
Thumbnail grants/protocol, packaged fuses and profile resolution are unchanged.

## Accepted provisional dragging policy (future M8)

Native HTML drag-and-drop is preferred for reorder and attachment. The owner accepts
VS Code-style outside drag-end detachment for the first implementation: Escape
outside may create a window instead of cancelling. This is an intentional UX
limitation, not proof of release or correct cancellation. Future native outcome
detection must be an isolated gesture adapter, independent of durable tab ownership
and transfer transactions. M8 still requires actual native input testing. M1 adds
no dragging, transfers, additional user windows or native addon.

This policy supersedes the original design's unconditional no-detach-on-Escape
acceptance rule for that provisional implementation. M0/M0.5 reports describe their
historical experiment behavior and are not retroactively changed into native passes.

## Verification and consequences

See TESTING.md for deterministic and real Electron evidence. The focused harness
uses two disposable registered windows plus an unregistered window to exercise the
boundary; a separate phase loads the actual built entry and asserts one reader,
reload/state retention and normal last-window shutdown. No production profile or
installer is used. There is no schema change or persisted window identity.

M2 must add ordered shared mutations, reconciliation, guarded shared Undo and
progress fanout. M3 must add participant drain/close/reload and global profile
barriers before any public multi-window feature. M4/M6 own durable identities and
topology. M7 owns transfer; M8 owns native gestures. None is implemented here.
