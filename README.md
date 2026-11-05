# Durable Execution Field Guide

**A free, hands-on course on durable execution, from first principles to real support incidents, built on [Restate](https://restate.dev) and [Temporal](https://temporal.io).**

[![CI](https://github.com/skeilson/durable-execution-field-guide/actions/workflows/ci.yml/badge.svg)](https://github.com/skeilson/durable-execution-field-guide/actions/workflows/ci.yml)
· **[Open the interactive course →](https://skeilson.github.io/durable-execution-field-guide/)**

Durable execution lets ordinary code survive crashes, restarts and deploys: every step's result is recorded, and after a failure the code replays from that record instead of starting over. It's becoming the backbone of payments, order pipelines and AI agents.

This course teaches it from zero. No prior knowledge of durable execution is assumed, and very little programming. You'll build a durable execution engine yourself, implement the same online shop on both Restate and Temporal, and work through seven reproducible support incidents, each with a diagnosis, a customer reply and a runbook entry.

## Who it's for

- Anyone curious how durable execution actually works under the hood
- Developers evaluating Restate or Temporal who want to see both side by side
- Support engineers, solutions engineers and developer advocates working with these tools, or hoping to learn a bit more about basic durable execution principles

## What's inside

| Module | What you learn | Hands-on |
| --- | --- | --- |
| [0 · Orientation](modules/00-orientation/) | Setup, terminal basics, reading TypeScript | — |
| [1 · The problem](modules/01-the-problem/) | Partial failure, ambiguous failures, why naive retries make it worse | `npm run m1` |
| [2 · Core ideas](modules/02-core-ideas/) | Build a durable engine in six versions: journal, replay, at-least-once, idempotency, retries, determinism, timers | `npm run m2` |
| [3 · Restate](modules/03-restate/) | Services, `ctx.run`, calls and sends, retries and `TerminalError`, suspension, virtual objects, workflows, awakeables, sagas, CLI/UI/SQL | `npm run m3` |
| [4 · Temporal](modules/04-temporal/) | Workflows and activities, workers and task queues, failures, timers, signals/queries/updates, continue-as-new, sagas, patching and replay tests *(being verified, see below)* | `npm run m4` |
| [5 · Side by side](modules/05-side-by-side/) | One concept map, two vocabularies; how failures look on each; when to choose which | — |
| [6 · Incidents](modules/06-incidents/) | Seven support tickets reproduced, diagnosed, fixed and written up | `npm run m6` |
| [7 · Production](modules/07-production/) | Versioning, observability, scaling, serverless, security, hosting | — |
| [8 · Supporting customers](modules/08-supporting-customers/) | Reading tickets, writing replies, runbooks, knowledge-base articles, eight ticket simulations | — |

### The incidents

| # | Ticket | Root cause |
| --- | --- | --- |
| [6.1](modules/06-incidents/lessons/6.1-crash-mid-order.md) | "Service crashed mid-checkout, are orders lost?" | Nothing lost: invocations backing off until the service returned |
| [6.2](modules/06-incidents/lessons/6.2-the-double-charge.md) | "Restate charged a customer twice!" | Ambiguous timeout + payment call without an idempotency key |
| [6.3](modules/06-incidents/lessons/6.3-the-bad-deploy.md) | "Orders stuck after deploy: code path mismatch" | Step inserted mid-handler + in-place `--force` deployment |
| [6.4](modules/06-incidents/lessons/6.4-the-silent-retries.md) | "Stock levels frozen since yesterday" | Revoked API key retried silently as a transient error |
| [6.5](modules/06-incidents/lessons/6.5-the-timeout-duplicates.md) | "Two orders from one tap" | Client timeout + retry without an ingress idempotency key |
| [6.6](modules/06-incidents/lessons/6.6-the-hot-key.md) | "Cart slow for some customers" | Slow exclusive handler blocking a virtual object key |
| [6.7](modules/06-incidents/lessons/6.7-nobody-is-listening.md) | "Service not found, Restate is broken?" | Deployment never registered |

The companies and people in the incidents are fictional.

## Quick start

New to running code? Start with **[lesson 0.2](modules/00-orientation/lessons/0.2-setup.md)**.

```bash
git clone https://github.com/skeilson/durable-execution-field-guide.git
cd durable-execution-field-guide
npm install
npm run m1        # Module 1: watch a checkout break
npm run m2 -- 2.3 # one lesson from Module 2
```

Requirements: Node.js 20+ on macOS or Linux (Windows via WSL). `npm install` brings the Restate server and CLI. Module 4 also needs the [Temporal CLI](modules/04-temporal/lessons/4.2-dev-server-and-ui.md) (`brew install temporal`).

Every lesson asks you to **predict** what will happen before it runs. Commit to a guess: being wrong and seeing why is how it sticks.

## Project status

| Part | Status |
| --- | --- |
| Modules 0–8 (lessons and quizzes) | Complete |
| Modules 1–3 and 6 (hands-on) | Every lesson and incident verified end to end against a real Restate server |
| Module 4 (Temporal) | **Being verified.** The code type-checks and builds with Temporal's bundler; the hands-on lessons are being confirmed against a live Temporal server. Reports welcome. |

## How it's built

```
modules/
  00-orientation … 08-supporting-customers/
    lessons/*.md        lesson text (also rendered into the interactive site)
    quiz.json           end-of-module check
    README.md           generated module overview
  02-core-ideas/engine/ the from-scratch engine, v1 → v6
  03-restate/shop/      the shop on Restate
  04-temporal/shop/     the same shop on Temporal
  06-incidents/         incident services and the incident runner
shared/                 fake bank/warehouse/carrier with fault injection; Restate and Temporal harnesses
site-src/               builds the interactive course (npm run build:site)
```

The "outside world" (bank, warehouse, carrier) is faked with a ledger file, and can be told to fail, hang, decline or lose its response, so every lesson can check what *really* happened, not just what the engine thinks happened.

[CI](.github/workflows/ci.yml) runs every hands-on lesson and incident on each push, against real Restate and Temporal servers, and [publishes](.github/workflows/pages.yml) the interactive course to GitHub Pages.

## Contributing

Corrections and contributions are very welcome, especially from people who know Restate or Temporal well.

- **Found a mistake, or a lesson that confused you?** [Open an issue](https://github.com/skeilson/durable-execution-field-guide/issues) with the lesson number, what you expected, and any terminal output.
- **Want to fix it yourself?** Edit the lesson's Markdown in `modules/*/lessons/`, run `npm run build:site` to regenerate the site and module READMEs, and open a pull request. CI will run the hands-on lessons against your change.
- **Ideas for new content** (incidents, ticket simulations, quiz questions, other languages) are welcome as issues first, so we can agree on the shape before you write it.

When something here disagrees with the official [Restate](https://docs.restate.dev) or [Temporal](https://docs.temporal.io) docs, the official docs win.

## About

Created by skeilson while learning durable execution, and shared so others can learn it faster. Written with AI assistance, and checked by running the hands-on lessons against real servers.

This is an independent learning project. It is **not affiliated with, sponsored by or endorsed by** Restate or Temporal Technologies. Product names are used only to describe what the course teaches.

## Versions

Restate server and CLI 1.8.1 · Restate TypeScript SDK 1.17.4 · Temporal TypeScript SDK 1.24.0 · Node.js 22

## License

Code is released under the [MIT License](LICENSE).
