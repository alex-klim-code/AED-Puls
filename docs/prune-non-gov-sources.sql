-- Explicit, user-approved, one-time DEVELOPMENT cleanup. Never run on startup.
-- No DDL/schema migration; temporary tables contain target IDs only.
BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '180s';
LOCK TABLE data_sources, aed_records, source_observations, import_jobs IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE retired_source_ids (id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO retired_source_ids SELECT id FROM data_sources
  WHERE key IS NULL OR (key <> 'dane-gov' AND key NOT LIKE 'dane-gov:%');
CREATE TEMP TABLE retained_aed_ids (id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO retained_aed_ids SELECT DISTINCT o.aed_id FROM source_observations o
  JOIN data_sources s ON s.id=o.source_id
  WHERE (s.key='dane-gov' OR s.key LIKE 'dane-gov:%') AND o.aed_id IS NOT NULL;
CREATE TEMP TABLE retired_aed_ids (id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO retired_aed_ids SELECT id FROM aed_records WHERE id NOT IN (SELECT id FROM retained_aed_ids);
CREATE TEMP TABLE retired_observation_ids (id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO retired_observation_ids SELECT id FROM source_observations
  WHERE source_id IN (SELECT id FROM retired_source_ids) OR aed_id IN (SELECT id FROM retired_aed_ids)
     OR source_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM data_sources WHERE key='dane-gov')
    OR NOT EXISTS (SELECT 1 FROM retained_aed_ids) THEN
    RAISE EXCEPTION 'Przerwano: brak potwierdzonych danych do zachowania z dane.gov.pl.';
  END IF;
  -- The reviewed database has no mixed retained records or merged government
  -- records. If that changes, stop rather than retain copied foreign fields.
  IF EXISTS (SELECT 1 FROM source_observations o WHERE o.aed_id IN (SELECT id FROM retained_aed_ids)
    AND (o.source_id IS NULL OR o.source_id IN (SELECT id FROM retired_source_ids)))
    OR EXISTS (SELECT 1 FROM aed_records a WHERE a.id IN (SELECT id FROM retained_aed_ids) AND a.merged_into_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Przerwano: rekord mieszany wymaga rekonstrukcji pochodzenia przed usunięciem.';
  END IF;
  IF EXISTS (SELECT 1 FROM aed_proposals WHERE aed_id IN (SELECT id FROM retired_aed_ids))
    OR EXISTS (SELECT 1 FROM conflict_reports WHERE aed_id IN (SELECT id FROM retired_aed_ids))
    OR EXISTS (SELECT 1 FROM submissions WHERE aed_id IN (SELECT id FROM retired_aed_ids)) THEN
    RAISE EXCEPTION 'Przerwano: usuwany AED ma prywatne zgłoszenia wymagające osobnego rozpatrzenia.';
  END IF;
END $$;

INSERT INTO audit_logs(action,details) SELECT
  'Usunięto pozostałe integracje i ich dane AED na zlecenie użytkownika',
  jsonb_build_object('retainedCatalogue','dane.gov.pl',
    'removedSources',(SELECT count(*) FROM retired_source_ids),
    'removedAeds',(SELECT count(*) FROM retired_aed_ids),
    'retainedAeds',(SELECT count(*) FROM retained_aed_ids));

DELETE FROM data_conflicts WHERE aed_id IN (SELECT id FROM retired_aed_ids)
  OR observation_id IN (SELECT id FROM retired_observation_ids);
DELETE FROM merge_decisions WHERE keeper_id IN (SELECT id FROM retired_aed_ids) OR loser_id IN (SELECT id FROM retired_aed_ids);
DELETE FROM duplicate_candidates WHERE first_id IN (SELECT id FROM retired_aed_ids) OR second_id IN (SELECT id FROM retired_aed_ids);
DELETE FROM validation_issues WHERE aed_id IN (SELECT id FROM retired_aed_ids);
DELETE FROM observation_versions WHERE observation_id IN (SELECT id FROM retired_observation_ids);
DELETE FROM audit_logs WHERE entity_id IN (SELECT id FROM retired_aed_ids)
  OR entity_id IN (SELECT id FROM retired_source_ids) OR entity_id IN (SELECT id FROM retired_observation_ids)
  OR entity_id IN (SELECT id FROM import_jobs WHERE source_id IN (SELECT id FROM retired_source_ids));
DELETE FROM source_observations WHERE id IN (SELECT id FROM retired_observation_ids);
DELETE FROM import_errors WHERE source_id IN (SELECT id FROM retired_source_ids)
  OR job_id IN (SELECT id FROM import_jobs WHERE source_id IN (SELECT id FROM retired_source_ids));
DELETE FROM import_jobs WHERE source_id IN (SELECT id FROM retired_source_ids);
DELETE FROM aed_records WHERE id IN (SELECT id FROM retired_aed_ids);
UPDATE source_observations SET provenance_evidence=provenance_evidence-'copyOfSourceId'-'copyOfSourceName'
  WHERE provenance_evidence->>'copyOfSourceId' IN (SELECT id::text FROM retired_source_ids);
DELETE FROM data_sources WHERE id IN (SELECT id FROM retired_source_ids);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM data_sources WHERE key IS NULL OR (key<>'dane-gov' AND key NOT LIKE 'dane-gov:%'))
    OR EXISTS (SELECT 1 FROM retained_aed_ids k LEFT JOIN aed_records a ON a.id=k.id WHERE a.id IS NULL)
    OR (SELECT count(*) FROM aed_records)<>(SELECT count(*) FROM retained_aed_ids) THEN
    RAISE EXCEPTION 'Przerwano: końcowa kontrola zachowania danych nie powiodła się.';
  END IF;
END $$;
SELECT (SELECT count(*) FROM retired_aed_ids)::int removed_aeds,
  (SELECT count(*) FROM retired_source_ids)::int removed_sources,
  (SELECT count(*) FROM aed_records)::int retained_aeds,
  (SELECT count(*) FROM source_observations)::int retained_publications;
COMMIT;
