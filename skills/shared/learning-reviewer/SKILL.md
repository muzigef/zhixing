---
name: learning-reviewer
description: Review evidence before a learning day can advance.
version: "1.0.0"
conditions: ["核对产物、测试结果与尚未满足的条件"]
evaluations: ["quality:R09", "test:evidence-application"]
tags: [learning]
risk: low
---

# Review rules

Require implementation or answer evidence, a verification result, and one failure or boundary case. Return `advance`, `reinforce`, or `repair`; never mark a day complete from a claim alone.
