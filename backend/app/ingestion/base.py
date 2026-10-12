"""Source configuration, polite HTTP fetching, and the adapter interface/registry.

To add a source: write config/sources/<id>.yaml and (only if no existing adapter fits) a module in
app/ingestion/adapters/ that subclasses Adapter and is decorated with @register("<name>").
"""
import hashlib
import json
import time
import urllib.robotparser
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse

import httpx
import yaml
from pydantic import BaseModel, Field

from app.config import get_settings
from app.ingestion.candidate import CandidateResource


class SourceConfig(BaseModel):
    id: str
    name: str
    owner: str | None = None
    url: str  # canonical human-facing page (shown for attribution)
    adapter: str
    jurisdictions: list[str]  # geographic coverage (jurisdiction registry ids)
    enabled: bool = True
    # Withdrawn data: every record from this source is rejected wherever `load-data`/`retract-source` runs.
    retracted: bool = False
    retracted_reason: str | None = None
    retrieval: str = "http"  # http | file
    formats: list[str] = Field(default_factory=lambda: ["html"])
    request_urls: list[str] = Field(default_factory=list)  # defaults to [url]
    min_seconds_between_requests: float = 2.0
    cache_ttl_hours: float = 24
    store_raw: bool = True  # false when terms don't allow retaining source content
    respect_robots: bool = True
    expected_fields: list[str] = Field(default_factory=list)
    field_mappings: dict = Field(default_factory=dict)
    options: dict = Field(default_factory=dict)
    validation: dict = Field(default_factory=dict)  # e.g. {"require_schedule": false}
    known_limitations: list[str] = Field(default_factory=list)
    terms_notes: str | None = None
    refresh: str | None = None  # cron expression for scheduled refresh
    # permitted_with_attribution | permission_required | not_assessed. Listings backed only by
    # permission_required/not_assessed sources can be published only after direct verification with the provider.
    publication: str = "not_assessed"
    publication_note: str | None = None  # why/when the publication status was set (e.g. owner decision)
    is_synthetic: bool = False
    rows_are_distinct: bool = False  # the source lists each program at a venue as its own row: never auto-merge two of them
    verified_on: str | None = None  # date a human confirmed URL/terms


def load_source_configs(directory: Path | None = None) -> dict[str, SourceConfig]:
    directory = directory or get_settings().config_dir / "sources"
    out = {}
    for p in sorted(directory.glob("*.yaml")):
        cfg = SourceConfig(**yaml.safe_load(p.read_text()))
        out[cfg.id] = cfg
    return out


@dataclass
class FetchedDocument:
    url: str
    status: int
    content: bytes
    content_type: str
    fetched_at: datetime
    from_cache: bool = False

    def text(self) -> str:
        return self.content.decode("utf-8", errors="replace")

    def json(self):
        return json.loads(self.content)


@dataclass
class RawRecord:
    external_id: str
    data: dict
    source_url: str | None = None


class FetchError(Exception):
    pass


class Fetcher:
    """HTTP GET with robots.txt checks, per-host spacing, and an on-disk cache. `fixtures` maps URL -> local file
    so tests and offline runs never touch the network."""

    def __init__(self, fixtures: dict[str, Path] | None = None, cache_dir: Path | None = None, offline: bool = False):
        self.fixtures = fixtures or {}
        self.cache_dir = cache_dir or get_settings().data_dir / "cache" / "http"
        self.offline = offline
        self._last: dict[str, float] = {}
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self.client = None

    def _client(self):
        if self.client is None:
            self.client = httpx.Client(timeout=30, follow_redirects=True, headers={"User-Agent": get_settings().http_user_agent})
        return self.client

    def allowed(self, url: str) -> bool:
        p = urlparse(url)
        base = f"{p.scheme}://{p.netloc}"
        if base not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                r = self._client().get(base + "/robots.txt")
                if r.status_code >= 400:
                    rp = None  # no robots.txt => no restrictions declared
                else:
                    rp.parse(r.text.splitlines())
            except httpx.HTTPError:
                rp = None
            self._robots[base] = rp
        rp = self._robots[base]
        return True if rp is None else rp.can_fetch(get_settings().http_user_agent, url)

    def get(self, url: str, cfg: SourceConfig) -> FetchedDocument:
        now = datetime.now(UTC)
        if url in self.fixtures:
            path = self.fixtures[url]
            ctype = "application/json" if path.suffix in (".json", ".geojson") else "application/pdf" if path.suffix == ".pdf" else "text/html"
            return FetchedDocument(url, 200, path.read_bytes(), ctype, now, from_cache=True)
        if url.startswith("file://"):  # repo-relative local file (curated data files, fixtures)
            from app.config import REPO_ROOT

            path = (REPO_ROOT / url[len("file://"):]).resolve()
            if REPO_ROOT not in path.parents:
                raise FetchError("file:// sources must live inside the repository")
            if not path.exists():
                raise FetchError(f"missing local file {path.name}")
            return FetchedDocument(url, 200, path.read_bytes(), "application/json", now, from_cache=True)
        key = hashlib.sha256(url.encode()).hexdigest()
        body, meta = self.cache_dir / f"{key}.body", self.cache_dir / f"{key}.json"
        if meta.exists():
            m = json.loads(meta.read_text())
            age_h = (now - datetime.fromisoformat(m["fetched_at"])).total_seconds() / 3600
            if age_h < cfg.cache_ttl_hours or self.offline:
                return FetchedDocument(url, m["status"], body.read_bytes(), m["content_type"], datetime.fromisoformat(m["fetched_at"]), True)
        if self.offline:
            raise FetchError(f"offline and no cached copy of {url}")
        if cfg.respect_robots and not self.allowed(url):
            raise FetchError(f"robots.txt disallows {url}")
        host = urlparse(url).netloc
        wait = cfg.min_seconds_between_requests - (time.monotonic() - self._last.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        try:
            r = self._client().get(url)
        except httpx.HTTPError as e:
            raise FetchError(f"{type(e).__name__} fetching {url}") from e
        finally:
            self._last[host] = time.monotonic()
        if r.status_code >= 400:
            raise FetchError(f"HTTP {r.status_code} from {url}")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        body.write_bytes(r.content)
        meta.write_text(json.dumps({"url": url, "status": r.status_code, "content_type": r.headers.get("content-type", ""),
                                    "fetched_at": now.isoformat()}))
        return FetchedDocument(url, r.status_code, r.content, r.headers.get("content-type", ""), now)


class Adapter:
    """Subclasses implement parse() and normalize(); discover() defaults to the configured URLs."""

    name = "base"

    def __init__(self, config: SourceConfig):
        self.config = config

    def discover(self) -> Iterable[str]:
        return self.config.request_urls or [self.config.url]

    def parse(self, doc: FetchedDocument) -> Iterable[RawRecord]:
        raise NotImplementedError

    def normalize(self, raw: RawRecord) -> CandidateResource:
        raise NotImplementedError

    def validate(self, c: CandidateResource) -> list[dict]:
        """Source-specific checks; generic checks run in the pipeline."""
        return []


ADAPTERS: dict[str, type[Adapter]] = {}


def register(name: str):
    def deco(cls):
        cls.name = name
        ADAPTERS[name] = cls
        return cls

    return deco


def get_adapter(cfg: SourceConfig) -> Adapter:
    import app.ingestion.adapters  # noqa: F401  (populate registry)

    if cfg.adapter not in ADAPTERS:
        raise KeyError(f"No adapter registered as {cfg.adapter!r} (source {cfg.id})")
    return ADAPTERS[cfg.adapter](cfg)


@dataclass
class RunCounts:
    discovered: int = 0
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0
    rejected: int = 0
    duplicate_candidates: int = 0
    conflicts: int = 0
    needs_review: int = 0
    out_of_scope: int = 0
    gone: int = 0
    fetch_errors: int = 0
    parse_errors: int = 0
    extra: dict = field(default_factory=dict)
