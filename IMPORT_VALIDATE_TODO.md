# Import & Validate — Remaining TODO Items

Follow-up work for the `feature/import-validate-python-files` branch.
Pick up from here when resuming development.

---

## 0. Fix drag-and-drop in MacApp (WKWebView)

**Effort:** Medium | **Repo:** PsyNeuView-MacApp | **Priority:** High

WKWebView doesn't support HTML5 file drag-and-drop from Finder the same
way browsers do. When a file is dragged from Finder, WKWebView pastes the
text contents instead of providing `dataTransfer.files`.

**Fix (in the MacApp Swift code):**
- Override `performDragOperation` in the WKWebView subclass
- Extract the file URL from the pasteboard (`NSPasteboard`)
- Call JavaScript to load the file: `window.postMessage({type: 'file-drop', path: '/...'})` 
- The web app listens for this message and calls `loadFromPath(path)`

This is the only way to get the file PATH (not just contents) from a
native macOS drag operation into WKWebView.

**Workaround (current):** Use "Load Model → Open from path..." and paste
the file path. This uses our custom PromptModal which works in WKWebView.

---

## 1. Register `.pnlproject` file icon in MacApp

**Effort:** Small | **Repo:** PsyNeuView-MacApp

Register the `.pnlproject` UTI (Uniform Type Identifier) in the macOS app's
`Info.plist` so the OS shows the PsyNeuLink icon for `.pnlproject` files and
double-clicking opens them in PsyNeuView.

- Add UTI declaration for `com.psyneulink.project`
- Create `.icns` icon file from the PsyNeuLink logo
- Add document type entry in `Info.plist`
- Handle file-open events in the MacApp to load the project

---

## 2. Conversion diff preview

**Effort:** Medium | **Value:** Low-medium

Before converting a free-form file to standard format, show a diff of what
will change. Currently the user only sees the format issues list and a
"Convert" button — they don't know what code will be rewritten.

- Compute the converted source without writing it
- Show a side-by-side or unified diff in a modal
- Let the user approve or cancel
- Backup already protects the original, so this is a UX improvement

---

## 3. Inline "add to composition" quickfix

**Effort:** Medium | **Value:** Medium

When diagnostics detect an orphan mechanism (not in any composition), offer
a one-click fix that inserts `comp.add_node(mech)` into the code.

- The warning already suggests the fix text
- Need a CodeMirror widget or a button in the diagnostic panel that
  programmatically inserts the line at the right position
- Should insert after the last `add_node` call or at the end of the
  Compositions section

---

## 4. Multi-file drop (`.py` + `.pnlview.json`)

**Effort:** Small | **Value:** Low

When a user drops both a `.py` file and its `.pnlview.json` sidecar together,
import both so the layout is preserved. Currently only single `.py` or
`.pnlproject` files are handled.

- Check `e.dataTransfer.files` for both extensions
- Save the `.py` file, then write the `.pnlview.json` as sidecar
- The `.pnlproject` format covers this use case more cleanly

---

## 5. File browser panel (tree view)

**Effort:** Large | **Value:** High

Replace the dropdown model selector with a file tree panel showing the
models directory structure. Would make file management much more intuitive.

- Tree view component with folder expand/collapse
- Show `.py` and `.pnlproject` files
- Right-click context menu: Open, Rename, Delete, Export Project
- Drag files between folders
- Show file modified dates and sizes
- This is a significant UI redesign — needs its own planning session

---

## 6. Code reformatter

**Effort:** Medium | **Value:** Medium | **Risk:** High

Add a "Reformat" button that cleans up Python code formatting.

- `ast.unparse()` produces very different output from the original
- `autopep8` or `black` would need to be installed as dependencies
- Risk of mangling user code structure, comments, or formatting
- **Recommendation:** If pursued, only offer for standardized-format files
  where the structure is predictable. Never auto-reformat free-form files.

---

## 7. `.pnlproject` weights support

**Effort:** Medium | **Value:** Medium

The `.pnlproject` manifest has a `weights` field (currently empty array).
When an AutodiffComposition has trained weights saved as `.pnl` files,
include them in the project bundle.

- On export: check for `*_matrix_wts.pnl` files alongside the model
- Include them in a `weights/` directory inside the zip
- On import: extract weights to the same directory as the model
- Update manifest to list the weight files

---

## Done (this branch)

### Core Features
1. Star import auto-conversion (tokenize-based, backup + undo)
2. Syntax pre-validation with line/column numbers + auto-scroll
3. Partial execution — introspect what was built before errors
4. Zero-composition detection with helpful message
5. Debounced live sync (1.5s, AbortController, auto-clearing status)
6. Diagnostic panel (counts, editability, clickable warnings, convert button)
7. View-only badges and inspector read-only mode
8. New Model template with PNL version header
9. `.pnlproject` bundle format (export + import + drag-and-drop)
10. File drag-and-drop for `.py` and `.pnlproject` files

### Editor Enhancements
11. PNL autocomplete after `pnl.`
12. 9 code snippet templates
13. CodeMirror lint integration (squiggly underlines)
14. Error line decoration + auto-scroll
15. Cursor position display
16. Unsaved changes indicator
17. Sync status indicator

### Inspector Enhancements
18. Model Overview (composition name, PNL version, counts, format, complexity)
19. Parameter type hints
20. Read-only mode for view-only nodes

### Diagnostics
21. Format badge (standard / free-form / converted)
22. Import style and PNL version display
23. Orphan mechanism warnings with fix suggestions
24. AST function-scope detection
25. Duplicate mechanism name detection
26. Multiple composition warning
27. Warning count badge on collapsed panel

### Backend
28. Parameter value validation (compile check)
29. Star import backup + undo endpoint
30. PNL version endpoint
31. Complexity metrics computation
32. `.pnlproject` export/import endpoints

### Tests (37 total)
- 8 star import conversion
- 20 validation (syntax, empty, diagnostics, function-scope, params)
- 9 project bundle (export, import, round-trip)
