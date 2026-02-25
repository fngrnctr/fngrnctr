---
name: git-commit
description: 'Execute git commit with conventional commit message analysis, intelligent staging, and message generation. Use when user asks to commit changes, create a git commit, or mentions "/commit". Supports: (1) Auto-detecting type and scope from changes, (2) Generating conventional commit messages from diff, (3) Interactive commit with optional type/scope/description overrides, (4) Intelligent file staging for logical grouping'
license: MIT
allowed-tools: Bash
---

# Git Commit with Conventional Commits

## ⚠️ Account Requirement (REQUIRED — check before ANY git or gh operation)

Only the **`fngrnctr`** GitHub account may push branches, create commits, or open/merge pull requests on this repository.

Before running any `git push`, `git commit`, or `gh` command, verify the active account:

```bash
# Check gh CLI active account
gh auth status

# Check git's configured remote account (look at the push URL)
git remote -v
```

**If `gh auth status` shows any account other than `fngrnctr` as active:**

```bash
gh auth switch --user fngrnctr
```

**Do NOT proceed** with any remote operation until `fngrnctr` is confirmed as the active account. Alert the user if a switch is needed.

---

## Overview

Create standardized, semantic git commits using the Conventional Commits specification. Analyze the actual diff to determine appropriate type, scope, and message.

## Conventional Commit Format

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

## Commit Types

| Type       | Purpose                        |
| ---------- | ------------------------------ |
| `feat`     | New feature                    |
| `fix`      | Bug fix                        |
| `docs`     | Documentation only             |
| `style`    | Formatting/style (no logic)    |
| `refactor` | Code refactor (no feature/fix) |
| `perf`     | Performance improvement        |
| `test`     | Add/update tests               |
| `build`    | Build system/dependencies      |
| `ci`       | CI/config changes              |
| `chore`    | Maintenance/misc               |
| `revert`   | Revert commit                  |

## Breaking Changes

```
# Exclamation mark after type/scope
feat!: remove deprecated endpoint

# BREAKING CHANGE footer
feat: allow config to extend other configs

BREAKING CHANGE: `extends` key behavior changed
```

## Workflow

### 1. Analyze Diff

```bash
# If files are staged, use staged diff
git diff --staged

# If nothing staged, use working tree diff
git diff

# Also check status
git status --porcelain
```

### 2. Stage Files (if needed)

If nothing is staged or you want to group changes differently:

```bash
# Stage specific files
git add path/to/file1 path/to/file2

# Stage by pattern
git add *.test.*
git add src/components/*

# Interactive staging
git add -p
```

**Never commit secrets** (.env, credentials.json, private keys).

### 3. Generate Commit Message

Analyze the diff to determine:

- **Type**: What kind of change is this?
- **Scope**: What area/module is affected?
- **Description**: One-line summary of what changed (present tense, imperative mood, <72 chars)

### 4. Execute Commit

```bash
# Single line
git commit -m "<type>[scope]: <description>"

# Multi-line with body/footer
git commit -m "$(cat <<'EOF'
<type>[scope]: <description>

<optional body>

<optional footer>
EOF
)"
```

## Best Practices

- One logical change per commit
- Present tense: "add" not "added"
- Imperative mood: "fix bug" not "fixes bug"
- Keep description under 72 characters

## Privacy Check (REQUIRED before every commit)

Before staging or committing, scan the diff for any real person's name:

```bash
# Check staged changes for names
git diff --staged | grep -iE '\b[A-Z][a-z]+ [A-Z][a-z]+\b'

# Also check tracked file contents being added
git diff --staged --name-only | xargs grep -iE '\b[A-Z][a-z]+ [A-Z][a-z]+\b' 2>/dev/null
```

**If any name is found:**
- Do NOT proceed with the commit
- Alert the user immediately with the file/line containing the name
- Ask the user to remove or replace it with a handle, role, or anonymous reference

This rule has no exceptions — no real names in code, comments, commit messages, or file contents.

## Git Safety Protocol

- **ONLY the `fngrnctr` account may push or open PRs** — verify with `gh auth status` before every remote operation
- NEVER update git config
- NEVER run destructive commands (--force, hard reset) without explicit request
- NEVER skip hooks (--no-verify) unless user asks
- NEVER force push to main/master
- If commit fails due to hooks, fix and create NEW commit (don't amend)
