# Komerce CJ498 — one-shot A/B Opus conclusion (no paid AI)

Plan: one last discriminating experiment, GO / NO GO / INCONCLUSIVE, then move to canonical E2E. No code changes to V1 or catalog business tables.

## Known limitations

- Entire CJ498 corpus was already explored in a prior lexical experiment. B is a frozen internal holdout, NOT a truly independent future-provider proof.
- The old 65 isolated products were specific to a previous grouping rule and are not a universal minimum.
- A cross-segment group may simply share vague terms; it does not prove a wrong supplier path.
- The proposed head/modifier key is a narrow heuristic, not real part-of-speech parsing.
- 95% point precision from a small sample does not provide a 95% lower confidence bound.

## Protocol

1. A-only train, using the exact 498 CJ source SHA and independently matched V1 references. Title-normalized duplicates share an A/B partition. No B titles or labels used in family construction.
2. Human examines ALL members of each priority-A family (not merely examples); approve, split, or defer. A no-review family cannot propagate. Only groups with score size*segments >= 3 enter the first review template; the score is a priority heuristic, not reliability.
3. Freeze reviewed rules with reviewer and evidence; no exceptions silently omitted. An ambiguity/split does not propagate.
4. Only after freeze, measure transfer into B using the exact head/modifier key. Without independent human labels on every B reference, the verdict is PENDING, precision null.
5. If blinded B labels are supplied, measure transfer rate on V1 review products, parent correctness, propagation errors, and Wilson 95% interval. The result is only a provisional candidate for external supplier generalization, never a final precision certification.

## Commands (PowerShell on the research branch)

    gh run download 40518230098 -R SamyrFateh/komerce-backend -n cj-balanced-e2e-500 -D baseline
    gh run download 40607392815 -R SamyrFateh/komerce-backend -n cj-498-p1-real-pg-e2e-40607392815 -D v1
    node scripts/cj-headnoun-ab-experiment.js train baseline/classification-evidence.json v1/all-498-decisions.json artifacts/object-shadow/headnoun-AB

Review artifacts/object-shadow/headnoun-AB/A-human-family-review.csv in a spreadsheet editor and inspect full A-family-members.json. Keep exactly the column headings.

Action column: APPROVE, SPLIT or DEFER. For APPROVE: human_parent, optional human_leaf, reviewer, evidence_note. On known V1 parent conflict, evidence_note must explicitly contain ARBITRATED: and why. For SPLIT specify ambiguous_head_on_split and a reason. Do not approve ambiguous or mixed-object families.

    node scripts/cj-headnoun-ab-experiment.js freeze baseline/classification-evidence.json v1/all-498-decisions.json artifacts/object-shadow/headnoun-AB artifacts/object-shadow/headnoun-AB/A-human-family-review.csv artifacts/object-shadow/headnoun-AB/A-frozen-human-rules.json

After freeze only:

    node scripts/cj-headnoun-ab-experiment.js evaluate baseline/classification-evidence.json v1/all-498-decisions.json artifacts/object-shadow/headnoun-AB/A-frozen-human-rules.json artifacts/object-shadow/headnoun-AB

For scored evaluation, the optional final input is a JSON array of exact holdout reference identifiers and independent human_parent strings for ALL B rows; it must be prepared blind, never from V1 or the A proposals.

## Decision

Opus suggested >=40% transfer coverage on B review, >=95% point parent precision and <=2 errors for provisional GO, <25% reuse or <90% precision for NO GO. Any other result is INCONCLUSIVE. This small, already-explored corpus cannot on its own demonstrate the 95% production guarantee, even with a provisional GO. Report time spent reading and validating full families separately, and do not infer time from decision counts.

In all cases close this classification R&D iteration and resume sourcing -> refinery -> catalog -> market publication -> orders -> finance E2E. No merge into main without explicit approval.
