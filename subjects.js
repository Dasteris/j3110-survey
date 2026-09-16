// Карточки-опросники. Отредактируйте здесь названия/преподавателей, если что-то
// обрезалось в расписании и указано неточно — структура (split/поля) трогать не обязательно.
//
// split: true  -> отдельные оценки за лекции и практику/лабы (разные форматы пар)
// split: false -> одна общая оценка "работа преподавателя"

const SUBJECTS = [
  {
    key: 'algo',
    name: 'Алгоритмы и структуры данных',
    split: true,
    teacherLecture: 'Ходненко Иван Владимирович',
    teacherPractice: 'Шиманская Галина Станиславовна',
  },
  {
    key: 'calc',
    name: 'Математический анализ и основы анализа данных',
    split: true,
    teacherLecture: 'Правдин Константин',
    teacherPractice: 'Правдин Константин',
  },
  {
    key: 'prog',
    name: 'Программирование и обработка данных',
    split: true,
    teacherLecture: 'Казанцев Даниил Владимирович',
    teacherPractice: 'Овсянникова Ольга Анатольевна',
  },
  {
    key: 'linalg',
    name: 'Линейная алгебра и обработка данных',
    split: true,
    teacherLecture: 'Покидова Марина Владимировна',
    teacherPractice: 'Покидова Марина Владимировна',
  },
  {
    key: 'discrete',
    name: 'Дискретная математика',
    split: true,
    teacherLecture: 'Тарасова Елизавета Юрьевна',
    teacherPractice: 'Тарасова Елизавета Юрьевна',
  },
  {
    key: 'arch',
    name: 'Архитектура вычислительных систем',
    split: true,
    teacherLecture: 'Береснев Артем Дмитриевич',
    teacherPractice: 'Береснев Артем Дмитриевич',
  },
  {
    key: 'english',
    name: 'Английский язык A2',
    split: false,
    teacher: '',
  },
  {
    key: 'ai',
    name: 'Тренды искусственного интеллекта',
    split: false,
    teacher: 'Бухановский Александр',
  },
];

// Специальная карточка самочувствия — всегда последняя.
const WELLBEING_CARD = {
  key: 'wellbeing',
  name: 'Самочувствие и атмосфера',
  isWellbeing: true,
  fields: [
    { key: 'freeTime', label: 'Хватает свободного времени' },
    { key: 'mood', label: 'Общее самочувствие' },
    { key: 'atmosphere', label: 'Атмосфера в группе' },
  ],
};
