# Third-party notices

This file records third-party skills and code incorporated into Research-Claw
beyond normal package-manager dependency metadata. Each entry names the upstream
source, its license, and the Research-Claw-side adaptations.

## cnki-skills

CNKI (中国知网) browser-automation skill set. Vendored into `skills/cnki-*`.

- Upstream: https://github.com/cookjohn/cnki-skills
- Author: cookjohn (未来论文实验室)
- License: not specified upstream
- Adaptations: each skill's MCP/Chrome-DevTools calls were rewritten onto
  Research-Claw's native `browser` tool (`browser action=open`,
  `browser action=act kind=evaluate`, `browser action=snapshot`, etc.). The
  embedded selector JavaScript is preserved verbatim. Script invocations were
  repointed to RC-root-relative paths (`python3 skills/<name>/scripts/...`).

## sci-papers-downloder

Scopus/OpenAlex/Unpaywall paper search + download skill. Vendored into
`skills/sci-papers-downloder`.

- Upstream: https://github.com/alwayswdc/sci-papers-downloder
- Author: wdc63
- License: MIT (Copyright (c) 2026 wdc63)
- Adaptations: SKILL.md script paths rewritten to RC-root-relative
  (`skills/sci-papers-downloder/scripts/...`). The Elsevier API key shipped as a
  built-in default is Wentor's own user-provided key. The Sci-Hub fallback stays
  at its upstream default (`auto`); `uv`/`uvx` is installed in the Docker image
  so the lazy `scihub-cli` resolution path works without baking the tool itself.

## research-superpower

Systematic literature search & review skill set + `rp.py` (Scopus + OpenAlex)
pipeline. Vendored into `skills/{answering-research-questions,
building-screening-rubrics, cleaning-up-research-sessions,
evaluating-paper-relevance, searching-literature, subagent-driven-review,
traversing-citations}` and `extensions/research-superpower`.

- Upstream: https://github.com/kthorn/research-superpower
- Author: kthorn (Research Superpowers Contributors)
- License: MIT (Copyright (c) 2025 Research Superpowers Contributors)
- Adaptations: the `rp.py` pipeline is wrapped as four native OpenClaw tools
  (`rp_search`, `rp_abstracts`, `rp_cite`, `rp_fulltext`) via
  `extensions/research-superpower/index.ts`; the skills' `scripts/rp.py` shell
  invocations were converted to those tool calls. OpenAlex mailto and the
  Elsevier key fall back to built-in defaults so the tools work with no extra
  configuration.

---

## MIT License

Applies to `sci-papers-downloder` (Copyright (c) 2026 wdc63) and
`research-superpower` (Copyright (c) 2025 Research Superpowers Contributors).

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
