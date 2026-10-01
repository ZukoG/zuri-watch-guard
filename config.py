import os


def _load_env_file(path=".env"):
    # Read a local .env file if one is present so each teammate can keep their own
    # token out of the code. Real environment variables always win over the file.
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env_file()

GUARD_URL = os.environ.get("GUARD_URL", "")
GUARD_TOKEN = os.environ.get("GUARD_TOKEN", "")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "gpt-4o-mini")


def require(*names):
    # Return the names of any settings that are not set, so callers can tell the
    # user exactly what is missing before anything tries to run.
    return [n for n in names if not os.environ.get(n)]
