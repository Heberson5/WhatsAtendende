-- File names sent with accents were stored garbled: the upload read the browser's UTF-8 as Latin-1, so
-- "Manutenção.xlsx" became "ManutenÃ§Ã£o.xlsx" (fixed at the source in apps/api/src/lib/upload.ts). This puts back
-- the real names of what's already stored. A name is changed only when it has the garbling's tell-tale pattern (a
-- character from U+00C2..U+00F4 followed by one from U+0080..U+00BF) AND undoing it gives valid UTF-8 — names that
-- were always right (e.g. those that came from WhatsApp) can't pass both, so they stay exactly as they are.

CREATE FUNCTION wa_fix_garbled_name(name TEXT) RETURNS TEXT AS $$
BEGIN
  IF name IS NULL OR name !~ '[\u00C2-\u00F4][\u0080-\u00BF]' THEN
    RETURN name;
  END IF;
  RETURN convert_from(convert_to(name, 'LATIN1'), 'UTF8');
EXCEPTION WHEN OTHERS THEN
  RETURN name;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

UPDATE "MessageAttachment" SET "fileName" = wa_fix_garbled_name("fileName") WHERE "fileName" IS DISTINCT FROM wa_fix_garbled_name("fileName");

DROP FUNCTION wa_fix_garbled_name(TEXT);
