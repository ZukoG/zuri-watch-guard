import json
import urllib.request
import urllib.error

import config


class GuardClient:
    """Thin wrapper over the SecureAI Guard API. One place that knows how to talk
    to the Guard, so the pipeline and the probe both use the same code path."""

    def __init__(self, base_url=None, token=None):
        self.base_url = (base_url or config.GUARD_URL).rstrip("/")
        self.token = token or config.GUARD_TOKEN

    def _post(self, path, text):
        url = self.base_url + path
        body = json.dumps({"text": text}).encode("utf-8")
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Authorization", "Bearer " + self.token)
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8")
            except Exception:
                pass
            return {"error": "HTTP %s" % e.code, "detail": detail}
        except Exception as e:
            return {"error": str(e)}

    def check_prompt(self, text):
        return self._post("/v1/check/prompt", text)

    def check_response(self, text):
        return self._post("/v1/check/response", text)
