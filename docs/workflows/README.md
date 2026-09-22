# Business/process workflow documentation

This directory documents cross-domain business processes as
flows/diagrams once they are approved — e.g., the full order lifecycle
from placement through delivery/return, the procurement-to-shelf flow,
or the returns-to-refund flow.

**Status:** empty — these depend on approved specs in `/specs` for the
domains they cross. Do not document a workflow here as if it were
settled behavior until the underlying specs reach `APPROVED` status.

Each workflow doc, once added, should:
- Reference the `/specs` documents it spans
- Show the end-to-end flow (diagram or step list) across those domains
- Note which steps are `DECISION_REQUIRED` if the full flow isn't yet
  fully specified
