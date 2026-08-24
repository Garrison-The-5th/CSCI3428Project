# SCHEMA-sast.md — SAST Triage Document Schema

SAST triage documents record our disposition of **source-code findings** from
Semgrep and SonarQube security rules. The schema is VEX-aligned — it shares the
exact same `status` taxonomy, `justification` values, and `confidence` semantics
as VEX (see SCHEMA-vex.md) — but the finding-identification fields differ because
SAST findings have no CVE ID and aren't tied to a package version.

Files live in `.security/sast/` named `YYYY-MM-DD-pr<N>-<slug>.sast.json`.
**Documents are immutable** — same rule as VEX. New decisions = new dated files.

---

## Document-level fields

Identical to VEX (see SCHEMA-vex.md). The only difference is `@context` points to
this schema doc rather than the OpenVEX namespace:

| Field | Filled by | Required | Notes |
|---|---|---|---|
| `@context` | Agent | Always | URL of this schema doc |
| `@id` | Agent | Always | Stable URI for this document |
| `version` | Agent | Always | Always `1` |
| `timestamp` | Agent | Always | ISO-8601 |
| `author` | Agent | Always | Identity that authored the doc |
| `agent.{name,model,version,invocation_id}` | Agent | Always | Agent metadata (or `manual-baseline`) |
| `review.reviewer` | **Human** | At merge | Reviewer **email** |
| `review.reviewed_at` | **Human** | At merge | ISO-8601 merge timestamp |
| `review.decision` | **Human** | At merge | `approved` / `edited` / `rejected` |
| `review.notes` | **Human** | At merge | Optional commentary |
| `statements` | Agent | Always | Array of per-finding statements (below) |

---

## Per-statement fields

The **identification** fields differ from VEX; the **disposition** fields are identical.

| Field | Filled by | Required | Value / notes |
|---|---|---|---|
| `finding.rule_id` | Agent | Always | Full Semgrep/Sonar rule ID |
| `finding.tool` | Agent | Always | `semgrep` or `sonar` |
| `finding.tool_version` | Agent | Always | Scanner version |
| `finding.sarif_fingerprint` | Agent | Always | `matchBasedId/v1` hash — the stable identifier across scans |
| `finding.location.file` | Agent | Always | Repo-relative path |
| `finding.location.start_line` | Agent | Always | Starting line (human reference, not identity) |
| `finding.location.end_line` | Agent | Always | Ending line |
| `finding.location.commit_sha` | Agent | Always | SHA the finding was anchored to |
| `status` | Agent | Always | Same 4 values as VEX |
| `justification` | Agent | When `not_affected` | Same 5 OpenVEX values as VEX |
| `impact_statement` | Agent | Recommended | Reasoning + evidence |
| `action_statement` | Agent | When `affected` | Concrete plan |
| `action_reference` | Agent | When `fixed` | PR URL or commit SHA |
| `confidence` | Agent | Always | 0–100, path-specific (see SCHEMA-vex.md) |
| `owner` | Agent → Human | Recommended | Accountable party |
| `reevaluate_after` | Agent | When status active | ISO date; `null` when `fixed` |
| `references` | Agent | Optional | Rule documentation URL |

---

## Identity: how SAST findings are tracked across scans

VEX uses the CVE ID as the stable identifier. SAST has no CVE, so it uses
`finding.sarif_fingerprint` — Semgrep's `matchBasedId/v1`, a content-based hash of
`(rule_id + matched_code + nth_occurrence_in_file)`. Line numbers are NOT in the
hash, so the fingerprint survives unrelated edits above/below the finding but
changes when the matched code itself changes.

This is what lets the agent bucket findings as NEW / PERSISTENT / RESOLVED /
REGRESSION across scans. See [[Security Agent Classifications]] for the bucketing.

**Baseline caveat:** the 2026-05-25 baseline scan was run in Semgrep CE mode where
`matchBasedId` is login-gated (shows `"requires login"`). Baseline `fixed` entries
therefore use the placeholder `"baseline-no-fingerprint"`. That's acceptable for
historical fixed entries because the vulnerable code shape no longer exists — no
future scan would match the old fingerprint regardless. Live-pipeline entries will
carry real fingerprints.

---

## Example statement

```json
{
  "finding": {
    "rule_id": "javascript.express.security.injection.raw-html-format.raw-html-format",
    "tool": "semgrep",
    "tool_version": "1.163.0",
    "sarif_fingerprint": "baseline-no-fingerprint",
    "location": {
      "file": "backend/routes/contact.ts",
      "start_line": 52,
      "end_line": 52,
      "commit_sha": "2423853"
    }
  },
  "status": "fixed",
  "action_reference": "https://github.com/your-org/your-repo/pull/123",
  "impact_statement": "User-controlled name interpolated into HTML email body without escaping. Closed by PR #169: added escapeHtml() helper wrapping all interpolations.",
  "confidence": 95,
  "owner": "rware@ttgteams.com",
  "reevaluate_after": null
}
```
