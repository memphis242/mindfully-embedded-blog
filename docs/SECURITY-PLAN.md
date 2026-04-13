# Software Security Development Plan

This document defines security hardening for `cwe-man` as a networked TUI client that fetches and processes untrusted REST API content and persists it locally.

## 1) Multi-Layer Fuzz Testing
- Internal function fuzzing in-process using `libFuzzer` or `AFL++` with `ASan` + `UBSan`.
- Inter-module fuzzing across parser, repository, and state-transition boundaries.
- App-level harness fuzzing focused on command/filter/search/event flows and sync payload handling.

## 2) CWE/CVE Record Analysis
- Maintain manual/automated scans of code against applicable CWE classes (input validation, path handling, deserialization, resource exhaustion, race conditions).
- Track CVEs for runtime dependencies and toolchain packages used by the project (`libcurl`, SQLite, `nlohmann_json`, FTXUI where applicable).
- Enumerate system interactions (filesystem, environment variables, network calls, threading) and test abuse scenarios with automated harnesses.

## 3) Agentic Security Analysis
- Use AI-agent assisted code review passes for vulnerability discovery and security test generation.
- Treat agent findings as triage input and confirm with deterministic tests before merge.

## 4) Chaos/Resilience Runs
- Run nightly resilience jobs with varied instrumentation (sanitizers, memory diagnostics, fuzz jobs, adversarial payload suites).
- Include fault-injection style scenarios for network errors, partial API responses, and local storage failures.

## 5) Protect Against Application Misuse
- Validate and constrain user inputs/commands and file output paths.
- Keep runtime data under `$HOME/.cwe-man` and avoid unintended writes outside expected locations.
- Ensure fault simulation and testing modes cannot damage host system state.

## 6) Dependency Scans
- Regular scans of dependency libraries for security vulnerabilities should be done>
