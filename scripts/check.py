#!/usr/bin/env python3
"""Repo self-check for resolve-issue. Stdlib only. Run: python3 scripts/check.py

1. Coverage: every lesson in references/lessons.md (id = section code + number,
   e.g. DG-7) is cited as [DG-7] somewhere else in the skill. A lesson that is
   only listed, never applied, fails.  [TG-23, TG-26]
2. Dangling citations: every [XX-N] cited exists in the catalogue.
3. Privacy: no email address except the public credit line's domain, no IPv4
   address, nothing key-shaped.  [PS-1, PS-4]
4. SKILL.md stays under 500 lines (progressive disclosure).
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
LESSONS = ROOT / "references" / "lessons.md"
TEXT_EXT = {".md", ".js", ".yml", ".yaml", ".py", ".sh", ".txt", ""}


def tracked_files():
    for p in ROOT.rglob("*"):
        if p.is_file() and ".git" not in p.parts and p.suffix in TEXT_EXT:
            yield p


def catalogue():
    ids, code = set(), None
    for line in LESSONS.read_text().splitlines():
        m = re.match(r"^## \d+\. .+ \(([A-Z]{2})\)$", line)
        if m:
            code = m.group(1)
            continue
        m = re.match(r"^(\d+)\. \*\*", line)
        if m and code:
            ids.add(f"{code}-{m.group(1)}")
    return ids


def main():
    errors = []
    ids = catalogue()
    cited = set()
    for p in tracked_files():
        if p == LESSONS:
            continue
        # citations look like [DG-1] or [PF-4, PF-5, SP-11]
        for group in re.findall(r"\[((?:[A-Z]{2}-\d+)(?:,\s*[A-Z]{2}-\d+)*)\]", p.read_text(errors="ignore")):
            cited |= set(re.split(r",\s*", group))

    missing = sorted(ids - cited, key=lambda s: (s[:2], int(s[3:])))
    dangling = sorted(cited - ids)
    if missing:
        errors.append(f"{len(missing)} lessons never applied: {' '.join(missing)}")
    if dangling:
        errors.append(f"citations with no lesson: {' '.join(dangling)}")

    email = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
    ipv4 = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
    keyish = re.compile(r"\b(?:sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,})")
    allowed_email = {"noreply@anthropic.com"}  # commit trailer, public
    for p in tracked_files():
        if p.name == "check.py":
            continue
        for i, line in enumerate(p.read_text(errors="ignore").splitlines(), 1):
            for e in email.findall(line):
                if e not in allowed_email and not e.endswith("@example.com"):
                    errors.append(f"{p.relative_to(ROOT)}:{i}: email {e}")
            for ip in ipv4.findall(line):
                if not ip.startswith(("127.", "0.0.0.0")):
                    errors.append(f"{p.relative_to(ROOT)}:{i}: IPv4 {ip}")
            if keyish.search(line):
                errors.append(f"{p.relative_to(ROOT)}:{i}: key-shaped string")

    n = len((ROOT / "SKILL.md").read_text().splitlines()) if (ROOT / "SKILL.md").exists() else 0
    if n >= 500:
        errors.append(f"SKILL.md is {n} lines (limit 500)")

    print(f"lessons: {len(ids)}, cited: {len(ids & cited)}")
    for e in errors:
        print("FAIL", e)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
