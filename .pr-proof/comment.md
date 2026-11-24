<!-- pr-proof-ci-review-bot -->
# pr-proof ci review

<sub>ran on [4d27b38](https://github.com/commit/4d27b387ab8d6c880e5eab36b6c47af3554f1aca) — Add pr-proof CI review action and Greptile config</sub>

## ⚠️ Action required

### PR body is missing proof

- the first section must be '## Before and after' (visual first)
- missing '## Outcome' section: 2 to 4 plain sentences on what the user saw before and sees now, then the '**Outcome:**' line
- missing a '**Outcome:**' line
- missing '## What changes for you': a 3-column table (You do | Base | This PR), one row per thing a user does, including a row where nothing should change
- missing '## What changed' section
- missing '## Live results' section
- missing '## Not covered' with at least one bullet (write 'Nothing known' only if true)
- missing '## Cost surface' (performance, size, tokens or CI time, or say it was not measured)
- missing '## Tests' section
- missing '## Architecture impact': run pr-proof floorplan-map, then pr-proof body
- missing '## Code delta' mermaid diagram
- missing '## Rules check' section

**How to fix:** run `pr-proof template`, fill every section, then `pr-proof body --spec` and update the description.

---

## ℹ️ Info

### What the PR body proves

| Section | Present |
|---|---|
| Before and after | ❌ |
| Outcome | ❌ |
| What changes for you | ❌ |
| What changed | ❌ |
| Live results | ❌ |
| Not covered | ❌ |
| Cost surface | ❌ |
| Tests | ❌ |
| Architecture impact | ❌ |
| Code delta | ❌ |
| Rules check | ❌ |
| Infographic (optional) | ➖ |
| Prompt surface (optional) | ➖ |

### Diff

5 files, +178 -3. 0 e2e or integration test file(s), 0 unit test file(s) in the diff.
