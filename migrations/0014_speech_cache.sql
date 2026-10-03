-- Cache of provider-generated practice audio.
--
-- Word and sentence audio used to be synthesised by the *browser*, which means
-- a learner on a device with no English voice heard nothing, and the same word
-- sounded different on every machine. With a provider configured, the platform
-- can instead generate the audio once (OpenAI-compatible `/audio/speech`) and
-- serve the identical bytes to everyone.
--
-- Generating on every request would pay the provider (and the latency) each
-- time a word is tapped, so the bytes are cached here, keyed by voice and the
-- hash of the text, and streamed straight back on a hit. The cache is bounded
-- by pruning old rows when it is written.

CREATE TABLE IF NOT EXISTS speech_cache (
  cache_key  TEXT PRIMARY KEY,
  voice      TEXT NOT NULL,
  text_hash  TEXT NOT NULL,
  mime       TEXT NOT NULL,
  data_b64   TEXT NOT NULL,
  bytes      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_speech_cache_created ON speech_cache (created_at);
