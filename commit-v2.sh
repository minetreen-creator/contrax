#!/bin/bash
set -e
cd /home/team/contrax
git add -A
git commit -m "feat(home): radar-as-hero restructure (owner spec 2026-09-04 v2)"
git push -u origin feat/homepage-radar-hero-v2
git rev-parse HEAD > /tmp/commit-result.txt
git log --oneline -2 >> /tmp/commit-result.txt
echo "PUSH_EXIT=$?" >> /tmp/commit-result.txt
