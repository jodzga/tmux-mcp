---
name: tmux-remote-troubleshoot
description: "Drive a persistent tmux pane (via the tmux MCP) to troubleshoot remote hosts and Kubernetes pods over SSH/kubectl. Use when investigating an incident, running diagnostics on a remote box or pod, or whenever you need an interactive shell whose state (login host, working dir, env) must survive across many commands. Covers bootstrapping the required aibot:aiexec session, verifying the pane's identity, and safe read-only-first execution behind a shellfirm gate."
seeded_from: "jodzga/tmux-mcp:agent-skills/tmux-remote-troubleshoot"
---

## What this skill gives you

The `tmux` MCP server drives ONE persistent tmux pane, so you can hold an interactive
remote session (an `ssh` login or a `kubectl exec`) across many tool calls. Unlike a
one-shot shell call, the pane's state — the host you're logged into, the working
directory, environment — persists between commands. That's what makes it right for
step-by-step troubleshooting on a remote box or pod.

Tools (identical names on both the Claude/isaac and Codex harnesses):
- `mcp__tmux__execute-command` — run a command in the pane, wait for it to finish,
  return its output and exit code.
- `mcp__tmux__capture-pane` — read the current pane contents (read-only); use it to
  inspect state or a program's live output.

The server is hardwired to the tmux target **`aibot:aiexec`** on the **default** tmux
socket. If that session does not exist, every tool call fails with a "start tmux"
error — so bootstrap it first.

## Step 1 — Bootstrap the pane (first thing, every session)

The box may have rebooted, or left a stale session behind, so start clean. Run this
with your ordinary shell/Bash tool (NOT the tmux MCP), on the box:

```bash
tmux kill-session -t aibot 2>/dev/null; tmux new-session -d -s aibot -n aiexec /bin/bash
```

- Uses the **default** tmux socket (no `-L`) — that is the socket the MCP drives. Do
  NOT add `-L csm`; that is the session manager's own socket and would not be seen.
- Forces `/bin/bash` for a fast, predictable shell (avoids slow zsh / oh-my-zsh init
  and keeps the `$?` exit-code markers reliable).

## Step 2 — Verify WHERE the pane is, before running anything

A pane can be left inside a previous `ssh` / `kubectl exec`. Always confirm identity
first so you never run a command on the wrong host:

```
mcp__tmux__execute-command { "command": "whoami; hostname; pwd" }
```

If you are not where you expect, `exit` back out (or re-bootstrap from Step 1) before
continuing.

## Step 3 — Connect to the remote target

From the pane, open the remote session, then run diagnostics inside it. Use key-based
auth / pre-authenticated contexts only — the MCP cannot answer an interactive password,
2FA, or host-key prompt; the command will simply hang until it times out.

- **SSH:** `mcp__tmux__execute-command { "command": "ssh <host>" }`, then subsequent
  commands run ON the remote host because the pane holds the ssh session.
- **Kubernetes:** always pass explicit `--context` AND `--namespace`, e.g.
  `kubectl --context <ctx> --namespace <ns> get pods`, or
  `kubectl --context <ctx> --namespace <ns> exec -it <pod> -- bash` to drop into a pod.

## Safety & operating rules

- **Read-only first.** Prefer diagnostics (`get`, `describe`, `logs`, `ps`, `cat`,
  `top -bn1`) before any mutating command. State WHY before each command you run.
- **shellfirm gate.** Risky commands are screened by shellfirm and **refused** — the
  tool returns "Blocked by shellfirm safety check" and does NOT execute them. Do not
  try to route around the block. Surface the warning to the human, get explicit
  approval, THEN re-invoke `execute-command` with `allowRisky: true` — for that one
  command only. (kubectl commands without `--context` are flagged for exactly this
  reason: always include `--context`.)
- **No interactive TUIs.** Never launch `top` (interactive), `htop`, `vim`, `less`,
  `watch`, or anything that takes over the screen — they never emit the completion
  marker, so the call just times out. Use non-interactive forms: `top -bn1`, `cat`,
  `tail -n`, `kubectl logs`.
- **Keep output bounded.** The pane is polled over roughly its last 1000 lines; a
  command that prints more can break output capture. Pipe through `| tail -n 200` /
  `| head` and narrow your filters.
- **Raise the timeout for slow commands.** First `kubectl` / `aws` / `gcloud` calls
  (completion loading) and remote `ssh` round-trips can take 10–60s: pass
  `{ "timeout": 60000 }` (milliseconds).
- **One session at a time.** There is a single shared pane per box — do not run two
  troubleshooting flows against it concurrently.

## Codex note

On the Codex harness, MCP tool calls work only with `gpt-5.6-sol` — the GLM model
cannot call MCP tools (a gateway limitation), so use `gpt-5.6-sol` for tmux-driven
troubleshooting.
