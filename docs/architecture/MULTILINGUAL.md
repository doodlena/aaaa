# Multilingual support

## Interface text

- The UI uses react-i18next. Catalogs live in `frontend/src/i18n/locales/en.json` and `es.json`. A test checks that both
  catalogs have identical keys.
- Every backend code (food types, service types, eligibility types, statuses, warnings, match reasons) has a key under
  its namespace. The backend never sends display labels, so one code renders correctly in every language.
- The language switcher is always visible. The choice is saved in `localStorage`, and for signed-in users also in
  `preferred_language` (`PATCH /api/me/preferences`). No account is needed to switch languages.
- Eligibility wording in Spanish is maintained by hand (for example, "No se requiere identificación (confirmado)" and
  "No confirmado"). It is never machine-translated, so the meaning of a restriction cannot drift.

### Adding a language

1. Copy `en.json` to `<code>.json` and translate it. Have a fluent reviewer check the eligibility and verification
   strings.
2. Register it in `frontend/src/i18n/index.ts` and add a switcher button.
3. Add the code to `Lang` in `backend/app/schemas/__init__.py` so accounts can save it.

## Provider-sourced text (descriptions and notes)

- The original text is always stored and shown with its language (`description_lang`, `notes_lang`).
- Optional machine translation: `foodaccess translate --lang es` with `FOODACCESS_TRANSLATION_PROVIDER=libretranslate`
  (self-hosted; `docker compose --profile translate up`) or `argos` (`pip install '.[translate]'`). Translations are
  stored in `translations` with `is_machine=true` and `reviewed=false`, plus a hash of the original. If the original
  changes, the translation is treated as outdated.
- The UI labels unreviewed machine translations ("Automatic translation — not reviewed") and lets the user show the
  original.
- Only public provider text is sent to the translation engine. User data is never sent. The default provider is
  `none`, which sends nothing anywhere.
