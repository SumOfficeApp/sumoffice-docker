# What changed

## 28 September 2026 — `2026.09.28-amd64`

Editors rebuilt from current sources; `latest` points at these images.

**Your work reaches the file.** Two people editing one workbook both got their edits
saved. On the previous images the same round did not even get that far: the editor
did not accept typing, and the file on the server was rewritten anyway — without
either person's edit. If you run the September images, this alone is worth the update.

**The editor no longer promises a save it cannot make.** When a file is opened in a
mode that does not allow writing, the editor says so instead of showing "Saved".

**Pressing save while still typing in a cell no longer loses that cell.** Text typed
without leaving the cell is committed first, then saved.

**A refused save is now visible to the person who typed.** Rejections and dropped
connections used to reach the server log only; the person kept typing into a document
that was no longer being saved.

**Documents are drawn with the right fonts.** The server image shipped without a
single font file, so every document was drawn with a fallback and the layout quietly
drifted. It now carries metric-compatible fonts: Calibri, Arial and Times New Roman
keep their letter widths, so pagination matches the original.

**Vector pictures (WMF/EMF) are drawn, not left as empty frames.**

**An image can no longer ship with an engine it cannot run.** The build now reads the
architecture out of the engine binary and refuses to produce an image that does not
match it — and it refuses to produce an image whose editor was never bundled. Both
faults used to pass every file check and fail at the first person who opened a
document.

**Excel and Word open the result without a repair dialog.** Re-measured on 29
September against the published image (`sha256:527afe26004a…`), with a known-good
and a deliberately damaged file in the same run, so that a quiet "clean" means
something.

### Not in this release

- **arm64.** These are `linux/amd64` images, and `latest` is a single image, not a
  multi-architecture list.
- **Two people in one Word document.** Measured for workbooks only; simultaneous DOCX
  editing is not claimed.
- **DocsAPI** is unchanged and stays pinned at `2026.09.27-amd64`.

## 27 September 2026 — `2026.09.27-amd64`

First pinned server release: complete `linux/amd64` images of SumSheet, SumDoc,
previews and DocsAPI, with the exact revisions recorded in the repository README.
