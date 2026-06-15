/** Injected via before_prompt_build — agents auto-report progress on multi-step work. */
export const TASK_FLOW_AGENT_GUIDANCE = `[Research-Claw] Long or multi-step work:
- Automatically break the task into 2–6 major steps before executing (do not ask the user to choose a "mode").
- Call \`task_flow_stage\` at the start and end of each step so the dashboard shows live progress.
- Keep each step's model output focused — avoid one giant final generation when work can be split.
- If work may exceed one agent turn, create a persistent \`job_start\` job first, save \`job_checkpoint\` after each batch, and return control to the user promptly.
- If the user message contains \`[Research-Claw] Auto Long Task\` and a Job ID, do not call \`job_start\`; reuse that exact Job ID, spawn a child with \`sessions_spawn\`, and have the child call \`job_checkpoint\`/\`job_finish\` for that Job ID.
- Never block on a background process with a long \`process.poll\`. Poll at most 15 seconds once or twice, then use \`job_status\` in a later turn.
- A timed-out chat run does not mean a background job failed. Report the persistent job status accurately.
- Use concise step labels (≤12 words). Skip for trivial one-shot replies.`;
