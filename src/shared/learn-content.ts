/**
 * The learning path: four units of four lessons, six words each.
 *
 * Everything here is original teaching content written for this project.
 * Words are grouped the way IELTS candidates meet them: everyday topics first,
 * then the language of Task 1 and Task 2, then a more academic range. The path
 * is static so a lesson works offline and costs nothing to serve; the AI adds
 * to the learner's notebook instead (daily words, words from marked work).
 */
import type { LearnLevel } from './learn';

export interface LearnWord {
  term: string;
  pos: string;
  /** Short English definition. */
  meaning: string;
  /** Vietnamese gloss. */
  vi: string;
  /** A sentence that contains `term` exactly as written. */
  example: string;
}

export interface LessonDef {
  id: string;
  title: string;
  blurb: string;
  words: LearnWord[];
}

export interface UnitDef {
  id: string;
  title: string;
  /** The band range the unit is pitched at. */
  band: string;
  level: LearnLevel;
  blurb: string;
  lessons: LessonDef[];
}

function w(term: string, pos: string, meaning: string, vi: string, example: string): LearnWord {
  return { term, pos, meaning, vi, example };
}

export const UNITS: UnitDef[] = [
  {
    id: 'u1',
    title: 'Foundations',
    band: 'Band 4–5',
    level: 4,
    blurb: 'Words for study, work, health and home.',
    lessons: [
      {
        id: 'u1-l1',
        title: 'Study and school',
        blurb: 'Lectures, deadlines and exams.',
        words: [
          w('lecture', 'noun', 'a talk given to a class or a large group', 'bài giảng', 'The lecture on history starts at nine.'),
          w('deadline', 'noun', 'the time by which something must be finished', 'hạn chót', 'The deadline for the essay is Friday.'),
          w('scholarship', 'noun', 'money given to a student to pay for study', 'học bổng', 'She won a scholarship to study in Australia.'),
          w('subject', 'noun', 'an area of study at school', 'môn học', 'Maths is my favourite subject.'),
          w('revise', 'verb', 'to study again before an exam', 'ôn tập', 'I need to revise before the test.'),
          w('graduate', 'verb', 'to finish a university degree', 'tốt nghiệp', 'He will graduate from university next year.'),
        ],
      },
      {
        id: 'u1-l2',
        title: 'Work and jobs',
        blurb: 'Careers, colleagues and applications.',
        words: [
          w('colleague', 'noun', 'a person you work with', 'đồng nghiệp', 'My colleague helped me finish the report.'),
          w('salary', 'noun', 'money paid to an employee each month', 'tiền lương', 'The job offers a good salary.'),
          w('career', 'noun', 'the series of jobs a person has in life', 'sự nghiệp', 'She has had a successful career in medicine.'),
          w('apply', 'verb', 'to ask formally for a job or a place', 'nộp đơn, ứng tuyển', 'Many students apply for part-time jobs.'),
          w('experience', 'noun', 'knowledge or skill from doing something', 'kinh nghiệm', 'He has five years of experience in sales.'),
          w('employer', 'noun', 'a person or company that pays workers', 'người sử dụng lao động', 'The employer offered her a full-time contract.'),
        ],
      },
      {
        id: 'u1-l3',
        title: 'Health and lifestyle',
        blurb: 'Diet, exercise and habits.',
        words: [
          w('diet', 'noun', 'the food a person usually eats', 'chế độ ăn', 'A balanced diet includes fruit and vegetables.'),
          w('exercise', 'noun', 'physical activity done to stay healthy', 'sự tập thể dục', 'Regular exercise keeps you fit.'),
          w('stress', 'noun', 'worry caused by a difficult situation', 'căng thẳng', 'Exams cause a lot of stress for students.'),
          w('habit', 'noun', 'something you do regularly without thinking', 'thói quen', 'Reading before bed is a good habit.'),
          w('fit', 'adjective', 'healthy and strong', 'khỏe mạnh, cân đối', 'He runs every morning to stay fit.'),
          w('recover', 'verb', 'to become well again after an illness', 'hồi phục', 'It took her a week to recover from the flu.'),
        ],
      },
      {
        id: 'u1-l4',
        title: 'Home and community',
        blurb: 'Neighbours, family and traditions.',
        words: [
          w('neighbour', 'noun', 'a person who lives near you', 'hàng xóm', 'My neighbour waters my plants when I am away.'),
          w('community', 'noun', 'the people who live in the same area', 'cộng đồng', 'The community built a new playground.'),
          w('relative', 'noun', 'a member of your family', 'họ hàng', 'A distant relative is staying with us this week.'),
          w('generation', 'noun', 'all the people born at around the same time', 'thế hệ', 'The older generation prefers traditional food.'),
          w('tradition', 'noun', 'a custom passed down over many years', 'truyền thống', 'Giving red envelopes is a Lunar New Year tradition.'),
          w('local', 'adjective', 'relating to the area where you live', 'địa phương', 'I buy vegetables from the local market.'),
        ],
      },
    ],
  },
  {
    id: 'u2',
    title: 'Everyday topics',
    band: 'Band 5–6',
    level: 5,
    blurb: 'The themes that keep coming back in Speaking and Writing.',
    lessons: [
      {
        id: 'u2-l1',
        title: 'Environment',
        blurb: 'Pollution, recycling and energy.',
        words: [
          w('pollution', 'noun', 'harmful substances in the air, water or soil', 'ô nhiễm', 'Air pollution is a serious problem in big cities.'),
          w('recycle', 'verb', 'to process used materials so they can be used again', 'tái chế', 'We recycle paper and plastic bottles at home.'),
          w('climate', 'noun', 'the usual weather of a region over a long time', 'khí hậu', 'The climate here is hot and humid.'),
          w('protect', 'verb', 'to keep something safe from harm', 'bảo vệ', 'We must protect endangered animals.'),
          w('waste', 'noun', 'things that are thrown away', 'rác thải', 'Food waste can be turned into compost.'),
          w('renewable', 'adjective', 'able to be replaced naturally, like wind or solar power', 'có thể tái tạo', 'Solar power is a renewable source of energy.'),
        ],
      },
      {
        id: 'u2-l2',
        title: 'Technology',
        blurb: 'Devices, software and the internet.',
        words: [
          w('device', 'noun', 'a machine or tool made for a purpose', 'thiết bị', 'Most teenagers own at least one digital device.'),
          w('software', 'noun', 'programs that run on a computer', 'phần mềm', 'The company develops educational software.'),
          w('online', 'adverb', 'connected to the internet', 'trực tuyến', 'Many people now shop online.'),
          w('invent', 'verb', 'to create something new for the first time', 'phát minh', 'Who invented the telephone?'),
          w('update', 'verb', 'to make something more modern or current', 'cập nhật', 'Remember to update your phone regularly.'),
          w('rely', 'verb', 'to depend on someone or something', 'phụ thuộc, dựa vào', 'Many students rely on the internet for research.'),
        ],
      },
      {
        id: 'u2-l3',
        title: 'Travel and tourism',
        blurb: 'Destinations, journeys and where to stay.',
        words: [
          w('destination', 'noun', 'the place someone is travelling to', 'điểm đến', 'Da Nang is a popular holiday destination.'),
          w('luggage', 'noun', 'the bags and cases you take when you travel', 'hành lý', 'Please keep your luggage with you at all times.'),
          w('journey', 'noun', 'the act of travelling from one place to another', 'chuyến đi', 'The journey from Hanoi to Hue takes about an hour by plane.'),
          w('accommodation', 'noun', 'a place to stay, such as a hotel', 'chỗ ở', 'Cheap accommodation is easy to find near the beach.'),
          w('sightseeing', 'noun', 'visiting interesting places as a tourist', 'tham quan', 'We spent the day sightseeing in the old town.'),
          w('passport', 'noun', 'an official document that lets you travel abroad', 'hộ chiếu', 'Do not forget your passport at the airport.'),
        ],
      },
      {
        id: 'u2-l4',
        title: 'Cities and housing',
        blurb: 'Traffic, rent and public transport.',
        words: [
          w('traffic', 'noun', 'vehicles moving along roads', 'giao thông', 'Traffic is heavy in the city centre at rush hour.'),
          w('suburb', 'noun', 'an area on the edge of a city where people live', 'vùng ngoại ô', 'They moved to a quiet suburb with a garden.'),
          w('rent', 'noun', 'money paid regularly to use a home', 'tiền thuê nhà', 'The rent in the city centre keeps rising.'),
          w('crowded', 'adjective', 'full of people', 'đông đúc', 'The market is always crowded at weekends.'),
          w('public transport', 'noun', 'buses, trains and other shared transport', 'phương tiện công cộng', 'Public transport is cheaper than owning a car.'),
          w('facilities', 'noun', 'buildings or services provided for a purpose', 'cơ sở vật chất, tiện ích', 'The town has excellent sports facilities.'),
        ],
      },
    ],
  },
  {
    id: 'u3',
    title: 'Task language',
    band: 'Band 6–7',
    level: 6,
    blurb: 'The phrases that make Writing Task 1 and Task 2 read like a higher band.',
    lessons: [
      {
        id: 'u3-l1',
        title: 'Describing trends',
        blurb: 'Task 1: rises, falls and peaks.',
        words: [
          w('fluctuate', 'verb', 'to go up and down', 'dao động', 'Prices fluctuate between 20 and 30 dollars.'),
          w('peak', 'verb', 'to reach the highest point', 'đạt đỉnh', 'Sales peak at 500 units in July.'),
          w('decline', 'verb', 'to become smaller or less', 'giảm xuống', 'The number of visitors began to decline after 2015.'),
          w('stable', 'adjective', 'not changing much', 'ổn định', 'Unemployment stayed stable at five percent.'),
          w('dramatic', 'adjective', 'sudden and very large', 'đột ngột, mạnh mẽ', 'There was a dramatic rise in car ownership.'),
          w('approximately', 'adverb', 'about, not exactly', 'xấp xỉ', 'Approximately 60 percent of students passed the exam.'),
        ],
      },
      {
        id: 'u3-l2',
        title: 'Cause and effect',
        blurb: 'Task 2: explain why things happen.',
        words: [
          w('consequently', 'adverb', 'as a result', 'do đó, vì vậy', 'Prices rose; consequently, fewer people travelled.'),
          w('lead to', 'phrase', 'to cause something', 'dẫn đến', 'Poor diet can lead to serious health problems.'),
          w('due to', 'phrase', 'because of', 'do, bởi vì', 'Many flights were cancelled due to bad weather.'),
          w('result in', 'phrase', 'to have something as an outcome', 'gây ra, dẫn đến kết quả', 'Careless driving can result in accidents.'),
          w('impact', 'noun', 'a strong effect', 'tác động', 'Social media has a big impact on teenagers.'),
          w('contribute', 'verb', 'to help to cause something', 'góp phần', 'Cars contribute to air pollution.'),
        ],
      },
      {
        id: 'u3-l3',
        title: 'Opinions and arguments',
        blurb: 'Take a position and defend it.',
        words: [
          w('argue', 'verb', 'to give reasons to support an idea', 'lập luận', 'Some people argue that homework is unnecessary.'),
          w('perspective', 'noun', 'a way of thinking about something', 'góc nhìn, quan điểm', "From a teacher's perspective, small classes work best."),
          w('advantage', 'noun', 'a good point that helps you', 'ưu điểm', 'One advantage of online study is flexibility.'),
          w('drawback', 'noun', 'a disadvantage or problem', 'nhược điểm', 'The main drawback is the cost.'),
          w('controversial', 'adjective', 'causing a lot of disagreement', 'gây tranh cãi', 'Animal testing is a controversial topic.'),
          w('convince', 'verb', 'to make someone believe something', 'thuyết phục', 'The statistics convince me that change is needed.'),
        ],
      },
      {
        id: 'u3-l4',
        title: 'Contrast and concession',
        blurb: 'Link opposite ideas smoothly.',
        words: [
          w('however', 'adverb', 'used to introduce a contrasting idea', 'tuy nhiên', 'Cities offer jobs. However, living costs are high.'),
          w('whereas', 'conjunction', 'used to compare two different things', 'trong khi', 'Some students like groups, whereas others prefer to work alone.'),
          w('nevertheless', 'adverb', 'in spite of that', 'tuy vậy', 'The test was hard; nevertheless, most students passed.'),
          w('although', 'conjunction', 'despite the fact that', 'mặc dù', 'Although it was raining, we went for a walk.'),
          w('on the other hand', 'phrase', 'used to give an opposite point', 'mặt khác', 'Cars are convenient. On the other hand, they cause pollution.'),
          w('in contrast', 'phrase', 'used to show a clear difference', 'ngược lại', 'Cities grew quickly. In contrast, rural areas lost population.'),
        ],
      },
    ],
  },
  {
    id: 'u4',
    title: 'Academic range',
    band: 'Band 7+',
    level: 7,
    blurb: 'Precise verbs, abstract nouns and collocations for a top score.',
    lessons: [
      {
        id: 'u4-l1',
        title: 'Academic verbs',
        blurb: 'Say more with one precise verb.',
        words: [
          w('mitigate', 'verb', 'to make something less harmful', 'giảm nhẹ', 'Trees can mitigate the effects of heat in cities.'),
          w('exacerbate', 'verb', 'to make a problem worse', 'làm trầm trọng thêm', 'Cheap fuel may exacerbate traffic congestion.'),
          w('undermine', 'verb', 'to weaken something gradually', 'làm suy yếu', "Constant criticism can undermine a child's confidence."),
          w('advocate', 'verb', 'to publicly support an idea', 'ủng hộ, chủ trương', 'Many experts advocate a shorter working week.'),
          w('alleviate', 'verb', 'to make a problem less severe', 'làm dịu bớt', 'New buses could alleviate overcrowding.'),
          w('constitute', 'verb', 'to be or to form something', 'cấu thành, chiếm', 'Young people constitute 40 percent of the workforce.'),
        ],
      },
      {
        id: 'u4-l2',
        title: 'Abstract nouns',
        blurb: 'Name ideas, not just things.',
        words: [
          w('phenomenon', 'noun', 'something that exists or happens, especially a remarkable thing', 'hiện tượng', 'Urbanisation is a global phenomenon.'),
          w('implication', 'noun', 'a possible effect or result', 'hệ quả, hàm ý', 'One implication of the study is that sleep matters.'),
          w('disparity', 'noun', 'a large and unfair difference', 'sự chênh lệch', 'There is a growing disparity between rich and poor.'),
          w('incentive', 'noun', 'something that encourages you to act', 'động lực, ưu đãi', 'Tax breaks are an incentive to buy electric cars.'),
          w('infrastructure', 'noun', 'basic systems such as roads, power and water', 'cơ sở hạ tầng', 'Rapid growth requires better infrastructure.'),
          w('consumption', 'noun', 'the amount of something that is used', 'sự tiêu thụ', 'Energy consumption has doubled in thirty years.'),
        ],
      },
      {
        id: 'u4-l3',
        title: 'Formal alternatives',
        blurb: 'Upgrade everyday words.',
        words: [
          w('substantial', 'adjective', 'large in amount or importance', 'đáng kể', 'There was a substantial increase in tourism.'),
          w('subsequently', 'adverb', 'after that', 'sau đó', 'She subsequently moved abroad to study.'),
          w('widespread', 'adjective', 'found in many places or among many people', 'phổ biến rộng rãi', 'Obesity is now a widespread problem.'),
          w('crucial', 'adjective', 'extremely important', 'then chốt, cực kỳ quan trọng', 'Sleep is crucial for learning.'),
          w('inevitable', 'adjective', 'certain to happen', 'không thể tránh khỏi', 'Some job losses are inevitable as machines improve.'),
          w('acknowledge', 'verb', 'to accept that something is true', 'thừa nhận', 'Many experts acknowledge that the problem is complex.'),
        ],
      },
      {
        id: 'u4-l4',
        title: 'Collocations for essays',
        blurb: 'Word partners examiners expect.',
        words: [
          w('play a role', 'phrase', 'to have an effect on something', 'đóng vai trò', "Parents should play a role in choosing their child's career."),
          w('raise awareness', 'phrase', 'to help people understand an issue', 'nâng cao nhận thức', 'Schools can raise awareness of healthy eating.'),
          w('take measures', 'phrase', 'to act in order to deal with a problem', 'thực hiện biện pháp', 'Governments must take measures to cut emissions.'),
          w('pose a threat', 'phrase', 'to be a danger to something', 'gây ra mối đe dọa', 'Plastic waste can pose a threat to marine life.'),
          w('make a difference', 'phrase', 'to have a positive effect', 'tạo ra sự khác biệt', 'Small changes in daily habits can make a difference.'),
          w('strike a balance', 'phrase', 'to find a fair middle position', 'tìm sự cân bằng', 'Students need to strike a balance between study and rest.'),
        ],
      },
    ],
  },
];

export interface FlatLesson extends LessonDef {
  unitId: string;
  unitTitle: string;
  level: LearnLevel;
  /** Position in the whole path, from 0. */
  index: number;
}

/** Every lesson in path order, with its unit attached. */
export const LESSONS: FlatLesson[] = UNITS.flatMap((unit, unitIndex) =>
  unit.lessons.map((lesson, lessonIndex) => ({
    ...lesson,
    unitId: unit.id,
    unitTitle: unit.title,
    level: unit.level,
    index: unitIndex * 4 + lessonIndex,
  })),
);

export function lessonById(id: string): FlatLesson | null {
  return LESSONS.find((lesson) => lesson.id === id) ?? null;
}

/** Every word in the built-in bank, lowercase-keyed, with the level of the unit it comes from. */
export const WORD_BANK: Array<LearnWord & { level: LearnLevel }> = LESSONS.flatMap((lesson) =>
  lesson.words.map((word) => ({ ...word, level: lesson.level })),
);

export function findBankWord(term: string): (LearnWord & { level: LearnLevel }) | null {
  const key = term.trim().toLowerCase();
  return WORD_BANK.find((word) => word.term.toLowerCase() === key) ?? null;
}

/** The first lesson of the first unit at or above a level: where a new learner starts. */
export function startIndexForLevel(level: LearnLevel): number {
  const found = LESSONS.find((lesson) => lesson.level >= level);
  return found ? found.index : 0;
}

/**
 * Lesson `i` is open when it is next after the furthest finished lesson, or
 * when it sits at or before the learner's starting level. Anything earlier is
 * always open, so a learner can go back and practise.
 */
export function unlockedThrough(furthestCompleted: number, level: LearnLevel): number {
  return Math.max(furthestCompleted + 1, startIndexForLevel(level));
}
