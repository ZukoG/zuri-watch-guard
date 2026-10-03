import json
import urllib.request
import urllib.error

import config


def chat(messages, temperature=None):
    """Send a list of chat messages to the LLM and return the reply text, or None
    if the call failed. Uses the OpenAI chat completions shape, which matches the
    sk-proj key from the brief. Point LLM_BASE_URL or LLM_MODEL elsewhere if the
    host differs."""
    url = config.LLM_BASE_URL.rstrip("/") + "/chat/completions"
    payload = {"model": config.LLM_MODEL, "messages": messages}
    if temperature is not None:
        payload["temperature"] = temperature
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Authorization", "Bearer " + config.LLM_API_KEY)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data["choices"][0]["message"]["content"]
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8")
        except Exception:
            pass
        # A model or auth error lands here. The detail usually says what to fix.
        print("  LLM HTTP %s %s" % (e.code, detail[:160]))
        return None
    except Exception as e:
        print("  LLM error: " + str(e))
        return None


def reply(user_text, system_prompt):
    """The assistant's normal answer to a user message."""
    return chat([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_text},
    ])
