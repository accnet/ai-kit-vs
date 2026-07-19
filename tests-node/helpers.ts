// Shared test helpers so individual tests don't re-implement workflow seeding.
import * as board from "../.ai/node/board.js";

// Create a fresh registered workflow with a single runnable task and return its id.
export function seedWorkflow(options: { owner?: string; title?: string } = {}): string {
  const id = `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  board.createWorkflow(options.title ?? "Seed", "feature", id, "planner");
  board.addTask({
    workflow_id: id,
    id: "T1",
    title: "first",
    owner: options.owner ?? "backend",
    phase: "build",
    acceptance: ["done"],
  });
  return id;
}
