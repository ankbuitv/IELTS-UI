export const TUTOR_FOCUS = ['ANY', 'WRITING', 'SPEAKING', 'READING', 'LISTENING', 'VOCABULARY'] as const;
export type TutorFocus = (typeof TUTOR_FOCUS)[number];

export interface TutorConversation {
  id: string;
  title: string;
  focusSkill: TutorFocus;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
}

export interface TutorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface TutorThread {
  conversation: TutorConversation;
  messages: TutorMessage[];
}

export const TUTOR_SUGGESTIONS: Array<{ label: string; prompt: string }> = [
  {
    label: 'Chấm câu này giúp mình',
    prompt: 'Giúp mình sửa câu này cho tự nhiên hơn: “Although the weather was bad, but we decided to go out.”',
  },
  {
    label: 'Cách viết overview',
    prompt: 'Hướng dẫn mình cách viết overview cho Writing Task 1 dạng biểu đồ cột trong 2 câu.',
  },
  {
    label: 'Paraphrase thế nào',
    prompt: 'Cho mình 5 cách paraphrase “many people believe that” cho Writing Task 2.',
  },
  {
    label: 'Speaking Part 2',
    prompt: 'Gợi ý dàn ý 2 phút cho cue card: Describe a skill you learned that was difficult.',
  },
  {
    label: 'Lộ trình 6.5',
    prompt: 'Mình đang ở band 5.5, muốn lên 6.5 trong 8 tuần. Lên kế hoạch học mỗi ngày 90 phút giúp mình.',
  },
];
