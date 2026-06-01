# MindWiki — LLM Pipeline
# Full prompt templates and service implementations.
# Models: Qwen2.5 1.5B (fast/tag), Qwen2.5 3B (deep/wiki), Qwen2.5 7B+ (weekly)
# All prompts in src/services/llm/prompts/ as TypeScript template strings.
# All LLM output validated with Zod before use.
# Retry: max 3 attempts with exponential backoff. After 3 failures: mark entry is_processed=-1.
# NEVER log entry.content in error paths.
