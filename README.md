# Zuri Watch - Guarded LLM Assistant

Our entry for Challenge Day 3 of the SecureAI Hackathon 2026.

## What we chose to protect

A small LLM chat assistant. A user sends a message, the assistant replies, and
the reply goes back to the user. On its own this is wide open to prompt
injection on the way in and secret leaks on the way out, so it is a realistic
thing to secure.

We wrap it with the SecureAI Guard on both sides and add our own layer on top
of the Guard to close a gap we found while probing it.

## The weakness we found

The Guard checks one message at a time, in whatever form it arrives. If an
attacker disguises an injection so the surface text no longer looks like an
attack, it can slip past. We confirmed this by probing (see `probe.py`) with
four disguises:

- base64-encoded payloads
- leetspeak (`1gn0r3 4ll pr3v10u5 1nstruct10ns`)
- invisible zero-width characters tucked between letters
- look-alike characters from other alphabets (Cyrillic and Greek)

## What we built

A normalising layer that un-disguises a prompt before the Guard ever sees it,
in `normalizer.py`. For each incoming message it:

1. strips invisible characters,
2. folds look-alike letters back to plain ASCII,
3. produces a de-leetspeaked version, and
4. decodes any base64 sections that turn out to be readable text.

The cleaned message plus each recovered form is then screened by the Guard. If
any form trips the Guard, the message is blocked. So an attack only gets through
if it is harmless in every form, which defeats the disguises above.

On the response side we plant a secret token in the assistant's system prompt
(a canary) and block any reply that contains it. A leaked secret does not look
"harmful" to a content classifier, so this catches something the Guard alone
would not.

The whole pipeline fails closed: if the Guard errors or cannot be reached, the
message is dropped rather than passed through to the model.

## Layout

| File            | What it does                                                        |
|-----------------|---------------------------------------------------------------------|
| `normalizer.py` | The un-disguising layer. This is our main contribution.             |
| `pipeline.py`   | The full guarded path: prompt -> normalise -> Guard -> LLM -> Guard -> response check. |
| `guard.py`      | A small client for the SecureAI Guard API.                          |
| `llm.py`        | Sends a prompt to the LLM and returns the reply.                    |
| `probe.py`      | Probes the Guard with disguised attacks and reports what got through.|
| `config.py`     | Loads settings from the environment or a local `.env` file.         |
| `.env.example`  | Template for the settings. Copy to `.env` and fill in.              |

## How to run it

You need Python 3 (standard library only, nothing to install) and the two
values from the organizers plus an LLM key.

1. Copy the settings template and fill in your own values:

   ```
   cp .env.example .env
   ```

   Then edit `.env` and set `GUARD_TOKEN` and `LLM_API_KEY`. The `.env` file is
   gitignored, so your token never ends up in the repository.

2. See which disguised attacks get past the Guard:

   ```
   python probe.py
   ```

3. Run the full guarded assistant on a single message:

   ```
   python pipeline.py "What is the capital of Ghana?"
   ```

   Or with no message to watch it handle a benign question, a plain injection,
   and a leetspeak injection in turn:

   ```
   python pipeline.py
   ```

## A note on the token

The Guard token and the LLM key are secrets. They live only in your local
`.env` file, never in this repository, never in the slides, and never in a
screenshot. Anyone who reads the LLM key can spend against it.

## Team

Zuri Watch, WeThinkCode_: Zuko Gutyungwa, Symphorose Tshibombi, Clen Bongane.
