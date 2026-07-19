# Memory Engine

This directory is memory for the AI-Kit installer and runtime itself. It is
shared device knowledge and is not loaded into consuming project contexts.

Project-specific durable decisions belong in the consuming project's
`.ai-memory/` directory. Record a decision with its context, chosen option,
consequences, and review date; do not retain raw chat history as project memory.
