---
name: tool-contract
description: Design a tool schema, permission boundary, error shape, and negative tests.
version: "1.0.0"
conditions: ["设计工具输入、授权范围和失败恢复"]
evaluations: ["quality:R07", "test:tool-harness"]
tags: [learning, tools]
risk: low
---

# Tool contract

Define input/output schemas before implementation. Include invalid input and timeout or permission failure tests.
