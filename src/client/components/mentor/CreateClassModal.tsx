import { useState } from 'react';
import { describeError } from '../../lib/api';
import { mentorApi } from '../../lib/mentor-api';
import { Button, Field, Modal, Select, TextInput, useToast } from '../ui';
import type { MentorClass } from '@shared/mentor';

const CAPACITY_OPTIONS = [4, 6, 8, 10, 12, 16, 20, 24, 30, 40, 50, 80, 100, 150, 200, 300, 500, 1000, 2000, 5000];

function isoLocal(daysAhead: number, hour: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

/**
 * The mentor's "Open a class" form — reusable from the mentor console and the
 * classes directory, so any mentor (or admin) can publish a classroom.
 */
export function CreateClassModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (created: MentorClass) => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState('Band 6.0–7.0');
  const [capacity, setCapacity] = useState('10');
  const [priceCoins, setPriceCoins] = useState('400');
  const [startsAt, setStartsAt] = useState(isoLocal(3, 19));
  const [endsAt, setEndsAt] = useState(isoLocal(10, 21));
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Open a class"
      wide
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              if (!title.trim()) {
                toast.push('Give the class a title first.', 'error');
                return;
              }
              setBusy(true);
              try {
                const result = await mentorApi.createClass({
                  title: title.trim(),
                  description: description.trim(),
                  level,
                  capacity: Number(capacity),
                  priceCoins: Number(priceCoins),
                  startsAt,
                  endsAt,
                });
                onCreated?.(result.class);
                onClose();
              } catch (createError) {
                toast.push(describeError(createError), 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            Publish class
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="small muted" style={{ marginTop: 0 }}>
          Publish a small cohort with its own schedule, group chat and call room.
        </p>
        <Field label="Title" required>
          {(id) => (
            <TextInput
              id={id}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="IELTS Speaking Mock Sprint"
            />
          )}
        </Field>
        <Field label="Description" hint="What will members do and finish with?">
          {(id) => (
            <TextInput
              id={id}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Four live speaking rounds, feedback and band strategies."
            />
          )}
        </Field>
        <Field label="Level">
          {(id) => (
            <Select id={id} value={level} onChange={(event) => setLevel(event.target.value)}>
              <option>All levels</option>
              <option>Band 4.5–5.5</option>
              <option>Band 6.0–7.0</option>
              <option>Band 7.0+</option>
            </Select>
          )}
        </Field>
        <div className="row" style={{ gap: 12 }}>
          <Field label="Capacity">
            {(id) => (
              <Select id={id} value={capacity} onChange={(event) => setCapacity(event.target.value)}>
                {CAPACITY_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size} seats
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Price (coins)" hint="0 makes the class free.">
            {(id) => <TextInput id={id} value={priceCoins} onChange={(event) => setPriceCoins(event.target.value)} inputMode="numeric" />}
          </Field>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <Field label="Starts">
            {(id) => <TextInput id={id} type="datetime-local" value={startsAt.slice(0, 16)} onChange={(event) => setStartsAt(new Date(event.target.value).toISOString())} />}
          </Field>
          <Field label="Ends">
            {(id) => <TextInput id={id} type="datetime-local" value={endsAt.slice(0, 16)} onChange={(event) => setEndsAt(new Date(event.target.value).toISOString())} />}
          </Field>
        </div>
      </div>
    </Modal>
  );
}
