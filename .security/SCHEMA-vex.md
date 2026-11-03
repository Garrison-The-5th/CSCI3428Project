# SCHEMA-vex.md — VEX Triage Document Schema

VEX (Vulnerability Exploitability eXchange) documents record our disposition of
**CVE / GHSA findings** from dependency + container scanners (Trivy, npm audit).
Format is OpenVEX-aligned (`https://openvex.dev/ns/v0.2.0`) with a small set of
internal extensions for our audit workflow. Schema name: `internal-vex-v1`.

Files live in `.security/vex/` named `YYYY-MM-DD-pr<N>-<slug>.openvex.json`.
**Documents are immutable** — a new decision means a new dated file, never an edit
to an existing one. "Current state" = the merge of all docs (latest timestamp wins
per vulnerability+product).

---

## Document-level fields

| Field | Filled by | Required | Notes |
|---|---|---|---|
| `@context` | Agent | Always | `https://openvex.dev/ns/v0.2.0` |
| `@id` | Agent | Always | Stable URI for this document (repo path) |
| `version` | Agent | Always | Always `1` (docs are immutable) |
| `timestamp` | Agent | Always | ISO-8601; when the doc was issued |
| `author` | Agent | Always | Identity that authored the doc |
| `agent.name` | Agent | Always | Bot identifier (or `manual-baseline`) |
| `agent.model` | Agent | Always | Model used (or `n/a`) |
| `agent.version` | Agent | Always | Agent code version |
| `agent.invocation_id` | Agent | Always | CI run ID for traceability |
| `review.reviewer` | **Human** | At merge | Reviewer **email** |
| `review.reviewed_at` | **Human** | At merge | ISO-8601 merge timestamp |
| `review.decision` | **Human** | At merge | `approved` / `edited` / `rejected` |
| `review.notes` | **Human** | At merge | Optional commentary |
| `statements` | Agent | Always | Array of per-finding statements (below) |

The `review` block is written `null` at PR-commit time and populated by the
post-merge finalize workflow from the PR review form.

---

## Per-statement fields

| Field | Filled by | Required when | Value / notes |
|---|---|---|---|
| `vulnerability.name` | Agent | Always | CVE or GHSA ID (e.g., `CVE-2026-42033`) |
| `vulnerability.aliases` | Agent | Optional | Other IDs for the same vuln |
| `vulnerability.description` | Agent | Always (agent ≥ 2.0.0) | Title + plain-English explanation (format below) |
| `products[].@id` | Agent | Always | Package URL: `pkg:npm/<name>@<version>` |
| `status` | Agent | Always | `not_affected` / `affected` / `fixed` / `under_investigation` |
| `justification` | Agent | When `status: not_affected` | One of the 5 OpenVEX values (below) |
| `impact_statement` | Agent | Always (agent ≥ 2.0.0) | Exposure verdict + evidence + what we did (format below) |
| `action_statement` | Agent | When `status: affected` | Concrete plan: what + when + how |
| `fixed_in_version` | Agent | When `status: fixed` | Version containing the fix |
| `action_reference` | Agent | When `status: fixed` | PR URL, commit SHA, or `merge run=<id>` / `watch run=<id>` (the bot can't know its PR URL when it commits) |
| `confidence` | Agent | Always (extension) | 0–100, path-specific meaning (below) |
| `owner` | Agent → Human | Recommended | Accountable party (email or GitHub team) |
| `reevaluate_after` | Agent | When status is active | ISO date; `null` when `fixed` |
| `references` | Agent | Optional | Advisory URLs |

---

## The 4 status values

| Status | Meaning | Required extra field |
|---|---|---|
| `fixed` | We closed it (dep bump, patch, override) | `action_reference` |
| `not_affected` | Real CVE, but our usage doesn't trigger it | `justification` |
| `affected` | Real CVE, fix deferred to a later PR | `action_statement` |
| `under_investigation` | Not enough confidence yet; needs human | `impact_statement` describing what's uncertain |

## The 5 OpenVEX justification values (required for `not_affected`)

| Value | Meaning |
|---|---|
| `component_not_present` | Package isn't actually in the shipped artifact |
| `vulnerable_code_not_present` | Package shipped, vulnerable function not compiled in |
| `vulnerable_code_not_in_execute_path` | Code present but never executed at runtime |
| `vulnerable_code_cannot_be_controlled_by_adversary` | Code runs, but attacker can't reach the input |
| `inline_mitigations_already_exist` | Compensating control blocks exploitation |

## Confidence — path-specific meaning

The single `confidence` number is interpreted against the `status` it's paired with:

| Status | Confidence answers | Threshold |
|---|---|---|
| `fixed` | "Will the fix work without breaking things?" | ≥80% to take this path |
| `not_affected` | "Is the FP call right — code unreachable?" | ≥70% |
| `affected` | "Is it real, and is the action plan right?" | ≥60% |
| `under_investigation` | Explicitly low confidence | <60% |

---

## Plain-English description + exposure verdict

Required on documents with `agent.version` ≥ 2.0.0 (older documents are
exempt — they are immutable). The validator enforces both rules.

**`vulnerability.description`** describes the vulnerability itself — true for
anyone using the package. Written for a junior developer:

```
<advisory title>. What it is: <plain English>. How it could be exploited: <one concrete example attack>.
```

**`impact_statement`** describes OUR situation. It starts with exactly one
verdict, then gives evidence (file:line, grep result), then what we did or
the plan:

| Status | Allowed verdict |
|---|---|
| `fixed` | `Exposed:` or `Not exposed:` |
| `not_affected` | `Not exposed:` |
| `affected` | `Exposed:` |
| `under_investigation` | `Unknown:` or `Exposed:` |

`fixed` carries either verdict because we bump whenever a fixed version
exists, whether or not we were exposed.

---

## Example statement

```json
{
  "vulnerability": {
    "name": "CVE-2026-31938",
    "description": "jsPDF: Cross site scripting via unsanitized output options. What it is: some output modes open the PDF in a new browser window by building HTML, and the filename/options weren't escaped, so script could be injected into that page. How it could be exploited: an app that opens PDFs in a new window titled with a user-chosen name lets an attacker name something '<script>...</script>'; anyone who opens it runs the attacker's script in their logged-in session."
  },
  "products": [{ "@id": "pkg:npm/jspdf@3.0.4" }],
  "status": "fixed",
  "fixed_in_version": "4.2.1",
  "action_reference": "merge run=40868223443",
  "impact_statement": "Not exposed: our only jspdf call is output(\"blob\") at frontend/src/utils/transcriptExport.ts:103, which builds no HTML. Bumped jspdf 3.0.4 -> 4.2.1 anyway; build, lint, tests and tsc pass.",
  "confidence": 90,
  "owner": "rware@ttgteams.com",
  "reevaluate_after": null,
  "references": ["https://avd.aquasec.com/nvd/cve-2026-31938"]
}
```
