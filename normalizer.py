import base64
import re

# Invisible characters that can be hidden between letters to dodge a plain text
# match while still reading the same to a model.
INVISIBLE = "\u200b\u200c\u200d\u2060\ufeff\u00ad"
_INVISIBLE_RE = re.compile("[" + INVISIBLE + "]")

# Look-alike letters borrowed from other alphabets, each mapped back to the Latin
# letter it imitates. Covers the common Cyrillic and Greek confusables.
HOMOGLYPHS = {
    "\u0430": "a", "\u0435": "e", "\u043e": "o", "\u0440": "p", "\u0441": "c",
    "\u0445": "x", "\u0443": "y", "\u0456": "i", "\u0455": "s", "\u043a": "k",
    "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u039f": "O", "\u03bf": "o",
    "\u03b1": "a",
}

# A small leet map. The de-leeted text is only ever used as an extra thing to
# screen, never forced onto the real message, so turning "4" into "a" cannot
# corrupt a genuine sentence that happens to contain a number.
LEET = {"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s"}

_B64_RE = re.compile(r"[A-Za-z0-9+/]{16,}={0,2}")


def _strip_invisible(text):
    return _INVISIBLE_RE.sub("", text)


def _fix_homoglyphs(text):
    return "".join(HOMOGLYPHS.get(ch, ch) for ch in text)


def _deleet(text):
    return "".join(LEET.get(ch, ch) for ch in text.lower())


def _decode_base64_blobs(text):
    # Find base64-looking runs and keep any that decode to readable text, so a
    # payload hidden inside an encoded blob still gets screened.
    found = []
    for match in _B64_RE.findall(text):
        try:
            candidate = base64.b64decode(match, validate=True).decode("utf-8")
        except Exception:
            continue
        printable = sum(1 for c in candidate if c.isprintable())
        if candidate.strip() and printable >= max(4, int(len(candidate) * 0.8)):
            found.append(candidate)
    return found


def normalize(text):
    """Undo common obfuscation tricks on a prompt and gather extra forms worth
    screening.

    Returns (cleaned, extras, notes):
      cleaned  the text to forward on, with invisible characters removed and
               look-alike letters folded back to plain ASCII
      extras   additional strings to also run past the Guard: any decoded base64
               and a de-leetspeaked version, so a disguised attack is caught even
               when the surface text looks innocent
      notes    a short list of what changed, printed during the demo so the audience
               can see the layer working
    """
    notes = []

    without_invisible = _strip_invisible(text)
    if without_invisible != text:
        notes.append("removed invisible characters")

    cleaned = _fix_homoglyphs(without_invisible)
    if cleaned != without_invisible:
        notes.append("folded look-alike letters to ASCII")

    extras = []

    deleeted = _deleet(cleaned)
    if deleeted != cleaned.lower():
        extras.append(deleeted)
        notes.append("added a de-leetspeaked version to screen")

    decoded = _decode_base64_blobs(cleaned)
    extras.extend(decoded)
    if decoded:
        notes.append("decoded %d base64 section(s) to screen" % len(decoded))

    return cleaned, extras, notes
