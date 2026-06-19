"""
rp_lib.py — Shared library for the Scopus(main) + OpenAlex(enrichment) research pipeline.

Design (single-key, no insttoken):
  * Scopus Search API  -> relevance-ranked discovery + citation counts (all publishers).
                          Personal key entitlement: STANDARD view only (title/doi/eid/
                          citedby-count/coverDate/openaccess). NO abstract, NO refs.
  * OpenAlex           -> abstracts (inverted-index reconstruction), backward refs
                          (referenced_works), forward citations (cites filter), OA pdf
                          links. Keyless, polite pool ~10 req/s with mailto.
  * Elsevier ScienceDirect Article Retrieval -> OA full text only (paywalled => abstract
                          shell, treated as unavailable).

Everything is cached to disk and rate-limited per host. 429/5xx are retried with backoff.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CACHE_DIR = ROOT / ".cache"
CACHE_DIR.mkdir(exist_ok=True)

OPENALEX_MAILTO = os.environ.get("OPENALEX_MAILTO", "research@wentor.ai")

# Shared personal Elsevier/Scopus key, shipped in plaintext so the plugin works
# out of the box. Personal STANDARD entitlement only (search + citation counts +
# Elsevier-OA full text); rotate at dev.elsevier.com if it stops working.
# Override with env ELSEVIER_API_KEY or scripts/keys.local.json.
DEFAULT_ELSEVIER_KEY = "1a86a22a0f4dac7995ff6185cba431c2"


# --------------------------------------------------------------------------- config
def load_elsevier_key() -> str | None:
    """Key resolution: env ELSEVIER_API_KEY -> keys.local.json -> shared default."""
    key = os.environ.get("ELSEVIER_API_KEY")
    if key:
        return key.strip()
    cfg = ROOT / "keys.local.json"
    if cfg.exists():
        try:
            local = json.loads(cfg.read_text()).get("elsevier_api_key")
            if local:
                return local
        except Exception:
            pass
    return DEFAULT_ELSEVIER_KEY


# --------------------------------------------------------------------------- rate limit
class _RateLimiter:
    """Minimum-interval limiter, one bucket per host. Thread-safe for parallel callers."""

    def __init__(self, min_interval: dict[str, float]):
        self.min_interval = min_interval
        self._last: dict[str, float] = {}
        self._lock = threading.Lock()

    def wait(self, host: str):
        interval = self.min_interval.get(host, 0.2)
        with self._lock:
            now = time.monotonic()
            last = self._last.get(host, 0.0)
            sleep_for = interval - (now - last)
            if sleep_for > 0:
                time.sleep(sleep_for)
            self._last[host] = time.monotonic()


# Conservative sustained ceilings (per single egress IP, shared across threads):
#   Scopus  : weekly quota 20k; ~9 req/s allowed, we use 6/s to stay safe.
#   OpenAlex: 100k/day polite pool; ~10 req/s, we use 8/s.
_LIMITER = _RateLimiter(
    {
        "api.elsevier.com": 1.0 / 6.0,
        "api.openalex.org": 1.0 / 8.0,
    }
)


# --------------------------------------------------------------------------- http + cache
def _cache_path(key: str) -> Path:
    return CACHE_DIR / (hashlib.sha256(key.encode()).hexdigest()[:24] + ".json")


def http_get(url: str, headers: dict | None = None, cache: bool = True,
             max_retries: int = 4, timeout: int = 40) -> tuple[int, str]:
    """GET with disk cache, per-host rate limit, and 429/5xx exponential backoff.
    Returns (http_status, body_text). Cached responses report status 200."""
    headers = headers or {}
    ckey = url + "\n" + json.dumps(headers, sort_keys=True)
    cp = _cache_path(ckey)
    if cache and cp.exists():
        return 200, cp.read_text()

    host = urllib.parse.urlparse(url).netloc
    backoff = 2.0
    for attempt in range(max_retries):
        _LIMITER.wait(host)
        req = urllib.request.Request(url, headers={"User-Agent": "rp/1.0", **headers})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read().decode("utf-8", "ignore")
                if cache:
                    cp.write_text(body)
                return resp.getcode(), body
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "ignore")
            if e.code in (429, 500, 502, 503, 504) and attempt < max_retries - 1:
                time.sleep(backoff)
                backoff *= 2
                continue
            return e.code, body
        except (urllib.error.URLError, OSError) as e:  # OSError covers socket.timeout on 3.9
            if attempt < max_retries - 1:
                time.sleep(backoff)
                backoff *= 2
                continue
            return 0, json.dumps({"error": str(e)})
    return 0, ""


# --------------------------------------------------------------------------- Scopus
SCOPUS_SEARCH = "https://api.elsevier.com/content/search/scopus"


def scopus_search(query: str, limit: int = 50, sort: str = "relevancy",
                  api_key: str | None = None) -> list[dict]:
    """Relevance-ranked Scopus search. STANDARD view (no abstract). Paginates by `start`.
    Returns normalized dicts: {scopus_id, eid, doi, title, year, cited_by, oa, source}."""
    api_key = api_key or load_elsevier_key()
    if not api_key:
        raise RuntimeError("No Elsevier API key (set ELSEVIER_API_KEY or keys.local.json)")
    headers = {"X-ELS-APIKey": api_key, "Accept": "application/json"}
    fields = "dc:identifier,eid,prism:doi,dc:title,citedby-count,prism:coverDate,openaccess,prism:publicationName"
    out: list[dict] = []
    start = 0
    page = min(25, limit)
    while len(out) < limit:
        params = urllib.parse.urlencode({
            "query": query, "count": page, "start": start,
            "sort": sort, "field": fields,
        })
        status, body = http_get(f"{SCOPUS_SEARCH}?{params}", headers=headers)
        try:
            res = json.loads(body)["search-results"]
        except Exception:
            raise RuntimeError(f"Scopus search failed (HTTP {status}): {body[:200]}")
        entries = res.get("entry", [])
        if not entries or "error" in entries[0]:
            break
        for e in entries:
            doi = e.get("prism:doi")
            out.append({
                "scopus_id": (e.get("dc:identifier") or "").replace("SCOPUS_ID:", ""),
                "eid": e.get("eid"),
                "doi": doi.lower() if doi else None,
                "title": e.get("dc:title"),
                "year": (e.get("prism:coverDate") or "")[:4],
                "cited_by": int(e.get("citedby-count") or 0),
                "oa": e.get("openaccess") == "1",
                "source": e.get("prism:publicationName"),
            })
        total = int(res.get("opensearch:totalResults", 0))
        start += page
        if start >= total:
            break
    return out[:limit]


# --------------------------------------------------------------------------- OpenAlex
OPENALEX = "https://api.openalex.org/works"


def reconstruct_abstract(inverted_index: dict | None) -> str:
    if not inverted_index:
        return ""
    pos: dict[int, str] = {}
    for word, idxs in inverted_index.items():
        for i in idxs:
            pos[i] = word
    return " ".join(pos[i] for i in sorted(pos))


def _oa_url(path_or_filter: str) -> str:
    sep = "&" if "?" in path_or_filter else "?"
    return f"{OPENALEX}{path_or_filter}{sep}mailto={urllib.parse.quote(OPENALEX_MAILTO)}"


def _normalize_work(w: dict) -> dict:
    ids = w.get("ids", {}) or {}
    doi = (w.get("doi") or "").replace("https://doi.org/", "").lower() or None
    best = w.get("best_oa_location") or {}
    return {
        "openalex_id": (w.get("id") or "").split("/")[-1] or None,
        "doi": doi,
        "title": w.get("title"),
        "year": w.get("publication_year"),
        "abstract": reconstruct_abstract(w.get("abstract_inverted_index")),
        "cited_by": w.get("cited_by_count"),
        "referenced_works": [r.split("/")[-1] for r in (w.get("referenced_works") or [])],
        "oa_status": (w.get("open_access") or {}).get("oa_status"),
        "oa_pdf_url": best.get("pdf_url"),
        "oa_landing": best.get("landing_page_url"),
        "source": (w.get("primary_location") or {}).get("source", {} ).get("display_name")
                  if w.get("primary_location") else None,
    }


def openalex_by_dois(dois: list[str], batch: int = 50) -> dict[str, dict]:
    """Batch-fetch works by DOI (pipe-OR filter). Returns {doi_lower: normalized_work}."""
    out: dict[str, dict] = {}
    clean = [d.lower() for d in dois if d]
    for i in range(0, len(clean), batch):
        chunk = clean[i:i + batch]
        filt = "doi:" + "|".join(chunk)
        url = _oa_url(f"?filter={urllib.parse.quote(filt, safe='|:/.')}&per-page={len(chunk)}")
        status, body = http_get(url)
        try:
            for w in json.loads(body).get("results", []):
                nw = _normalize_work(w)
                if nw["doi"]:
                    out[nw["doi"]] = nw
        except Exception:
            continue
    return out


def openalex_get(id_or_doi: str) -> dict | None:
    sel = id_or_doi if id_or_doi.startswith("W") else f"doi:{id_or_doi.lower()}"
    status, body = http_get(_oa_url(f"/{sel}"))
    try:
        return _normalize_work(json.loads(body))
    except Exception:
        return None


def openalex_forward_citations(work_id: str, limit: int = 50) -> list[dict]:
    """Papers citing work_id (forward). Sorted by citation count desc."""
    url = _oa_url(f"?filter=cites:{work_id}&per-page={min(50, limit)}&sort=cited_by_count:desc")
    status, body = http_get(url)
    try:
        return [_normalize_work(w) for w in json.loads(body).get("results", [])][:limit]
    except Exception:
        return []


def openalex_works_by_ids(work_ids: list[str], batch: int = 50) -> list[dict]:
    """Resolve a list of OpenAlex work IDs (e.g. referenced_works) to metadata."""
    out: list[dict] = []
    for i in range(0, len(work_ids), batch):
        chunk = work_ids[i:i + batch]
        filt = "openalex:" + "|".join(chunk)
        url = _oa_url(f"?filter={urllib.parse.quote(filt, safe='|:')}&per-page={len(chunk)}")
        status, body = http_get(url)
        try:
            out.extend(_normalize_work(w) for w in json.loads(body).get("results", []))
        except Exception:
            continue
    return out


# --------------------------------------------------------------------------- Elsevier full text (OA only)
def elsevier_fulltext(doi: str, api_key: str | None = None, min_full_bytes: int = 20000) -> dict:
    """Fetch full text via ScienceDirect Article Retrieval. Personal key => OA only.
    Returns {available, source, chars, text|None}. Paywalled papers come back as a small
    abstract shell, which we flag as available=False."""
    api_key = api_key or load_elsevier_key()
    # ScienceDirect only hosts Elsevier content (DOI prefix 10.1016 / 10.1006 / 10.1053 ...).
    # For anything else, skip the (slow, always-failing) Elsevier call.
    if not api_key or not doi.startswith(("10.1016", "10.1006", "10.1053", "10.1078", "10.5555")):
        return {"available": False, "source": "not-elsevier", "chars": 0, "text": None}
    headers = {"X-ELS-APIKey": api_key, "Accept": "text/xml"}
    url = f"https://api.elsevier.com/content/article/doi/{doi}"
    status, body = http_get(url, headers=headers)
    if status != 200 or "service-error" in body[:300]:
        return {"available": False, "source": "elsevier", "chars": 0, "text": None}
    full = len(body) >= min_full_bytes and "<ce:para" in body
    return {
        "available": full,
        "source": "elsevier-oa" if full else "elsevier-abstract-shell",
        "chars": len(body),
        "text": body if full else None,
    }
