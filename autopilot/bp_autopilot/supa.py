"""Tiny Supabase RPC client with retries (the host secret is read from a file, never logged)."""
import json, logging, random, time
import requests

log = logging.getLogger("bp.supa")

class Supa:
    def __init__(self, url, key, secret_file):
        self.url = url.rstrip("/"); self.key = key
        with open(secret_file) as f:
            self._secret = f.read().strip()
        self.s = requests.Session()
        self.s.headers.update({"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"})

    def rpc(self, fn, host=True, tries=6, **args):
        body = dict(args)
        if host:
            body["p_secret"] = self._secret
        delay = 1.0
        for i in range(tries):
            try:
                r = self.s.post(f"{self.url}/rest/v1/rpc/{fn}", data=json.dumps(body, default=str), timeout=15)
                if r.status_code < 300:
                    return r.json() if r.text else None
                if r.status_code in (400, 401, 403, 404, 409, 422):
                    msg = r.text[:300]
                    log.error("rpc %s failed %s: %s", fn, r.status_code, msg)
                    raise RuntimeError(f"{fn}: {r.status_code} {msg}")
                log.warning("rpc %s http %s (try %d)", fn, r.status_code, i + 1)
            except requests.RequestException as e:
                log.warning("rpc %s network error %s (try %d)", fn, e.__class__.__name__, i + 1)
            time.sleep(delay + random.random()); delay = min(delay * 2, 30)
        raise RuntimeError(f"{fn}: gave up after {tries} tries")
