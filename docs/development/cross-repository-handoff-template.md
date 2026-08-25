# Cross-Repository Feature Handoff

## Governing change

- OpenSpec change/spec:
- User-visible outcome and non-goals:

## Contract

- Bot catalog/schema/result delta:
- Web finite projection and default-off behavior:
- Persistence/migration impact:
- Security and owner-scope impact:

## Evidence

- Bot focused tests and result:
- Bot full gate and result:
- Web focused tests and result:
- Web full gate and result:
- External CI/staging/production: `not_verified` unless cited directly.
- Generated-artifact gate and isolated cache roots:
- Dirty-worktree inventory, including pre-existing user changes:

## Delivery

1. Deploy and verify the compatible Bot version.
2. Deploy Web with consumption disabled when a gate exists.
3. Run authorized compatibility and smoke evidence.
4. Activate deliberately.

## Rollback

- Disable Web consumption first.
- Preserve additive Bot state/contracts until Web no longer sends them.
- Data rollback owner and recovery procedure:
- Remaining risks/approvals:

Do not clean either repository during handoff. Generated-output removal is a
separate, explicitly authorized operation over inspected ignored paths only;
reviewable source, migrations, specifications, fixtures, and lockfiles are
never cleanup targets.
