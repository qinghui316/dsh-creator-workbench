# Third-party sources

- `video-publisher`: oil-oil/video-publisher-skill, MIT, commit `0d02cc5387b0bea0a43d5aa4e72a2c9502d05f94`. Installed separately in the workbench runtime; public Node entrypoints retained. Windows adapter excludes shell installers.
  The workbench supplies an Ego 2.1 API compatibility boundary and an additive Xiaohongshu prose/readback adapter. These do not alter the pinned upstream files; task recovery keeps the original job and video.
- `vendor/wewrite`: oaker-io/wewrite, MIT, upstream `8077635f259de20a49bf903143be267767d9a2ca`, with the user's existing local converter/theme variant. Original MIT text is in `vendor/wewrite/LICENSE`. JSON worker and draft safety are workbench adaptations. Themes included: claude-editorial and professional-clean.
  Article authoring reuses the local WeWrite writing stages 3–5, framework/writing/enhancement/SEO references, generic exemplar seeds, default persona and humanness checker. `source-files.json` records source hashes. The workbench Skill adapts video inputs, local output/version ownership, HTML delivery and native draft submission. Personal style/configuration, account history and articles are excluded.

Local source snapshot SHA256 before adaptation:

| File | SHA256 |
|---|---|
| converter.py | 1f910a702fdb149ef6c286b58338019b29c427cafeba9aa07316819d634cb9a2 |
| theme.py | 58f211c85c330cef35fad92c8a0550c611d8e8413d2fbf2003116c3dda58024e |

No personal configuration, credentials, browser profiles or publication receipts are distributed.

- `DOMPurify`3.4.17: cure53/DOMPurify, https://github.com/cure53/DOMPurify. Client-side HTML sanitization before the script-disabled article preview. Distributed under its Apache-2.0 licensing option; original license included in `vendor/dompurify/LICENSE`.
