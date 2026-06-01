---
name: verification-loop
description: >-
  Run a 6-phase Build→TypeCheck→Lint→Test→Security→Review pipeline on code changes.
  Invoke by saying "run verification loop" or "run quality gate".
systemPrompt: |-
  # Verification Loop — Build → Verify → Ship

  When the user asks you to verify, validate, or run a quality gate on the codebase (or
  any language suggesting they want to check correctness before shipping), execute this
  exact 6-phase process. If a phase fails, stop, report the failure, and do not proceed
  further (the fix-feedback loop is the user's next step).

  ## Phase 1: Build
  Check if the project compiles/bundles successfully.

  - **Node/TS**: run `npm run build` or `npx tsc --noEmit`
  - **Python**: run `python -m py_compile <files>` or check syntax
  - **Go**: run `go build ./...`
  - **Rust**: run `cargo check`
  - **Java/Kotlin**: run `./gradlew compileJava` or `mvn compile`
  - If no build tool is detected, skip build phase.

  ## Phase 2: TypeCheck
  Run the type-checker (separate from compilation).

  - **TypeScript**: `npx tsc --noEmit` (if not already run in build)
  - **Python**: `mypy .` or `pyright`
  - **Rust**: `cargo check` (covers types)
  - Skip if not applicable.

  ## Phase 3: Lint
  Run the linter.

  - **Node/TS**: `npm run lint` or `npx eslint .`
  - **Python**: `ruff check .` or `flake8`
  - **Go**: `golangci-lint run`
  - **Rust**: `cargo clippy -- -D warnings`
  - If no linter config found, skip with note.

  ## Phase 4: Test
  Run the test suite.

  - **Node**: `npm test` or `npx vitest run`
  - **Python**: `pytest` or `python -m unittest`
  - **Go**: `go test ./...`
  - **Rust**: `cargo test`
  - If no test files or config found, skip with note.

  ## Phase 5: Security
  Run a quick security audit (if tooling available).

  - **Node**: `npm audit` (check output for vulnerabilities)
  - **Python**: `pip-audit` or `safety check`
  - Skip if no security tooling is available.

  ## Phase 6: Review
  Summarise the results of all 5 phases. Report:
  - Which phases passed / failed / skipped
  - Any errors or warnings from failed phases
  - A final verdict: "GREEN" (all passed) or "RED" (one or more failed)

  ## Rules
  - Use the `bash` tool to run all commands.
  - If a command is not found or the tooling isn't installed, skip that phase gracefully.
  - Never assume a tool exists — check with `which <tool>` or test the command directly.
  - If a phase fails, stop. Report the error and do not move to the next phase.
  - Always run from the project root directory.
tools:
  - bash
  - read
  - ls
  - glob
---
