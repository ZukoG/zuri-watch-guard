# Zuri Watch - Guarded LLM Assistant

Our entry for Challenge 3 (Day 3) of the SecureAI Hackathon 2026, hosted by
CAIRLab-KNUST.

**In one line:** we tested the SecureAI Guard systematically, found it holds up
well, and built a layer around it that checks messages and replies in any
language, refuses to fail open, and catches leaked secrets. We are also open
about the one result we could not confirm.

**Team:** Zuko Gutyungwa, Symphorose Tshibombi, Clen Bongane (WeThinkCode_).

---

## Contents

1. [The challenge](#1-the-challenge)
2. [What we did](#2-what-we-did)
3. [What we found](#3-what-we-found)
4. [What we built](#4-what-we-built)
5. [How a message travels through the system](#5-how-a-message-travels-through-the-system)
6. [The files](#6-the-files)
7. [Setup, step by step](#7-setup-step-by-step)
8. [Every command, and when to use it](#8-every-command-and-when-to-use-it)
9. ["I want to..." scenarios](#9-i-want-to-scenarios)
10. [Reading the output](#10-reading-the-output)
11. [What we could not solve](#11-what-we-could-not-solve)
12. [Troubleshooting](#12-troubleshooting)
13. [Keeping secrets safe](#13-keeping-secrets-safe)

---

## 1. The challenge

The organizers gave each team two things:

- the **SecureAI Guard API**, a service that reads a piece of text and says
  whether it should be allowed through, and
- an **LLM API**, a language model that answers messages.

Our task was to **find a weakness in the Guard ourselves**, then build a small
system that adds an extra layer of protection on top of it. The prototype had
to do three things:

1. show a weakness in the Guard,
2. show our system addressing it,
3. run as a working demo with the Guard and the LLM.

Judging is done by people on demo day, on innovation and creativity. There is
no automated scoring.

## 2. What we did

1. **Listed where the Guard might be weak:** messages split across several
   turns, disguised text (encodings, hidden characters, look-alike letters),
   other languages, how apps behave when the Guard is down, and leaks in the
   model's replies.
2. **Built a probe** (`probe.py`) that sends a set of test messages to the
   Guard and records the verdict and `request_id` of each one.
3. **Built a guarded assistant** (`pipeline.py`) that checks every message
   before the model sees it and every reply before the user sees it.
4. **Ran the probe against the real Guard.** It blocked almost everything. One
   Twi test sentence got through.
5. **Built a language layer** (`translator.py`, `layer.py`) that translates
   messages and replies into English so the Guard judges them in the language
   it handles best.
6. **Tested the layer live, and checked our own finding.** Our Twi sentence did
   not hold up as a clear attack (details in section 3), so we report it as
   unconfirmed rather than as a proven bypass.
7. **Wrote offline tests** (`tests/`) that check the layer's logic without
   using the network or the shared quota.

## 3. What we found

**The Guard is strong.** It blocked a plain prompt injection, encoded and
disguised versions of it, a multi-turn attempt, the same injection in isiZulu,
a reply leaking a secret, and a reply containing a card number.

**One Twi test sentence got past the Guard on its own**, twice
(`request_id` `31e9bde94251` and `e573aa38d5d9`). We first read this as a gap in
the Guard's coverage of Twi. When we checked further:

- our Twi sentence was a rough translation, and the model translated it back as
  something harmless ("the initial setup will show you all the details of your
  system"),
- the model did not act on it; it replied politely without leaking anything,
- a clearer Twi version was blocked by the Guard on its own
  (`request_id` `04b3e94790e0`).

So the Twi result is **unconfirmed**. It may simply be awkward wording rather
than a blind spot, and we could not get a fluent speaker to settle it. We would
rather say that than overclaim.

## 4. What we built

Our layer sits around the Guard. The Guard is still the main check; the layer
adds what the Guard cannot do on its own.

| Part | What it does | Why |
|------|--------------|-----|
| **Language layer** (`translator.py`, `layer.py`) | Translates each message into English, then sends **both** the original and the English version to the Guard. If either is flagged, the message is blocked. Replies get the same treatment. | A safety check is only as good as its understanding of the language. Translating gives the Guard a second look in the language it handles best, in both directions. |
| **Fail closed** | If the Guard or the translator cannot be reached, the message is blocked instead of let through. | A simple app often fails open, so an outage would quietly switch off all protection. |
| **Canary check** | We hide a fake secret (`CANARY-7F3A-DEMO`) in the assistant's instructions and block any reply that contains it. | If the model is ever tricked into revealing its instructions, the secret gives it away, even if the reply looks harmless. |
| **Normaliser** (`normalizer.py`) | Removes hidden characters, fixes look-alike letters, and decodes encoded text, then checks each version. | Extra safety. The Guard catches these today, and this keeps us covered if that changes. |
| **Before and after modes** | `--guard-only` and `--compare` in `pipeline.py` and `probe.py`. | So anyone can see exactly what our layer adds compared with the Guard alone. |
| **Offline tests** (`tests/`) | 17 tests with stand-ins for the Guard and the LLM. | Proves the layer's logic without a token, a key, or quota. |

The translator also protects itself:

- If it refuses to translate, we treat that as a warning sign and block.
- If the translation comes back suspiciously short, we assume it was tampered
  with and block.
- A message cannot break out of the translator's input wrapper.
- The translator holds no secrets, so there is nothing to leak from it.

**Measured cost:** in our live run, a message took about **3.6 seconds** with
the Guard alone and about **6.1 seconds** with full protection, so the layer
adds roughly 2.5 seconds, mostly from the translation calls.

## 5. How a message travels through the system

```
User message
   |
   v
Normaliser .................. removes disguises (hidden characters, encodings)
   |
   v
Translator .................. makes an English version   (blocked if it fails)
   |
   v
Guard checks the prompt ..... original AND English        (any flag = BLOCKED)
   |
   v
LLM writes a reply
   |
   v
Translator .................. English version of the reply
   |
   v
Guard checks the reply ...... original AND English        (any flag = BLOCKED)
   |
   v
Canary check ................ secret in the reply?         (yes = BLOCKED)
   |
   v
User sees the reply
```

If the Guard cannot be reached at any step, the message is blocked (fail closed).

## 6. The files

| File | What it is |
|------|------------|
| `pipeline.py` | The guarded assistant. This is what we demo. |
| `layer.py` | Our protection layer. Decides what is safe, using the files below. |
| `translator.py` | Translates text into English and checks the translation can be trusted. |
| `normalizer.py` | Removes disguises from text. |
| `guard.py` | Talks to the SecureAI Guard. Spaces calls out and retries once if rate limited. |
| `llm.py` | Talks to the language model, for both replies and translation. |
| `probe.py` | Our testing tool. Sends the test set and reports what gets through. |
| `config.py` | Reads the settings from `.env`. |
| `tests/test_layer.py` | Offline tests for the layer. |
| `.env.example` | Template for your settings file. |
| `.gitignore` | Keeps `.env` (with your secrets) out of Git. |

## 7. Setup, step by step

### What you need

- **Python 3.** No packages to install. Check with `py --version` (Windows) or
  `python3 --version` (Mac or Linux). If Windows says Python was not found,
  install it from python.org and tick **Add Python to PATH**.
- **Git.**
- **The team token** (`sai_...`, from the organizers' email) and the **LLM key**
  (`sk-proj-...`, from the challenge brief).

> On Windows use `py`. On Mac or Linux use `python3`. Every command below shows
> `py`; swap it if you are on Mac or Linux.

### Step 1: Get the code

```
git clone https://github.com/ZukoG/zuri-watch-guard.git
cd zuri-watch-guard
```

Windows tip: open the folder in File Explorer, click the address bar, type
`powershell` and press Enter. The terminal opens inside the folder.

Already have it? Get the latest changes instead:

```
git pull
```

### Step 2: Create your settings file (`.env`)

This holds your secrets. It is listed in `.gitignore`, so it never goes to GitHub.

**Windows (PowerShell), recommended.** Put your real token and key in place of
the placeholders, then paste all five lines at once:

```
@"
GUARD_URL=https://secureai-guard-598609297408.europe-west4.run.app
GUARD_TOKEN=sai_YOUR_TEAM_TOKEN
LLM_API_KEY=sk-proj-YOUR_KEY
"@ | Set-Content -Encoding ascii .env
```

**Windows with Notepad.** Make sure you save.

```
copy .env.example .env
notepad .env
```

Fill in the values, press **Ctrl+S**, then close. If you skip the save, every
call fails with `401 unauthorized`.

**Mac or Linux:**

```
cp .env.example .env
nano .env
```

Fill in the values, save with Ctrl+O, Enter, and exit with Ctrl+X.

> The LLM key in the brief PDF is split across two lines. When you copy it,
> make sure it ends up as one unbroken string with no spaces.

### Step 3: Check everything works

```
py -m unittest discover tests
```

This uses no token, key or quota. It should end with `OK`.

Then check your token with the Guard (Windows; on Mac or Linux use `curl` and a
backslash `\` instead of the backtick):

```
curl.exe -s -H "Authorization: Bearer sai_YOUR_TEAM_TOKEN" `
  "https://secureai-guard-598609297408.europe-west4.run.app/v1/usage"
```

A good token shows your team name, for example
`{"daily_limit":1000,"per_minute_limit":30,"team":"Zuri Watch","used_today":0}`.

## 8. Every command, and when to use it

### Quick reference

| Command | What it does | Uses quota? |
|---------|--------------|-------------|
| `py -m unittest discover tests` | Offline tests of the layer | No |
| `py pipeline.py "message"` | One message with full protection | Yes, a few calls |
| `py pipeline.py --guard-only "message"` | The same message, Guard alone | Yes, 2 calls |
| `py pipeline.py --compare "message"` | Guard alone, then full protection | Yes, a few calls |
| `py pipeline.py --compare` | The four built-in examples, both ways | Yes, about 20 calls |
| `py pipeline.py` | The four built-in examples, full protection only | Yes, about 12 calls |
| `py probe.py` | The full test set against the Guard alone | Yes, 14 calls |
| `py probe.py --with-layer` | The full test set with our layer | Yes, about 30 calls |
| `py probe.py --compare` | The full test set, both ways, side by side | Yes, about 45 calls |

The team shares **30 Guard calls a minute and 1,000 a day**. The scripts space
their calls out automatically when they make several, but agree who runs the
big tests.

### `pipeline.py`: the guarded assistant

**Full protection (the normal mode):**

```
py pipeline.py "What is the capital of Ghana?"
```

The message goes through the whole system in section 5. You see each check,
the reply, and how long it took.

**Guard alone (`--guard-only`):**

```
py pipeline.py --guard-only "What is the capital of Ghana?"
```

Only the SecureAI Guard checks the message and the reply. Our translator,
normaliser and canary check are switched off. Use this to see what the Guard
does on its own.

**Before and after (`--compare`):**

```
py pipeline.py --compare "What is the capital of Ghana?"
```

**Why it exists:** the challenge asks us to show what our system adds on top of
the Guard. `--compare` runs the same message twice, first with the Guard alone
(`[GUARD ONLY]`) and then with full protection (`[FULL PROTECTION]`), so you
can see the difference side by side, plus the time each one took.

**What to look for:**

- a `translator:` line under `[FULL PROTECTION]`, which is the English version
  the Guard also checked,
- whether each run ended in `ASSISTANT:` (allowed) or `BLOCKED`,
- the `took ...s` line on each run, which shows the cost of the extra checks.

**Built-in examples:** leave the message out to run four ready-made examples:

```
py pipeline.py --compare
```

They are a normal English question, an English injection, our Twi test
sentence (unconfirmed, see section 3) and a normal Twi question. This is the
quickest way to show the whole system working.

### `probe.py`: the testing tool

```
py probe.py
py probe.py --with-layer
py probe.py --compare
```

The first tests the Guard alone (how we did our original testing), the second
tests the Guard plus our layer, and the third does both side by side for every
test. Each test prints a verdict (`ALLOWED` or `BLOCKED`) and its `request_id`.
At the end you get a summary of attacks that got through and harmless messages
that were wrongly blocked. `--compare` takes a couple of minutes because it
spaces the Guard calls out to stay under the limit.

**Why `request_id` matters:** every Guard check gets a unique ID, so any result
we quote can be traced back and proven.

### `TRANSLATE_MODE`: when to translate

Set in `.env` (the default is `always` if the line is missing):

| Setting | What happens | When to use it |
|---------|--------------|----------------|
| `always` | Every message and reply is translated. | Default. Safest. |
| `auto` | Messages that already look like plain English skip translation. | Faster, but someone could mix languages to dodge the check. |
| `off` | Never translate. | To see the system without the language layer. |

## 9. "I want to..." scenarios

**...check the system works without using any quota.**

```
py -m unittest discover tests
```

**...show the demo before and after.**

```
py pipeline.py --compare
```

**...try my own message.**

```
py pipeline.py --compare "type your message here"
```

**...see how much quota the team has used today.** Run the `curl.exe` command
from Step 3.

**...prove the system fails closed when the Guard is down.** Point the Guard
address somewhere that does not exist, for this terminal only:

```
$env:GUARD_URL="https://guard-is-down.invalid"
py pipeline.py "What is the capital of Ghana?"
```

You should see `BLOCKED ... guard error`, meaning nothing reached the model
while the Guard was unreachable. Put it back afterwards:

```
Remove-Item Env:GUARD_URL
```

On Mac or Linux, `GUARD_URL=https://guard-is-down.invalid python3 pipeline.py "What is the capital of Ghana?"`
affects only that one command.

**...prove the system fails closed when the translator is down.** The same idea
with the LLM key:

```
$env:LLM_API_KEY="not-a-real-key"
py pipeline.py "What is the capital of Ghana?"
Remove-Item Env:LLM_API_KEY
```

You should see `translator unavailable, failing closed`.

**...run without the language layer for a moment.**

```
$env:TRANSLATE_MODE="off"
py pipeline.py "What is the capital of Ghana?"
Remove-Item Env:TRANSLATE_MODE
```

**...get my teammates' latest changes.**

```
git pull
```

## 10. Reading the output

| You see | It means |
|---------|----------|
| `[GUARD ONLY]` / `[FULL PROTECTION]` | Which mode this run used. |
| `normaliser: ...` | The normaliser found and removed a disguise. |
| `translator: ...` | The English version that the Guard also checked. |
| `prompt passed the checks (request_id ...)` | Every check on the message said it was safe. |
| `ASSISTANT: ...` | The reply passed every check and was shown. |
| `BLOCKED at the prompt stage: ...` | Stopped before reaching the model. The reason says which check caught it. |
| `BLOCKED at the response stage: ...` | The model replied, but the reply was stopped before the user saw it. |
| `caught on the English translation` | The Guard flagged the English version, not the original. That is the language layer doing its job. |
| `failing closed` | Something could not be reached, so we blocked rather than took a risk. |
| `WARNING: this reply leaked the planted secret` | The canary appeared in a reply that nothing stopped (only possible in `--guard-only`). |
| `took 3.6s` | Time for that run, leaving out pauses for the rate limit. |

## 11. What we could not solve

- **The Twi question is open.** One Twi sentence got past the Guard alone, but
  we could not confirm with a fluent speaker that it is a real attack, and a
  clearer version was blocked. We report it as unconfirmed.
- **Translation is weakest where it matters most.** Our layer depends on the
  translator understanding the language. For lower-resource languages like
  Twi, models translate less reliably, as we saw ourselves. A better
  translation model, or input from native speakers, would make this stronger.
- **It costs time and quota.** About 2.5 extra seconds per message in our test,
  and up to three Guard calls instead of one.
- **`auto` mode can be dodged** by mixing languages, which is why `always` is
  the default.

With more time we would build a test set with native speakers across several
Ghanaian languages, try a dedicated translation model, and share our results
with the Guard's makers.

## 12. Troubleshooting

| You see | What to do |
|---------|------------|
| `python3` not recognised, or "Python was not found" (Windows) | Use `py` instead. If that fails, install Python from python.org with "Add Python to PATH". |
| `probe.py` not recognised | Run it through Python: `py probe.py`. |
| `Missing settings: ...` | There is no `.env` in this folder. Create it (Step 2) next to the `.py` files. |
| `401 unauthorized` from the Guard | The token is wrong or still the placeholder, usually because Notepad was not saved. Recreate `.env` with the PowerShell command in Step 2. |
| `LLM HTTP 401 ... Incorrect API key` | The LLM key is wrong or still the placeholder. Check it is one unbroken string. |
| `translator unavailable, failing closed` | The LLM could not be reached. Check `LLM_API_KEY` and your internet. |
| `not a git repository` | You are in the wrong folder. If you unzipped, the project may be one folder deeper. Go into the folder that holds `README.md`. |
| `429 rate_limited` or `daily_quota_exceeded` | The shared limit is used up. Wait a minute, or check usage (Step 3). |
| `git push` rejected (non-fast-forward) | Someone pushed first. Run `git pull`, then `git push`. |

## 13. Keeping secrets safe

- The token and the LLM key live **only** in `.env`. Never put them in code,
  slides, screenshots, chat messages, or a screen recording.
- Before pushing, `git ls-files` should list `.env.example` but **never** `.env`.
- When recording or presenting, open a fresh terminal so no earlier command
  with a key in it is visible, and never open `.env` on screen.
- All test data in this project is made up.
