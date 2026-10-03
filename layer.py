"""Our protection layer around the SecureAI Guard. The pipeline and the probe both
go through here, so what we demo is exactly what we tested.

With use_layer=False, a message gets only the Guard's own check, which is how we
show the weakness. With use_layer=True, it also goes through our normaliser and
translator, and replies go through the canary check."""

import translator
from normalizer import normalize

# A fake secret planted in the assistant's instructions. If it ever shows up in
# a reply, the model was tricked into leaking them.
CANARY = "CANARY-7F3A-DEMO"


class Verdict:
    def __init__(self, ok, reason="", request_ids=None, text=""):
        self.ok = ok
        self.reason = reason
        self.request_ids = request_ids or []
        self.text = text


def _quiet(_message):
    pass


def flagged(result):
    """Treat a flag or a hard error the same way: do not let it through. A Guard
    error counts as flagged because the layer fails closed."""
    if "error" in result:
        return True, "guard error: " + result["error"]
    if not result.get("allowed", False):
        return True, "flags=%s request_id=%s" % (result.get("flags"), result.get("request_id"))
    return False, ""


def _check_all(forms, check):
    """Run every version of the text past the Guard. One flag blocks the lot."""
    ids = []
    for label, text in forms:
        result = check(text)
        if result.get("request_id"):
            ids.append(result["request_id"])
        bad, why = flagged(result)
        if bad:
            return Verdict(False, "%s, caught on the %s" % (why, label), ids)
    return Verdict(True, "", ids)


def _same(a, b):
    return " ".join(a.lower().split()) == " ".join(b.lower().split())


def _english_form(text, log, check_refusal):
    """Translate text to English when the settings say to. Returns (translation,
    block_reason). A translation identical to the text is not worth a second Guard
    call, so it comes back as None."""
    if not translator.should_translate(text):
        return None, ""
    english = translator.to_english(text)
    if english is None:
        return None, "translator unavailable, failing closed"
    if _same(english, text):
        return None, ""
    log("  translator: " + english)
    problem = translator.looks_tampered(text, english, check_refusal=check_refusal)
    if problem:
        return None, "translator check: " + problem
    return english, ""


def screen_prompt(text, guard, use_layer=True, log=print):
    """Decide whether a user message is safe to pass to the model."""
    if not use_layer:
        verdict = _check_all([("original message", text)], guard.check_prompt)
        verdict.text = text
        return verdict

    cleaned, extras, notes = normalize(text)
    for note in notes:
        log("  normaliser: " + note)
    forms = [("original message", cleaned)] + [("decoded form", e) for e in extras]

    english, reason = _english_form(cleaned, log, check_refusal=True)
    if reason:
        return Verdict(False, reason, text=cleaned)
    if english:
        forms.append(("English translation", english))

    verdict = _check_all(forms, guard.check_prompt)
    verdict.text = cleaned
    return verdict


def screen_response(text, guard, use_layer=True, log=print):
    """Decide whether a model reply is safe to show the user. Replies get the same
    translation step, so a harmful answer in Twi cannot slip out either."""
    forms = [("reply", text)]
    if use_layer:
        english, reason = _english_form(text, log, check_refusal=False)
        if reason:
            return Verdict(False, reason, text=text)
        if english:
            forms.append(("English translation of the reply", english))

    verdict = _check_all(forms, guard.check_response)
    verdict.text = text
    if verdict.ok and use_layer and CANARY in text:
        return Verdict(False, "canary check: the reply leaked the planted secret", verdict.request_ids, text)
    return verdict
