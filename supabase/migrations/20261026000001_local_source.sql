-- Real ad files seeded from a local folder with synthetic performance (development only).
-- Seeded once by `python -m mosaic.seed --local`; the scheduled sync jobs skip it.
alter type source_kind add value if not exists 'local';
