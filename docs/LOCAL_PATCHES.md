# Local tooling patches

Out-of-repo changes made to globally-installed dev tools. These live outside the
repo, so they are **not** version-controlled and will be lost on a tool upgrade /
reinstall. Re-apply them if the symptom returns.

---

## graphify — coerce unknown `file_type` to `document`

- **Date:** 2026-06-14
- **Tool:** `graphifyy` 0.4.23 (pipx)
- **File:** `~/.local/share/pipx/venvs/graphifyy/lib/python3.12/site-packages/graphify/build.py`
- **Symptom:** every graph rebuild printed
  `[graphify] Extraction warning: Node ... (id='llm_wiki_architecture') has invalid file_type 'concept' - must be one of ['code', 'document', 'image', 'paper', 'rationale']`.
  The LLM extractor tags concept nodes pulled from doc headings (e.g. the
  `### LLM Wiki architecture` heading in `CLAUDE.md`) with `file_type: "concept"`,
  which isn't in graphify's own `VALID_FILE_TYPES`. Cosmetic — the node still builds.
- **Patch:** in `build_from_json()`, just before `validate_extraction(...)`, coerce any
  `file_type` not in `VALID_FILE_TYPES` to `"document"` (also import `VALID_FILE_TYPES`
  from `.validate`):

  ```python
  for node in extraction.get("nodes", []):
      if isinstance(node, dict):
          ft = node.get("file_type")
          if ft is not None and ft not in VALID_FILE_TYPES:
              node["file_type"] = "document"
  ```
- **Lost on:** `pipx upgrade graphifyy` / reinstall. If graphify fixes this upstream,
  drop the patch.
