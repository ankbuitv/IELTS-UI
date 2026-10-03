/**
 * The built-in lesson seed, used to fill the catalogue the first time it is read.
 *
 * Everything here is original teaching content written for this project.
 * Words are grouped the way IELTS candidates meet them and every lesson is
 * tagged with the half band it is pitched at, so the path runs from 4.0 to 8.0.
 *
 * This module is a SEED, not the live catalogue: lessons live in the
 * `learn_lessons` table and are served by the catalogue API, which is how an
 * administrator can later add AI-generated lessons at any band without a
 * deploy. It is imported by the worker (to seed) and by tests (to check the
 * content is well formed) — the client never imports it, so none of this text
 * ends up in the browser bundle.
 */
import type { LearnBand, LessonWord } from './learn';

export type { LessonWord };

/** The engine and its tests have always called a lesson word `LearnWord`; it is the same type. */
export type LearnWord = LessonWord;

export interface LessonDef {
  id: string;
  title: string;
  blurb: string;
  words: LessonWord[];
}

export interface UnitDef {
  id: string;
  title: string;
  /** The half band the unit is pitched at. */
  band: LearnBand;
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
    band: 4,
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
    id: 'u5',
    title: 'Everyday basics',
    band: 4.5,
    blurb: 'The words of food, shopping, travel and weather.',
    lessons: [
      {
        id: 'u5-l1',
        title: 'Food and cooking',
        blurb: 'Cooking, meals and flavours.',
        words: [
          w('ingredient', 'noun', 'a food item used to make a dish', 'nguyên liệu', 'Fresh ingredients make the dish taste better.'),
          w('recipe', 'noun', 'instructions for preparing a dish', 'công thức nấu ăn', 'My grandmother gave me her recipe for soup.'),
          w('boil', 'verb', 'to heat a liquid until it bubbles', 'luộc, đun sôi', 'Boil the water before you add the rice.'),
          w('tasty', 'adjective', 'having a pleasant flavour', 'ngon miệng', 'The street food here is cheap and tasty.'),
          w('meal', 'noun', 'food eaten at one time, such as lunch', 'bữa ăn', 'Breakfast is the most important meal of the day.'),
          w('fry', 'verb', 'to cook food in hot oil', 'rán, chiên', 'I fry the eggs in a little butter.'),
        ],
      },
      {
        id: 'u5-l2',
        title: 'Shopping and money',
        blurb: 'Prices, payments and good deals.',
        words: [
          w('price', 'noun', 'the amount of money something costs', 'giá cả', 'The price of coffee has risen this year.'),
          w('discount', 'noun', 'a reduction in the usual price', 'sự giảm giá', 'Students get a ten percent discount here.'),
          w('receipt', 'noun', 'a paper that proves you paid', 'biên lai, hóa đơn', 'Keep the receipt in case you return the shirt.'),
          w('bargain', 'noun', 'something bought for less than its real value', 'món hời', 'These shoes were a real bargain.'),
          w('afford', 'verb', 'to have enough money to pay for something', 'có đủ tiền', 'Few families can afford a new car.'),
          w('customer', 'noun', 'a person who buys from a shop', 'khách hàng', 'The customer asked for a smaller size.'),
        ],
      },
      {
        id: 'u5-l3',
        title: 'Getting around',
        blurb: 'Tickets, stations and journeys.',
        words: [
          w('ticket', 'noun', 'a paper or card that allows you to travel', 'vé', 'I bought a return ticket to the coast.'),
          w('platform', 'noun', 'the area where you wait for a train', 'sân ga', 'The train leaves from platform four.'),
          w('delay', 'noun', 'a period when something is later than planned', 'sự chậm trễ', 'A signal fault caused a long delay.'),
          w('route', 'noun', 'the way taken to get somewhere', 'tuyến đường', 'This bus route passes the university.'),
          w('fare', 'noun', 'the money paid for a journey', 'giá vé', 'The bus fare increased last month.'),
          w('passenger', 'noun', 'a person travelling in a vehicle', 'hành khách', 'Every passenger must fasten the seatbelt.'),
        ],
      },
      {
        id: 'u5-l4',
        title: 'Weather and seasons',
        blurb: 'Talking about the weather accurately.',
        words: [
          w('temperature', 'noun', 'how hot or cold the air is', 'nhiệt độ', 'The temperature dropped below zero last night.'),
          w('humid', 'adjective', 'having a lot of moisture in the air', 'ẩm ướt', 'Summer afternoons are hot and humid here.'),
          w('forecast', 'noun', 'a statement about future weather', 'dự báo thời tiết', 'The forecast promised sunshine all weekend.'),
          w('shower', 'noun', 'a short period of rain', 'cơn mưa rào', 'A sudden shower ruined the match.'),
          w('breeze', 'noun', 'a gentle wind', 'cơn gió nhẹ', 'A cool breeze came off the river.'),
          w('freeze', 'verb', 'to become hard because of cold', 'đóng băng', 'Water in the pipes can freeze in winter.'),
        ],
      },
    ],
  },
  {
    id: 'u2',
    title: 'Everyday topics',
    band: 5,
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
    id: 'u6',
    title: 'Wider topics',
    band: 5.5,
    blurb: 'The topics that fill Speaking Part 3 and Task 2.',
    lessons: [
      {
        id: 'u6-l1',
        title: 'Education and training',
        blurb: 'Courses, fees and qualifications.',
        words: [
          w('curriculum', 'noun', 'the subjects taught in a course', 'chương trình học', 'The school changed its science curriculum.'),
          w('tuition', 'noun', 'money paid for teaching', 'học phí', 'University tuition rose sharply this year.'),
          w('certificate', 'noun', 'an official paper proving a qualification', 'chứng chỉ', 'She received a certificate after the course.'),
          w('seminar', 'noun', 'a small class held for discussion', 'buổi hội thảo', 'The seminar on research methods was useful.'),
          w('assessment', 'noun', 'a judgement of the quality of work', 'bài đánh giá', 'The final assessment counts for half the mark.'),
          w('literacy', 'noun', 'the ability to read and write', 'năng lực đọc viết', 'Literacy rates have improved in rural areas.'),
        ],
      },
      {
        id: 'u6-l2',
        title: 'Media and news',
        blurb: 'How stories reach the public.',
        words: [
          w('headline', 'noun', 'the title of a newspaper story', 'tiêu đề báo', 'The story made the front page headline.'),
          w('broadcast', 'verb', 'to send a programme by radio or television', 'phát sóng', 'The channel will broadcast the debate live.'),
          w('journalist', 'noun', 'a person who reports the news', 'nhà báo', 'The journalist interviewed three witnesses.'),
          w('audience', 'noun', 'the people who watch or listen', 'khán giả', 'The film attracted a young audience.'),
          w('advertising', 'noun', 'the activity of promoting products', 'hoạt động quảng cáo', 'Advertising for sugary drinks is now restricted.'),
          w('source', 'noun', 'a place where information comes from', 'nguồn thông tin', 'Always check the source of a claim.'),
        ],
      },
      {
        id: 'u6-l3',
        title: 'Sport and fitness',
        blurb: 'Training, competing and staying well.',
        words: [
          w('competition', 'noun', 'an event where people try to win', 'cuộc thi đấu', 'The competition attracted runners from ten countries.'),
          w('athlete', 'noun', 'a person who is good at sport', 'vận động viên', 'The athlete broke the national record.'),
          w('training', 'noun', 'regular practice to improve a skill', 'sự luyện tập', 'Her training includes swimming every morning.'),
          w('injury', 'noun', 'damage to the body from an accident', 'chấn thương', 'A knee injury ended his season.'),
          w('stamina', 'noun', 'the ability to keep going for a long time', 'sức bền', 'Long runs build stamina slowly.'),
          w('coach', 'noun', 'a person who trains a team or player', 'huấn luyện viên', 'The coach changed the tactics at half time.'),
        ],
      },
      {
        id: 'u6-l4',
        title: 'Society and culture',
        blurb: 'People, groups and fairness.',
        words: [
          w('population', 'noun', 'all the people living in a place', 'dân số', 'The population of the city doubled in twenty years.'),
          w('inequality', 'noun', 'an unfair difference between groups', 'sự bất bình đẳng', 'Income inequality widened after the crisis.'),
          w('migration', 'noun', 'the movement of people to a new place', 'sự di cư', 'Migration reshaped the labour market.'),
          w('welfare', 'noun', 'support given to people in need', 'phúc lợi xã hội', 'The state provides welfare for elderly citizens.'),
          w('equality', 'noun', 'the state of having the same rights', 'sự bình đẳng', 'Gender equality is still unfinished business.'),
          w('minority', 'noun', 'a smaller group within a society', 'nhóm thiểu số', 'The policy protects every minority group.'),
        ],
      },
    ],
  },
  {
    id: 'u3',
    title: 'Task language',
    band: 6,
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
    id: 'u7',
    title: 'Task range',
    band: 6.5,
    blurb: 'More of the machinery behind a clear Task 1 and Task 2.',
    lessons: [
      {
        id: 'u7-l1',
        title: 'Comparing data',
        blurb: 'Shares, ratios and ordered figures.',
        words: [
          w('proportion', 'noun', 'a part or share of a whole', 'tỷ lệ, phần', 'A large proportion of students live at home.'),
          w('respectively', 'adverb', 'in the order just mentioned', 'lần lượt là', 'The two teams scored thirty and twenty points respectively.'),
          w('majority', 'noun', 'the larger part of a group', 'phần lớn', 'The majority of respondents agreed with the plan.'),
          w('ratio', 'noun', 'the relationship between two amounts', 'tỷ số', 'The ratio of teachers to pupils has fallen.'),
          w('twofold', 'adjective', 'twice as large as before', 'gấp đôi', 'Sales showed a twofold increase in a year.'),
          w('outnumber', 'verb', 'to be greater in number than', 'nhiều hơn về số lượng', 'Women outnumber men in this profession.'),
        ],
      },
      {
        id: 'u7-l2',
        title: 'Processes and stages',
        blurb: 'Describing how something is made or done.',
        words: [
          w('initially', 'adverb', 'at the beginning', 'ban đầu', 'The results were initially promising.'),
          w('thereafter', 'adverb', 'after that point in time', 'sau đó', 'He moved abroad and thereafter rarely returned.'),
          w('simultaneously', 'adverb', 'at exactly the same time', 'đồng thời', 'The two reactions occur simultaneously.'),
          w('convert', 'verb', 'to change something into another form', 'chuyển đổi', 'The plant converts waste into energy.'),
          w('assemble', 'verb', 'to put separate parts together', 'lắp ráp', 'Workers assemble the frames by hand.'),
          w('undergo', 'verb', 'to experience a change or process', 'trải qua', 'Many districts undergo rapid change.'),
        ],
      },
      {
        id: 'u7-l3',
        title: 'Problems and solutions',
        blurb: 'Naming a difficulty and answering it.',
        words: [
          w('obstacle', 'noun', 'something that blocks progress', 'trở ngại', 'Cost remains the main obstacle to reform.'),
          w('remedy', 'noun', 'a way of fixing a problem', 'giải pháp khắc phục', 'There is no simple remedy for congestion.'),
          w('shortage', 'noun', 'a situation where there is not enough', 'sự thiếu hụt', 'A labour shortage slowed the project.'),
          w('tackle', 'verb', 'to try hard to deal with a problem', 'giải quyết', 'Cities must tackle air quality urgently.'),
          w('sustainable', 'adjective', 'able to continue without harming the future', 'bền vững', 'The plan promotes sustainable farming.'),
          w('deteriorate', 'verb', 'to become worse over time', 'xấu đi', 'Air quality deteriorated over the decade.'),
        ],
      },
      {
        id: 'u7-l4',
        title: 'Qualifying claims',
        blurb: 'Saying how sure you are.',
        words: [
          w('presumably', 'adverb', 'used to say something is probably true', 'có lẽ là', 'The delay was presumably caused by weather.'),
          w('arguably', 'adverb', 'used to say an opinion can be defended', 'có thể cho là', 'This is arguably the finest example.'),
          w('largely', 'adverb', 'mostly, but not completely', 'phần lớn là', 'The claim is largely supported by evidence.'),
          w('somewhat', 'adverb', 'to a small degree', 'hơi, có phần', 'The findings were somewhat surprising.'),
          w('tend to', 'phrase', 'to usually behave in a particular way', 'có xu hướng', 'Prices tend to rise before the holiday.'),
          w('virtually', 'adverb', 'almost completely', 'gần như', 'The town is virtually empty in winter.'),
        ],
      },
    ],
  },
  {
    id: 'u4',
    title: 'Academic range',
    band: 7,
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
  {
    id: 'u8',
    title: 'Academic precision',
    band: 7.5,
    blurb: 'The control that separates a good answer from a precise one.',
    lessons: [
      {
        id: 'u8-l1',
        title: 'Hedging language',
        blurb: 'Claiming no more than the evidence allows.',
        words: [
          w('plausible', 'adjective', 'seeming reasonable or probable', 'có vẻ hợp lý', 'The author offers a plausible explanation.'),
          w('tentative', 'adjective', 'not certain or final', 'dè dặt, tạm thời', 'She drew a tentative conclusion from the data.'),
          w('caveat', 'noun', 'a warning about limits or conditions', 'lưu ý dè dặt', 'The findings come with an important caveat.'),
          w('apparent', 'adjective', 'easy to see or understand', 'rõ ràng, hiển nhiên', 'The difference was apparent from the first chart.'),
          w('purported', 'adjective', 'claimed to be true but not proven', 'được cho là', 'The purported benefits were never tested.'),
          w('seemingly', 'adverb', 'according to how things appear', 'có vẻ như', 'A seemingly small change had large effects.'),
        ],
      },
      {
        id: 'u8-l2',
        title: 'Cause and mechanism',
        blurb: 'Explaining how one thing produces another.',
        words: [
          w('trigger', 'verb', 'to cause something to start', 'kích hoạt', 'The report triggered a public debate.'),
          w('stem from', 'phrase', 'to be caused by something', 'bắt nguồn từ', 'Most errors stem from poor planning.'),
          w('give rise to', 'phrase', 'to cause something to happen', 'dẫn đến', 'New roads give rise to further building.'),
          w('catalyst', 'noun', 'something that speeds up a change', 'tác nhân thúc đẩy', 'The scandal was a catalyst for reform.'),
          w('chain reaction', 'noun', 'a series of events each causing the next', 'phản ứng dây chuyền', 'One failure set off a chain reaction.'),
          w('precipitate', 'verb', 'to cause something to happen suddenly', 'đẩy nhanh, gây ra', 'The strike precipitated the collapse.'),
        ],
      },
      {
        id: 'u8-l3',
        title: 'Evaluation and judgement',
        blurb: 'Judging evidence and arguments.',
        words: [
          w('compelling', 'adjective', 'convincing and holding attention', 'thuyết phục', 'The paper makes a compelling case.'),
          w('dubious', 'adjective', 'not able to be relied on', 'đáng ngờ', 'The evidence for that claim is dubious.'),
          w('rigorous', 'adjective', 'very careful and exact', 'chặt chẽ', 'The study followed a rigorous method.'),
          w('superficial', 'adjective', 'concerned only with the surface', 'hời hợt', 'The analysis remained superficial.'),
          w('robust', 'adjective', 'strong and unlikely to fail', 'vững chắc', 'The results were robust across samples.'),
          w('flawed', 'adjective', 'containing mistakes', 'có sai sót', 'The argument is fundamentally flawed.'),
        ],
      },
      {
        id: 'u8-l4',
        title: 'Cohesion and reference',
        blurb: 'Linking ideas without repeating them.',
        words: [
          w('aforementioned', 'adjective', 'mentioned earlier in the text', 'đã nêu ở trên', 'The aforementioned limits apply here.'),
          w('whereby', 'conjunction', 'by which, through which', 'theo đó', 'They signed a deal whereby costs were shared.'),
          w('notwithstanding', 'preposition', 'in spite of something', 'mặc dù', 'Notwithstanding the criticism, the plan continued.'),
          w('therein', 'adverb', 'in that place or matter', 'trong đó', 'The report and the errors therein were noted.'),
          w('likewise', 'adverb', 'in the same way', 'tương tự như vậy', 'Sales rose and profits likewise increased.'),
          w('albeit', 'conjunction', 'although, even if', 'dù rằng', 'He agreed, albeit with some hesitation.'),
        ],
      },
    ],
  },
  {
    id: 'u9',
    title: 'Refined academic',
    band: 8,
    blurb: 'Nuance, density and emphasis at the top of the scale.',
    lessons: [
      {
        id: 'u9-l1',
        title: 'Nuance and connotation',
        blurb: 'Words that carry more than their surface sense.',
        words: [
          w('overt', 'adjective', 'done openly and not hidden', 'công khai, rõ rệt', 'There was overt resistance to the change.'),
          w('tacit', 'adjective', 'understood without being stated', 'ngầm hiểu', 'They reached a tacit agreement.'),
          w('salient', 'adjective', 'most noticeable or important', 'nổi bật nhất', 'The summary lists the salient points.'),
          w('stark', 'adjective', 'very clear and unpleasant', 'rõ rệt, trần trụi', 'The contrast between the two regions is stark.'),
          w('nuanced', 'adjective', 'showing small but important differences', 'tinh tế, nhiều sắc thái', 'Her account is nuanced and careful.'),
          w('pervasive', 'adjective', 'spread through every part', 'lan tràn', 'Corruption was pervasive in the sector.'),
        ],
      },
      {
        id: 'u9-l2',
        title: 'Academic idioms',
        blurb: 'Fixed phrases used in serious writing.',
        words: [
          w('bear out', 'phrase', 'to confirm that something is true', 'chứng thực', 'Later studies bear out the original claim.'),
          w('boil down to', 'phrase', 'to have something as the main cause', 'quy lại là', 'The dispute will boil down to funding.'),
          w('in the wake of', 'phrase', 'following closely after an event', 'ngay sau, theo sau', 'Prices rose in the wake of the shortage.'),
          w('at the heart of', 'phrase', 'at the centre of something', 'là trọng tâm của', 'Trust lies at the heart of good teaching.'),
          w('shed light on', 'phrase', 'to help explain something', 'làm sáng tỏ', 'New data can shed light on the cause.'),
          w('run counter to', 'phrase', 'to be the opposite of', 'đi ngược lại', 'These findings run counter to popular belief.'),
        ],
      },
      {
        id: 'u9-l3',
        title: 'Density and nominalisation',
        blurb: 'Packing more meaning into fewer words.',
        words: [
          w('implementation', 'noun', 'the process of putting a plan into action', 'việc triển khai', 'Implementation took longer than expected.'),
          w('proliferation', 'noun', 'a rapid increase in number', 'sự gia tăng nhanh', 'The proliferation of small screens changed reading.'),
          w('discrepancy', 'noun', 'a difference that should not exist', 'sự chênh lệch', 'A discrepancy between the two sets appeared.'),
          w('constraint', 'noun', 'a limit on what can be done', 'ràng buộc', 'A budget constraint forced a smaller trial.'),
          w('prerequisite', 'noun', 'something needed before anything else', 'điều kiện tiên quyết', 'Literacy is a prerequisite for further study.'),
          w('inference', 'noun', 'a conclusion drawn from evidence', 'suy luận', 'The inference rests on thin evidence.'),
        ],
      },
      {
        id: 'u9-l4',
        title: 'Rhetorical emphasis',
        blurb: 'Stressing a point with force.',
        words: [
          w('paramount', 'adjective', 'more important than anything else', 'tối quan trọng', 'Patient safety is paramount in any hospital.'),
          w('indispensable', 'adjective', 'too important to do without', 'không thể thiếu', 'Statistics is indispensable to modern research.'),
          w('unequivocal', 'adjective', 'leaving no doubt at all', 'không mơ hồ', 'The verdict was unequivocal.'),
          w('inextricable', 'adjective', 'impossible to separate', 'không thể tách rời', 'Poverty and poor health form an inextricable link.'),
          w('untenable', 'adjective', 'impossible to defend or maintain', 'không thể bảo vệ được', 'That position is simply untenable.'),
          w('seminal', 'adjective', 'strongly influencing all later work', 'có tính khai mở', 'Her seminal paper shaped the field.'),
        ],
      },
    ],
  },
];

export interface FlatLesson extends LessonDef {
  unitId: string;
  unitTitle: string;
  band: LearnBand;
  /** Position inside its band, from 0. Unlocking follows this order. */
  position: number;
}

const positionByBand = new Map<LearnBand, number>();

/** Every lesson in band order, with its unit and its position inside the band attached. */
export const LESSONS: FlatLesson[] = UNITS.flatMap((unit) =>
  unit.lessons.map((lesson) => {
    const position = positionByBand.get(unit.band) ?? 0;
    positionByBand.set(unit.band, position + 1);
    return { ...lesson, unitId: unit.id, unitTitle: unit.title, band: unit.band, position };
  }),
);

export function lessonById(id: string): FlatLesson | null {
  return LESSONS.find((lesson) => lesson.id === id) ?? null;
}

/** Every word in the built-in seed, with the band of the lesson it comes from. */
export const WORD_BANK: Array<LessonWord & { band: LearnBand }> = LESSONS.flatMap((lesson) =>
  lesson.words.map((word) => ({ ...word, band: lesson.band })),
);

export function findBankWord(term: string): (LessonWord & { band: LearnBand }) | null {
  const key = term.trim().toLowerCase();
  return WORD_BANK.find((word) => word.term.toLowerCase() === key) ?? null;
}
