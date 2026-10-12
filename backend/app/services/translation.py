"""Optional machine translation of externally sourced descriptions using self-hosted, open-source engines.

- Original text is never modified; translations are stored separately and flagged `is_machine`, `reviewed=False`.
- Only provider/source text is sent to the engine — never user data.
- Eligibility *status* is structured data and is never machine-translated; the UI renders it from reviewed i18n strings.
"""
import hashlib

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Location, Organization, Service, Translation


class TranslationUnavailable(Exception):
    pass


def _libretranslate(text: str, source: str, target: str) -> str:
    r = httpx.post(f"{get_settings().libretranslate_url}/translate", json={"q": text, "source": source, "target": target, "format": "text"},
                   timeout=30)
    r.raise_for_status()
    return r.json()["translatedText"]


def _argos(text: str, source: str, target: str) -> str:
    try:
        import argostranslate.translate as at
    except ImportError as e:
        raise TranslationUnavailable("argostranslate not installed (pip install '.[translate]')") from e
    return at.translate(text, source, target)


def _claude(text: str, source: str, target: str) -> str:
    from app.services import ai

    try:
        return ai.translate(text, source, target)
    except ai.AIUnavailable as e:
        raise TranslationUnavailable(str(e)) from e


PROVIDERS = {"libretranslate": _libretranslate, "argos": _argos, "claude": _claude}


def get_translator(name: str | None = None):
    name = name or get_settings().translation_provider
    if name in (None, "", "none"):
        return None
    if name not in PROVIDERS:
        raise TranslationUnavailable(f"unknown translation provider {name}")
    return PROVIDERS[name]


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def pick_text(original: str | None, original_lang: str | None, translation: Translation | None, want: str, original_hash_ok: bool = True) -> dict:
    """Display logic with fallback: requested-language translation if current, else the original (flagged)."""
    if original is None:
        return {"text": None, "lang": None, "machine": False, "is_original": True}
    if (original_lang or "en") == want or translation is None or not original_hash_ok:
        return {"text": original, "lang": original_lang or "en", "machine": False, "is_original": True}
    return {"text": translation.text, "lang": want, "machine": translation.is_machine and not translation.reviewed, "is_original": False}


def translate_pending(db: Session, lang: str, limit: int = 200, translator=None) -> dict:
    translator = translator or get_translator()
    if translator is None:
        return {"status": "skipped", "reason": "FOODACCESS_TRANSLATION_PROVIDER is 'none'"}
    items = []
    for o in db.scalars(select(Organization).where(Organization.description.isnot(None))).all():
        items.append(("organization", o.id, "description", o.description, o.description_lang))
    for loc in db.scalars(select(Location).where(Location.notes.isnot(None))).all():
        items.append(("location", loc.id, "notes", loc.notes, loc.notes_lang))
    for s in db.scalars(select(Service).where(Service.description.isnot(None))).all():
        items.append(("service", s.id, "description", s.description, s.description_lang))
    done = errors = skipped = 0
    for etype, eid, field, text, src_lang in items:
        if done >= limit:
            break
        src_lang = src_lang or "en"
        if src_lang == lang:
            skipped += 1
            continue
        h = text_hash(text)
        existing = db.scalar(select(Translation).where(Translation.entity_type == etype, Translation.entity_id == eid,
                                                       Translation.field == field, Translation.lang == lang))
        if existing and existing.source_hash == h:
            skipped += 1
            continue
        try:
            out = translator(text, src_lang, lang)
        except (httpx.HTTPError, TranslationUnavailable, KeyError):
            errors += 1
            continue
        t = existing or Translation(entity_type=etype, entity_id=eid, field=field, lang=lang)
        t.text, t.source_hash, t.is_machine, t.reviewed = out, h, True, False
        t.provider = get_settings().translation_provider
        db.add(t)
        done += 1
    db.commit()
    return {"status": "ok", "translated": done, "skipped": skipped, "errors": errors}
