-- Queue order reflects the time a present participant most recently raised their hand.
ALTER TABLE mentor_room_presence ADD COLUMN hand_raised_at TEXT;
