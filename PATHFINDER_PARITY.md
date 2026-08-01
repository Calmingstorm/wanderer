# Pathfinder parity audit

This audit compares the current Wanderer mapper with the archived `exodus4d/pathfinder` codebase and manual. It is a product-parity inventory, not a claim that every Pathfinder behavior should be copied literally.

## Implemented in this branch

### Wrong-system signature paste guard

Pathfinder checked the signature table's system against the active character's current EVE location before writing parsed signatures (`js/app/ui/module/system_signature.js`, `updateSignatureTableByClipboard`). Wanderer previously applied every valid scanner paste directly to whichever map system was selected.

Wanderer now:

- parses first and ignores unrelated clipboard text;
- uses the followed character as the active location when available, then the configured main character, then a single unambiguous online owned character;
- warns before any mutation when that location differs from the selected system;
- names both systems and the character in the warning;
- offers **Cancel**, **Select current system**, and the explicit destructive choice **Update anyway**;
- declines to guess when character/location data is stale, unavailable, offline, non-owned, or ambiguous;
- discards a pending paste if the selected map system changed before confirmation.

This intentionally follows Pathfinder's safety model while avoiding false certainty from the clipboard itself, which contains no system identity.

## Parity matrix

| Pathfinder capability                                                                  | Wanderer status after this branch                                  | Gap / next action                                                                                                                                              |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collaborative chain map with systems and connections                                   | Present                                                            | No parity work identified.                                                                                                                                     |
| Private/corporation/alliance sharing and access control                                | Present with richer ACL/permission handling                        | No direct port recommended.                                                                                                                                    |
| Automatic character-location tracking and map centering                                | Present                                                            | No direct port recommended.                                                                                                                                    |
| Signature bulk paste / scanner parser                                                  | Present                                                            | Guard added in this branch.                                                                                                                                    |
| Warn before pasting signatures into a system different from current character location | **Added**                                                          | Covered by unit tests.                                                                                                                                         |
| Signature reconciliation, stale/lazy deletion, undo                                    | Present                                                            | Wanderer's undo flow is stronger than old Pathfinder.                                                                                                          |
| Per-signature metadata and wormhole linking                                            | Present                                                            | No direct port recommended.                                                                                                                                    |
| Signature scan-completion percentage / visual progress                                 | Missing as an explicit aggregate                                   | Add a scanned/total progress indicator based on signature group/type completeness. Medium priority.                                                            |
| Signature-reader preview of new / changed / deleted signatures before commit           | Missing                                                            | Add an optional review dialog for destructive/full scanner sync. High priority.                                                                                |
| Explicit “delete linked connections” option during scanner reconciliation              | Partial/implicit                                                   | Audit server reconciliation semantics, then expose an explicit safe option if connections can be removed. High priority because hidden cascades are dangerous. |
| Signature history / recent scan snapshots                                              | Partial (undo exists)                                              | Add per-system recent scan history only if operators need more than undo. Medium priority.                                                                     |
| System aliases, status, tags, lock state, effects and statics                          | Present                                                            | Wanderer is at or beyond parity.                                                                                                                               |
| Wormhole EOL, mass stage, ship-size limits, connection type/scope                      | Present                                                            | Wanderer is at or beyond parity.                                                                                                                               |
| Preserve-mass connection flag                                                          | No obvious equivalent found                                        | Validate operational demand before implementation. Medium priority.                                                                                            |
| Bubbled endpoint flag                                                                  | No obvious equivalent found                                        | Low priority unless fleets actively use it.                                                                                                                    |
| Map scopes (wormhole, stargate, all, none)                                             | Different model / partial                                          | Wanderer uses map options, routes, hubs and visibility controls. Avoid literal port without a concrete workflow.                                               |
| Frame/multi-select, lock and bulk map operations                                       | Present                                                            | No direct port recommended.                                                                                                                                    |
| Grid snapping and map magnetizing                                                      | No obvious equivalent found in current UI                          | Low priority quality-of-life candidate.                                                                                                                        |
| Rally points with desktop/Slack/Discord/email poke                                     | Partial: pings and integrations differ                             | Current pings cover the core workflow; audit notification-channel demand separately.                                                                           |
| Waypoint queue control (destination/front/end)                                         | Present in modern form                                             | No direct port recommended.                                                                                                                                    |
| Route planning with avoidance/preferences                                              | Present and richer                                                 | No direct port recommended.                                                                                                                                    |
| System intel, structures, local pilots, recent activity, killboard/killstream          | Present and generally richer                                       | No direct port recommended.                                                                                                                                    |
| d-scan reader and structure ingestion                                                  | Structure scanner/update flow present; exact d-scan parity unclear | Deep-test actual EVE clipboard formats before calling this complete. Medium priority.                                                                          |
| Statistics, map history logging and external notification logs                         | Partial/different observability model                              | Treat as separate product work, not mapper parity.                                                                                                             |
| Custom map layouts                                                                     | Present via draggable/resizable widgets and saved settings         | No direct port recommended.                                                                                                                                    |
| Jump bridges and special connection scopes                                             | Present in route/connection models, UI coverage varies             | Verify only if operators report a concrete gap.                                                                                                                |

## Recommended follow-up order

1. Signature reconciliation preview showing additions, changes, removals and affected links before commit.
2. Signature scan-completion percentage in the signature widget and on map nodes.
3. Explicit connection-deletion behavior during scanner synchronization, with tests preventing surprise chain deletion.
4. Focused d-scan/structure clipboard parity test using current EVE client output.
5. Only then consider low-value visual parity such as grid snapping, magnetizing or bubbled endpoints.

The old tool had some sharp, excellent safety rails. It also had a decade of accumulated surface area. The sensible goal is workflow parity, not archaeological re-enactment.

## Audit provenance

- Pathfinder baseline: `exodus4d/pathfinder` commit `62dc991` (`master`).
- Wanderer upstream baseline: `wanderer-industries/wanderer` commit `b7ddbc48` (`main`, release line v1.101.7).
- Calmingstorm fork baseline before rebase: `59dbf78f` (`main`).
- Sources inspected include Pathfinder's mapper manual, signature reader template, `system_signature.js`, map/location modules, and Wanderer's mapper, signature, route, character, structure, ping and settings components.
