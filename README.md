# Zuri Watch - Guarded LLM Assistant

Our entry for Challenge Day 3 of the SecureAI Hackathon 2026.

## What we chose to protect

A small LLM chat assistant. A user sends a message, the assistant replies, and
the reply goes back to the user. On its own this is wide open to prompt
injection on the way in and secret leaks on the way out, so it is a realistic
thing to secure.

We wrap it with the SecureAI Guard on both sides, and we add our own layer on
top of the Guard to close a gap we found while probing it.

## What we found when we probed the Guard

We fired a set of disguised attacks at the Guard (see `probe.py`) and recorded
the result and `request_id` for each. The Guard turned out to be strong against
most of what we tried. It blocked the plain injection, base64 payloads,
leetspeak, invisible zero-width characters, look-alike (homoglyph) characters,
an isiZulu injection, the multi-turn trigger, a system-prompt leak, and a card
number in the response.

The one attack that got through was an injection written in **Twi**, a widely
spoken Ghanaian language:

```
[language] Twi injection   ALLOWED   request_id=31e9bde94251
```

isiZulu was caught but Twi was not, which points to a gap in the Guard's
coverage of some lower-resource languages. That is the weakness our layer
targets.

Note: the Twi test sentence should be confirmed by a fluent speaker before the
demo, so we are certain it really carries the injection and is not just harmless
text the Guard reasonably allowed.

## What we built

- A full guarded pipeline (`pipeline.py`) that runs every message through the
  Guard on the way in, only calls the LLM if the prompt passes, then runs the
  reply through the Guard on the way out.
- A response-side canary check: we plant a secret token in the assistant's
  system prompt and block any reply that contains it. A leaked secret does not
  look "harmful" to a content classifier, so this catches something the Guard
  alone would not.
- Fail-closed behaviour: if the Guard errors or cannot be reached, the message
  is dropped rather than passed through to the model.
- A normalising step (`normalizer.py`) that un-disguises a prompt (strips
  invisible characters, folds look-alike letters, decodes base64, de-leetspeaks)
  and screens each recovered form. Our probing showed the Guard already catches
  these, so for us this is defence in depth rather than the main contribution.

The main contribution is the language-gap layer that closes the Twi bypass
above. See the Status section for where that stands.

## Layout

| File            | What it does                                                        |
|-----------------|---------------------------------------------------------------------|
| `pipeline.py`   | The full guarded path: prompt -> Guard -> LLM -> Guard -> response check. |
| `guard.py`      | A small client for the SecureAI Guard API.                          |
| `llm.py`        | Sends a prompt to the LLM and returns the reply.                    |
| `normalizer.py` | Un-disguises a prompt (encodings, homoglyphs, zero-width).          |
| `probe.py`      | Probes the Guard with disguised attacks and reports what got through.|
| `config.py`     | Loads settings from the environment or a local `.env` file.         |
| `.env.example`  | Template for the settings. Copy to `.env` and fill in.              |

## Requirements

- Python 3 (standard library only, nothing to pip install).
- An internet connection (the scripts call the Guard and the LLM over HTTPS).

Check Python is installed:

- Windows: `py --version`
- Mac or Linux: `python3 --version`

If Windows says Python was not found, install it from python.org and tick
**Add Python to PATH** during setup, then reopen your terminal.

## Setup, step by step

### 1. Get the code and open a terminal in the folder

If you cloned the repo:

```
git clone https://github.com/ZukoG/zuri-watch-guard.git
cd zuri-watch-guard
```

If you downloaded a zip, unzip it, then open a terminal inside the folder that
contains `README.md` and the `.py` files:

- Windows: open that folder in File Explorer, click the address bar, type `cmd`
  (or `powershell`), and press Enter. The terminal opens already pointing at the
  folder.
- Mac or Linux: right-click the folder and choose "Open Terminal here", or
  `cd` into it.

### 2. Create your settings file (`.env`)

This file holds your secret token. It is listed in `.gitignore`, so it is never
committed to the repository.

**Windows (PowerShell), recommended.** This writes the file in one command, so
there is no editor to remember to save. Replace the two placeholder values with
the real token and LLM key from the organizers:

```
Set-Content -Encoding ascii .env "GUARD_URL=https://secureai-guard-598609297408.europe-west4.run.app`nGUARD_TOKEN=sai_REPLACE_WITH_YOUR_TOKEN`nLLM_API_KEY=sk-proj-REPLACE_WITH_YOUR_KEY"
```

To check what the file ended up containing:

```
type .env
```

**Windows, with Notepad instead.** If you prefer an editor, make sure you
actually save:

```
copy .env.example .env
notepad .env
```

In Notepad, set the `GUARD_TOKEN=` line to your real `sai_...` token (and the
LLM key if you will run `pipeline.py`), then **File > Save** (or Ctrl+S) before
you close the window. If you skip the save, the file keeps the placeholder text
and every call comes back `401 unauthorized`.

**Mac or Linux:**

```
cp .env.example .env
nano .env
```

Set `GUARD_TOKEN` to your real token, then save with Ctrl+O, Enter, and exit
with Ctrl+X.

### 3. Confirm your token works

This asks the Guard how much of your quota you have used. It needs the token, so
it is a quick way to prove the token is right before running anything else.

Windows:

```
curl.exe -s -H "Authorization: Bearer sai_REPLACE_WITH_YOUR_TOKEN" "https://secureai-guard-598609297408.europe-west4.run.app/v1/usage"
```

Mac or Linux:

```
curl -s -H "Authorization: Bearer sai_REPLACE_WITH_YOUR_TOKEN" "https://secureai-guard-598609297408.europe-west4.run.app/v1/usage"
```

A correct token prints your team name and quota, for example
`{"daily_limit":1000,"per_minute_limit":30,"team":"Zuri Watch","used_today":0}`.
If you get `401 unauthorized`, the token is wrong or the `.env` was not saved.

## Running it

Use `py` on Windows and `python3` on Mac or Linux.

**See which disguised attacks get past the Guard:**

```
py probe.py
```
```
python3 probe.py
```

It prints a verdict and `request_id` for each test, then a summary of any
bypasses it found. The three of you share 30 calls a minute and 1,000 a day, so
run it once and coordinate timing with your teammates.

**Run the guarded assistant on a single message** (this one needs `LLM_API_KEY`
set in `.env`):

```
py pipeline.py "What is the capital of Ghana?"
```
```
python3 pipeline.py "What is the capital of Ghana?"
```

Run it with no message to watch it handle a benign question, a plain injection,
and a disguised injection in turn:

```
py pipeline.py
```

## Troubleshooting

- **`python3` not recognised, or "Python was not found" (Windows):** use `py`
  instead. If that also fails, install Python from python.org with "Add Python
  to PATH".
- **`401 unauthorized`:** your `.env` still has the placeholder token. This
  usually means Notepad was not saved. Recreate the file with the `Set-Content`
  command in step 2 and re-check with the usage command in step 3.
- **`Missing settings: GUARD_URL, GUARD_TOKEN`:** there is no `.env` in the
  current folder. Make sure you created it in the same folder as the `.py` files.
- **`not a git repository`:** you are in the wrong folder. `cd` into the folder
  that contains `README.md`.
- **`429 rate_limited` or `daily_quota_exceeded`:** you have hit the shared
  limit. Wait a minute, or check usage with the command in step 3.

## A note on the token

The Guard token and the LLM key are secrets. They live only in your local
`.env` file, never in this repository, never in the slides, and never in a
screenshot. Anyone who reads the LLM key can spend against it.

## Status

Done: probing, the guarded pipeline, the response-side canary check, fail-closed
behaviour, and the normalising step. In progress: the language-gap layer that
translates non-English input to English and screens that too, to close the Twi
bypass we found.

## Team

Zuri Watch, WeThinkCode_: Zuko Gutyungwa, Symphorose Tshibombi, Clen Bongane.
