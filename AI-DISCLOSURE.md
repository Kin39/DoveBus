# How DoveBus was built

DoveBus was developed with a great deal of help from an AI coding assistant. This
file states who did what, so that nobody has to infer it from the commit
history.

It also exists for a practical reason. The project intends to apply to the
[NLnet Foundation](https://nlnet.nl), whose
[policy on generative AI](https://nlnet.nl/foundation/policies/generativeAI/)
asks for AI use to be disclosed and for the provenance of generated code to be
clear. The disclosure would be owed even without that policy.

*Last updated: 20 October 2026.*

## In short

The author designed DoveBus, directed its development, tested it on real buses,
read and reviewed the code, and approved every change. An AI assistant, working
under that direction, wrote most of the code, the tests, the documentation and
the commit messages.

## What the author did

The author drives buses on the Tuscan network and previously worked as a web
designer. The idea and the field testing come from the first job; the visual
design and the ability to read and review the code come from the second.

- **The idea:** a map that answers "where is the bus now" for the Tuscan network
  the author drives on.
- **The principles** it is built on: every position states its age, no client
  ever reaches the source feed, and nothing about the reader is kept.
- **The scope and the product decisions:** the two search modes, direct runs only,
  and what the map shows and what it hides.
- **The visual design** of the site, the map and its panels, and how they behave.
- **Field testing** on real buses, on real routes.
- **Finding the logic errors** and directing their fixes. Some turned up in the
  field; others came from reading the code.
- **The verification method:** an automated screenshot loop run at every screen
  size, and checking behaviour against the live feed instead of assuming it.
- **Review:** reading the code and approving every change before it was
  committed and deployed.

## What the AI did

The tool was [Claude Code](https://claude.com/claude-code), Anthropic's coding
agent, with two models:

| Model | When |
|---|---|
| `claude-opus-4-8` | 11–12 August 2026, the first measurements of the feeds |
| `claude-opus-5` | 12 August – 19 October 2026 |
| `claude-sonnet-5` | 28 September 2026, one session |
| `claude-opus-5-5` | from 19 October 2026 onward |

Working from the author's direction, it:

- wrote most of the code, the tests, the documentation and the commit messages;
- worked out the geometry and arithmetic behind vehicle tracking;
- read and organised the Regione Toscana GTFS and GTFS-Realtime feeds, and
  measured how they behave (publishing cadence, join rates, how old a position
  already is when it arrives) before the product code was written;
- refactored code where it was needed;
- helped with the security rules, and with how work and load are split between
  client and server, for the API, the site and the repository;
- ran an SEO audit of the public site, and built the per-line and per-comune
  pages that came out of it;
- measured what the API still lacks to be a public open API, including a trial
  import of a second region's feed (Rome), and fixed a slow search it found;
- produced the code reviews kept in `.claude/reviews/`.

## By the numbers

These figures come from the Claude Code session logs for this project: 27
sessions between 11 August and 20 October 2026.

- **201 of the 224** source and documentation files tracked in this repository
  were written or modified through the AI's file-editing tools. The count is a
  lower bound: it cannot see files the AI wrote through shell commands, which
  it also did.
- The commits in this repository were made by the AI, at the author's request.

## How AI-written changes are marked

- **Up to 11 September 2026, commits do not name the AI.** This file is the
  record for that period: read the history before that date as written by the
  AI under the author's direction and review, as described above.
- **From 11 September 2026, every commit written with the AI carries a
  `Co-Authored-By:` trailer naming the model.** The first is `50f0ab0`, which
  changed the licence.
- Contributors who use AI tools are asked to do the same (see *Contributing* in
  the [README](README.md)).

## What this does not mean

The AI did not decide what DoveBus is, never rode a bus to test it, and shipped
nothing the author had not reviewed. It is equally true that most of the code
was not typed by the author. Both statements are here so that neither has to be
guessed.

## The NLnet proposal

The AI is also helping with the proposal this project is submitting to NLnet.
It measured and prepared the project's figures and the task estimates. The
author writes the answers in Italian, in their own words; the AI organises,
corrects and translates them into English without adding ideas of its own, and
the author reviews the result by hand. The proposal discloses this and attaches
the log of that work.
