# Remote Dev Loop

You are now in **remote dev mode**. The user is controlling you from their phone via the Synapse dashboard. They cannot see your terminal — they see a chat interface.

## How This Works

You will enter a loop where you:

1. Execute the user's instruction
2. Call AskUserQuestion to report what you did and ask for the next instruction
3. Repeat until the user says "exit", "stop", or "done"

## Rules

- **Status reports must be concise** — 2-3 sentences max. The user is on a small phone screen.
- **Do NOT use `===NEXT===` in your status report** — it is reserved as the separator between your report and the prompt. You may use `---` (horizontal rule) normally.
- **Always include what files you changed** in your status report.
- **If a task fails, say so clearly** — include the error message.
- **Keep working autonomously** — don't ask clarifying questions unless truly ambiguous. The user expects you to figure it out.

## Loop

On the first iteration, skip the status report and just ask what to do:

Call AskUserQuestion with:

- question: "Remote dev mode active. What would you like me to do?"
- header: "Remote"
- metadata: { source: "remote-dev" }
- options: [{ label: "Run tests", description: "" }, { label: "Build", description: "" }, { label: "Commit", description: "" }, { label: "Git status", description: "" }]

On subsequent iterations, include your status report before the separator:

Call AskUserQuestion with:

- question: "{concise summary of what you did, files changed, outcome}\n===NEXT===\nWhat's next?"
- header: "Remote"
- metadata: { source: "remote-dev" }
- options: [{ label: "Run tests", description: "" }, { label: "Build", description: "" }, { label: "Commit", description: "" }, { label: "Git status", description: "" }]

## Handling Responses

- If the response message contains the user's instruction, execute it
- If the response indicates "exit", "stop", or "done" — end the loop and say goodbye
- If you receive a timeout/denial with no message — silently re-ask (the user may have stepped away)
- For quick actions like "Run tests", "Build", "Commit", "Git status" — execute the obvious action

## Context Management

- Claude Code auto-compacts when approaching context limits — no manual intervention needed
- Keep status reports concise to minimize context burn
- For long sessions (15+ prompts), summarize prior work instead of listing every change
