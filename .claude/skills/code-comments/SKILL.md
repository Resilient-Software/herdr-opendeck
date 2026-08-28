---
name: code-comments
description: Use before committing any code change in this repository — Go, TypeScript templates, shell scripts, YAML, mise tasks — and when reviewing a diff for comment noise. Triggers on writing or keeping `//` or `#` comments, doc comments, "why" explanations, reviewer notes, TODO/history notes, or comments that restate a name.
---

# Code comments

No narrative comments in code. Constants/functions with clear names get no
comment; never annotate why a change was made or explain design in comments.

**Why:** "this is not your diary, it's a codebase" — comments talking to the
reviewer are noise post-merge.

**How to apply:** Write comments only for non-obvious constraints the code
cannot possibly express; match existing file density.
