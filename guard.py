import json
import time
import urllib.request
import urllib.error

import config


class GuardClient:
    """Thin wrapper over the SecureAI Guard API. One place that knows how to talk
    to the Guard, so the pipeline and the probe both use the same code path.

    min_interval spaces calls out so a batch run stays under the shared limit of
    30 calls a minute. waited keeps a running total of time spent pausing, so
    timings can leave those pauses out."""

    def __init__(self, base_url=None, token=None, min_interval=0.0):
        self.base_url = (base_url or config.GUARD_URL).rstrip("/")
        self.token = token or config.GUARD_TOKEN
        self.min_interval = min_interval
        self.waited = 0.0
        self._last_call = 0.0

    def _pause(self, seconds):
        if seconds > 0:
            time.sleep(seconds)
            self.waited += seconds

    def _wait_turn(self):
        if self.min_interval:
            gap = time.monotonic() - self._last_call
            self._pause(self.min_interval - gap)
        self._last_call = time.monotonic()

    def _post(self, path, text):
        url = self.base_url + path
        body = json.dumps({"text": text}).encode("utf-8")
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Authorization", "Bearer " + self.token)
        req.add_header("Content-Type", "application/json")

        for attempt in (1, 2):
            self._wait_turn()
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                # On a rate limit, wait as long as the Guard asks and try once more.
                if e.code == 429 and attempt == 1:
                    try:
                        wait = int(e.headers.get("Retry-After", "5"))
                    except ValueError:
                        wait = 5
                    print("  rate limited, waiting %ss then retrying once" % wait)
                    self._pause(wait + 1)
                    continue
                detail = ""
                try:
                    detail = e.read().decode("utf-8")
                except Exception:
                    pass
                return {"error": "HTTP %s" % e.code, "detail": detail}
            except Exception as e:
                return {"error": str(e)}
        return {"error": "rate limited twice in a row"}

    def check_prompt(self, text):
        return self._post("/v1/check/prompt", text)

    def check_response(self, text):
        return self._post("/v1/check/response", text)
