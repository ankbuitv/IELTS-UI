-- Media flags ride on presence so every tile can name the person and show an
-- avatar while their camera is off (or before the first WebRTC frame arrives).
-- Polling the room is the heartbeat: each request carries the current flags.
ALTER TABLE mentor_room_presence ADD COLUMN cam_on INTEGER NOT NULL DEFAULT 1;
ALTER TABLE mentor_room_presence ADD COLUMN mic_on INTEGER NOT NULL DEFAULT 1;
