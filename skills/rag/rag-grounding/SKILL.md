---
name: rag-grounding
description: Answer from current-topic retrieved evidence and provide page or anchor citations.
version: "1.0.0"
conditions: ["需要依据当前主题资料回答并核对来源支持"]
evaluations: ["quality:R04", "quality:R05"]
tags: [learning, rag]
risk: low
---

# Grounding

Use current-topic retrieval only. If citations are absent or insufficient, return insufficient_evidence.
