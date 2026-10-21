/**
 * #5 Band predictor.
 *
 * A deliberately small model: least squares over recent scored attempts, in
 * weeks, with the slope capped so one lucky mock cannot promise a 9.0. The
 * result is an extrapolation for planning, not a promise, and the UI says so.
 */

export interface BandPoint {
  /** ISO timestamp of the result. */
  at: string;
  band: number;
}

export interface Projection {
  current: number | null;
  projected: number | null;
  /** Band change per week, capped at ±0.5. */
  slopePerWeek: number;
  samples: number;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  /** Days between the earliest and latest sample. */
  spanDays: number;
}

const MAX_WEEKS = 26;
const MAX_SLOPE = 0.5;

export function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

export function projectBand(points: BandPoint[], targetDate: string | Date, now: Date = new Date()): Projection {
  const usable = points
    .map((point) => ({ band: point.band, time: new Date(point.at).getTime() }))
    .filter((point) => Number.isFinite(point.band) && Number.isFinite(point.time))
    .sort((a, b) => a.time - b.time);

  if (usable.length === 0) {
    return { current: null, projected: null, slopePerWeek: 0, samples: 0, confidence: 'LOW', spanDays: 0 };
  }

  const current = usable[usable.length - 1]!.band;
  if (usable.length < 2) {
    return { current, projected: current, slopePerWeek: 0, samples: 1, confidence: 'LOW', spanDays: 0 };
  }

  const recent = usable.slice(-6);
  const firstTime = recent[0]!.time;
  const spanDays = Math.max(0, (recent[recent.length - 1]!.time - firstTime) / 86_400_000);

  // Least squares in weeks; identical timestamps collapse to a flat line.
  const xs = recent.map((point) => (point.time - firstTime) / (7 * 86_400_000));
  const ys = recent.map((point) => point.band);
  const meanX = xs.reduce((total, value) => total + value, 0) / xs.length;
  const meanY = ys.reduce((total, value) => total + value, 0) / ys.length;
  const variance = xs.reduce((total, value) => total + (value - meanX) ** 2, 0);
  let slope = variance > 0 ? xs.reduce((total, value, index) => total + (value - meanX) * (ys[index]! - meanY), 0) / variance : 0;
  slope = Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, slope));

  const target = typeof targetDate === 'string' ? new Date(targetDate) : targetDate;
  const targetTime = Number.isFinite(target.getTime()) ? target.getTime() : now.getTime();
  const weeksAhead = Math.max(0, Math.min(MAX_WEEKS, (targetTime - recent[recent.length - 1]!.time) / (7 * 86_400_000)));
  // Damped forecast: real improvement rarely follows the last few weeks
  // linearly, so only half the fitted trend is applied and the total movement is
  // capped at 1.5 bands.
  const movement = Math.max(-1.5, Math.min(1.5, slope * weeksAhead * 0.5));
  const projected = Math.max(0, Math.min(9, roundToHalf(current + movement)));

  const confidence: Projection['confidence'] =
    recent.length >= 4 && spanDays >= 14 ? 'HIGH' : recent.length >= 2 && spanDays >= 7 ? 'MEDIUM' : 'LOW';

  return {
    current,
    projected,
    slopePerWeek: Math.round(slope * 100) / 100,
    samples: recent.length,
    confidence,
    spanDays: Math.round(spanDays),
  };
}
