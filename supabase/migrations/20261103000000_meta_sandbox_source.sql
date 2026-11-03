-- Real ads in the Meta sandbox account, synced like a live account, with synthetic results
-- planted on their AI tags (sandbox accounts never deliver). Read with the system user token.
alter type source_kind add value if not exists 'meta_sandbox';
