/**
 * Speaking practice catalog.
 *
 * All topics are original to this project: generic, everyday subjects in the
 * style of a speaking test (interview → long turn → discussion). Nothing here
 * reproduces official question material.
 */

export interface SpeakingTopicSet {
  id: string;
  title: string;
  /** Short label shown on the picker card. */
  summary: string;
  /** Part 1 — short interview questions about familiar topics. */
  part1: string[];
  /** Part 2 — the individual long turn. */
  part2: { cue: string; bullets: string[] };
  /** Part 3 — discussion questions that extend the Part 2 topic. */
  part3: string[];
}

export const SPEAKING_TOPIC_SETS: SpeakingTopicSet[] = [
  {
    id: 'everyday-technology',
    title: 'Technology in daily life',
    summary: 'Devices, habits and how technology changes routines',
    part1: [
      'What piece of technology do you use most often during a normal day?',
      'Do you prefer to read the news on a phone or on paper? Why?',
      'How do you usually keep in touch with friends who live far away?',
      'Is there any technology you would rather avoid using?',
    ],
    part2: {
      cue: 'Describe a piece of technology that has made a difference to your daily routine.',
      bullets: [
        'what it is and when you started using it',
        'how often you use it',
        'what you did before you had it',
        'and explain why it has made such a difference.',
      ],
    },
    part3: [
      'Some people say technology saves time; others say it consumes it. What is your view?',
      'How might the way people work change in the next twenty years?',
      'Should schools teach children how to use technology critically? How?',
      'What are the risks when a whole society depends on a small number of digital services?',
    ],
  },
  {
    id: 'places-and-travel',
    title: 'Places and travel',
    summary: 'Memorable places, journeys and the effects of tourism',
    part1: [
      'Do you live in a city, a town or the countryside?',
      'What is your favourite place to relax near your home?',
      'How do you usually travel to work or school?',
      'Would you like to live in another country for a while?',
    ],
    part2: {
      cue: 'Describe a journey that did not go as planned.',
      bullets: [
        'where you were going and who was with you',
        'what went wrong',
        'how you dealt with the situation',
        'and explain what you learned from the experience.',
      ],
    },
    part3: [
      'Why do people enjoy visiting places very different from their own?',
      'What problems can tourism create for a small community?',
      'Is it better for a country to attract many visitors or to limit numbers? Why?',
      'How has cheap air travel changed the way people think about distance?',
    ],
  },
  {
    id: 'work-and-study',
    title: 'Work and study',
    summary: 'Learning habits, careers and changing workplaces',
    part1: [
      'Are you working or studying at the moment?',
      'What part of your work or studies do you enjoy most?',
      'Do you prefer to study alone or with other people?',
      'What job would you like to be doing in five years?',
    ],
    part2: {
      cue: 'Describe a skill you learned that changed how you work or study.',
      bullets: [
        'what the skill was',
        'how you learned it',
        'how difficult it was at the beginning',
        'and explain how it changed the way you work or study.',
      ],
    },
    part3: [
      'Should universities focus on employment or on broader education?',
      'How is remote work changing relationships between colleagues?',
      'Are formal qualifications still as important as they used to be?',
      'What responsibilities do employers have for their staff’s wellbeing?',
    ],
  },
  {
    id: 'environment-and-cities',
    title: 'Environment and cities',
    summary: 'Local environments, transport and sustainable choices',
    part1: [
      'Is there much green space where you live?',
      'How do you usually get around your area?',
      'Do you do anything to reduce waste at home?',
      'What is the weather like in your region at this time of year?',
    ],
    part2: {
      cue: 'Describe a change you would like to see in the area where you live.',
      bullets: [
        'what the change is',
        'who it would help',
        'what would need to happen first',
        'and explain why it matters to you.',
      ],
    },
    part3: [
      'Why do some environmental campaigns persuade people while others do not?',
      'Should city centres be closed to private cars? What would the consequences be?',
      'How can governments encourage people to use public transport?',
      'Is it fair to ask individuals to change when industry produces most emissions?',
    ],
  },
];

export function findSpeakingTopicSet(id: string): SpeakingTopicSet | undefined {
  return SPEAKING_TOPIC_SETS.find((set) => set.id === id);
}

export const SPEAKING_PART_META: Record<number, { label: string; prepSeconds: number; speakSeconds: number; hint: string }> = {
  1: {
    label: 'Part 1 — Interview',
    prepSeconds: 0,
    speakSeconds: 300,
    hint: 'Short answers about familiar topics. Aim for two or three sentences each.',
  },
  2: {
    label: 'Part 2 — Long turn',
    prepSeconds: 60,
    speakSeconds: 120,
    hint: 'One minute to prepare, then speak for up to two minutes. Cover every bullet point.',
  },
  3: {
    label: 'Part 3 — Discussion',
    prepSeconds: 0,
    speakSeconds: 300,
    hint: 'Longer, more abstract answers. Give reasons, examples and a conclusion.',
  },
};

/** Formats a part as one prompt string for storage and for the AI prompt. */
export function partPromptText(set: SpeakingTopicSet, part: number): string {
  if (part === 1) return set.part1.join('\n');
  if (part === 2) return `${set.part2.cue}\n- ${set.part2.bullets.join('\n- ')}`;
  return set.part3.join('\n');
}
