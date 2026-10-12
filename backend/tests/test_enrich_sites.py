from app.research import enrich_sites
from app.services import ai

FOOD_OK = {"pantry_pickup"}


def _rec(**kw):
    return {"schedules": [], "eligibility": [], "services": [{"service_type": "pantry_pickup", "schedules": []}],
            "raw_hours_text": "On Fridays our Food Pantry is open from 10 AM to 3 PM", "raw_eligibility_text": "No ID required.", **kw}


def test_ai_fill_uses_structure_step_when_parser_failed(monkeypatch):
    out = ai.StructureSuggestion(
        distribution_schedules=[ai.ScheduleSuggestion(weekday=4, opens="10:00", closes="15:00", week_of_month=None,
                                                      evidence="open from 10 AM to 3 PM")],
        eligibility=[ai.EligibilitySuggestion(requirement_type="photo_id", status="not_required", evidence="No ID required.")])
    monkeypatch.setattr(ai, "suggest_structure", lambda text: out)
    rec, stats = _rec(), {}
    enrich_sites._ai_fill(rec, FOOD_OK, stats)
    assert rec["services"][0]["schedules"][0] | {} == {"kind": "distribution", "weekday": 4, "opens": "10:00", "closes": "15:00",
                                                       "week_of_month": None, "appointment_only": False, "notes": None}
    assert rec["eligibility"][0]["status"] == "not_required"
    assert stats == {"ai_schedules": 1, "ai_eligibility": 1}


def test_ai_fill_never_attaches_times_to_non_food_or_already_parsed(monkeypatch):
    called = []
    monkeypatch.setattr(ai, "suggest_structure", lambda text: called.append(text))
    rec = _rec(services=[{"service_type": "legal_aid", "schedules": []}], raw_eligibility_text=None)
    enrich_sites._ai_fill(rec, FOOD_OK, {})
    parsed = _rec(schedules=[{"weekday": 1}], eligibility=[{"requirement_type": "id", "status": "required"}])
    enrich_sites._ai_fill(parsed, FOOD_OK, {})
    assert called == [] and rec["services"][0]["schedules"] == []
