/**
 * #35 AI speaking partner.
 *
 * A turn-based rehearsal: the partner asks one question at a time, the learner
 * answers, and every answer gets short coaching before the next question. The
 * final summary is qualitative — no invented band score, because bands come
 * from the marking pipeline.
 */

export type SpeakingPartnerPart = 1 | 2 | 3;

export interface SpeakingPartnerTopic {
  id: string;
  part: SpeakingPartnerPart;
  title: string;
  /** The first thing the partner says. */
  prompt: string;
  /** Questions the rules-based fallback asks when the model is unavailable. */
  followUps: string[];
  /** Language the learner should try to use. */
  focus: string;
}

export const SPEAKING_PARTNER_TOPICS: SpeakingPartnerTopic[] = [
  {
    id: 'hometown',
    part: 1,
    title: 'Your hometown',
    prompt: 'Let’s start with something familiar. Where is your hometown, and what do you like most about it?',
    followUps: [
      'What has changed in your hometown in the last few years?',
      'Would you like to live there when you are older? Why?',
    ],
    focus: 'Describing places: lively, peaceful, outskirts, it has changed a lot',
  },
  {
    id: 'work-study',
    part: 1,
    title: 'Work and study',
    prompt: 'Do you work or are you a student? Tell me a little about what you do.',
    followUps: [
      'What is the most interesting part of it?',
      'Is there anything you would like to change about it?',
    ],
    focus: 'Present simple + present perfect: I have been working…, I have just started…',
  },
  {
    id: 'free-time',
    part: 1,
    title: 'Free time',
    prompt: 'What do you usually do in your free time, and why do you enjoy it?',
    followUps: [
      'Has the way you spend your free time changed since you were a child?',
      'Do you prefer spending free time alone or with other people?',
    ],
    focus: 'Frequency and habit: tend to, usually, these days, when I was younger',
  },
  {
    id: 'journey',
    part: 2,
    title: 'A memorable journey',
    prompt:
      'Describe a journey you remember well. You should say where you went, who you travelled with, what happened, and explain why it is memorable.',
    followUps: [
      'You have one minute to prepare — then speak for up to two minutes. What happened first?',
      'What did that journey teach you?',
    ],
    focus: 'Narrative past: had been, we set off, by the time we arrived',
  },
  {
    id: 'skill',
    part: 2,
    title: 'A skill you learned',
    prompt:
      'Describe a skill you learned that was difficult at first. Say what it was, how you learned it, how long it took, and explain how you feel about it now.',
    followUps: ['What was the hardest moment?', 'Would you recommend it to someone else? Why?'],
    focus: 'Process and reflection: at first, eventually, looking back, it paid off',
  },
  {
    id: 'person',
    part: 2,
    title: 'A person who influenced you',
    prompt:
      'Describe a person who has influenced you. Say who they are, how you know them, what they did, and explain why they matter to you.',
    followUps: ['What did they teach you without realising it?', 'Do you still see them often?'],
    focus: 'Describing character: patient, encouraging, straightforward, a good listener',
  },
  {
    id: 'technology',
    part: 3,
    title: 'Technology and communication',
    prompt:
      'Some people say technology has made us communicate more but understand each other less. What do you think?',
    followUps: [
      'How has the way people meet friends changed in your country?',
      'Should schools teach children how to use social media? Why?',
    ],
    focus: 'Opinion and concession: while it is true that…, that said…, I would argue…',
  },
  {
    id: 'cities',
    part: 3,
    title: 'Cities and transport',
    prompt:
      'Many fast-growing cities are investing in public transport instead of building more roads. Is that the right priority?',
    followUps: [
      'What are the trade-offs for people who live far from the centre?',
      'How could governments persuade more people to leave their cars at home?',
    ],
    focus: 'Comparing and evaluating: whereas, cost-effective, long-term, in the short term',
  },
  {
    id: 'education',
    part: 3,
    title: 'Education and exams',
    prompt:
      'Do school exams measure what students have actually learned, or only how well they memorise?',
    followUps: [
      'What would a fairer way of assessing students look like?',
      'Is it a problem that so much teaching is shaped by exams?',
    ],
    focus: 'Speculation and hedging: it could be argued, to some extent, it depends on',
  },
];

export function topicById(id: string): SpeakingPartnerTopic | null {
  return SPEAKING_PARTNER_TOPICS.find((topic) => topic.id === id) ?? null;
}

export type PartnerFeedbackSource = 'AI' | 'RULES';

export interface PartnerTurnFeedback {
  source: PartnerFeedbackSource;
  notes: string[];
  betterPhrase: string | null;
  encourage: string | null;
}

export interface PartnerTurn {
  id: string;
  seq: number;
  role: 'PARTNER' | 'CANDIDATE';
  content: string;
  createdAt: string;
  feedback: PartnerTurnFeedback | null;
}

export interface PartnerSessionSummary {
  headline: string;
  strengths: string[];
  improvements: string[];
  nextSteps: string[];
  source: PartnerFeedbackSource;
  createdAt: string;
}

export interface PartnerSession {
  id: string;
  topicId: string;
  topicTitle: string;
  part: SpeakingPartnerPart;
  status: 'ACTIVE' | 'COMPLETED';
  turns: PartnerTurn[];
  summary: PartnerSessionSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface PartnerSessionListItem {
  id: string;
  topicId: string;
  topicTitle: string;
  part: SpeakingPartnerPart;
  status: 'ACTIVE' | 'COMPLETED';
  turnCount: number;
  preview: string;
  createdAt: string;
  updatedAt: string;
}

const LINKERS = [
  'because', 'although', 'though', 'however', 'whereas', 'while', 'for example', 'for instance',
  'as a result', 'in contrast', 'on the other hand', 'that said', 'to be honest', 'actually',
  'especially', 'which means', 'so that', 'even though', 'in fact', 'overall',
];

const FILLERS = ['um', 'uh', 'erm', 'like i said', 'you know', 'sort of', 'kind of', 'basically'];

function countWords(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/**
 * Deterministic coaching used when no model is configured (and as a safety net
 * when the model returns malformed JSON). It never invents a score.
 */
export function ruleFeedback(answer: string, topic: SpeakingPartnerTopic): PartnerTurnFeedback {
  const text = answer.trim();
  const words = countWords(text);
  const lower = text.toLowerCase();
  const notes: string[] = [];

  if (words < 12) {
    notes.push('Give a two- or three-sentence answer so there is enough language to evaluate.');
  } else if (words < 30 && topic.part === 2) {
    notes.push('In Part 2, aim for a longer turn — add one detail about how you felt or what happened next.');
  }

  const usedLinkers = LINKERS.filter((linker) => lower.includes(linker));
  if (usedLinkers.length === 0 && words >= 12) {
    notes.push('Connect your ideas with a linking phrase such as “because”, “although” or “for example”.');
  } else if (usedLinkers.length === 1) {
    notes.push(`Good use of “${usedLinkers[0]}”. Add a second contrast or reason to sound more natural.`);
  }

  const fillerHits = FILLERS.filter((filler) => new RegExp(`\\b${filler.replace(/ /g, '\\s+')}\\b`).test(lower));
  if (fillerHits.length > 0) {
    notes.push(`You used “${fillerHits[0]}” as a filler — a short silent pause sounds more confident.`);
  }

  const sentences = text.split(/[.!?]+/).filter((part) => countWords(part) > 0);
  if (sentences.length > 0 && sentences.every((sentence) => countWords(sentence) < 6)) {
    notes.push('Join some short sentences: one longer sentence with “which” or “because” shows more range.');
  }

  if (notes.length === 0) {
    notes.push('Clear answer. To push your range, add one precise adjective or a short example.');
  }
  if (notes.length > 3) notes.length = 3;

  const encourage =
    words >= 40
      ? 'That was a full, developed answer.'
      : words >= 18
        ? 'Good — you kept the answer moving.'
        : 'Thanks — a little more detail will make the next answer stronger.';

  return {
    source: 'RULES',
    notes,
    betterPhrase: null,
    encourage,
  };
}

/** The partner's next line when no model is available. */
export function nextFallbackQuestion(topic: SpeakingPartnerTopic, askedCount: number): string {
  const index = askedCount % Math.max(1, topic.followUps.length);
  return topic.followUps[index] ?? 'Could you tell me a little more about that?';
}

/** Qualitative summary, used when AI is unavailable. */
export function ruleSummary(
  topic: SpeakingPartnerTopic,
  answers: string[],
  notes: string[],
): PartnerSessionSummary {
  const totalWords = answers.reduce((total, answer) => total + countWords(answer), 0);
  const average = answers.length > 0 ? Math.round(totalWords / answers.length) : 0;

  const improvements = Array.from(new Set(notes)).slice(0, 3);
  if (improvements.length === 0) improvements.push('Keep extending answers with a reason and an example.');

  return {
    headline:
      answers.length === 0
        ? 'You ended before answering — start again when you have a minute.'
        : `You answered ${answers.length} question${answers.length === 1 ? '' : 's'} with ${totalWords} words (about ${average} per answer).`,
    strengths: [
      answers.length >= 2 ? 'You kept the conversation going across several turns.' : 'You started the topic clearly.',
      average >= 35 ? 'Your answers were developed rather than one-line replies.' : 'Your answers were easy to follow.',
    ],
    improvements,
    nextSteps: [
      `Rehearse “${topic.title}” again and use this language: ${topic.focus}.`,
      'Record one answer and listen for filler words; replace them with a short pause.',
      'Practise one Part 3 answer with a concession (“While it is true that…, I would argue…”).',
    ],
    source: 'RULES',
    createdAt: new Date().toISOString(),
  };
}
