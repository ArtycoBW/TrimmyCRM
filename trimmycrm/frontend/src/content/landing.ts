export type PlanCode = "start" | "business" | "pro";

export type MarketingPlan = {
  id?: string;
  code: PlanCode;
  name: string;
  price: number;
  period: string;
  description: string;
  features: string[];
  featured?: boolean;
};

export const navigation = [
  { href: "#product", label: "Возможности" },
  { href: "#examples", label: "Примеры" },
  { href: "#plans", label: "Тарифы" },
  { href: "#faq", label: "FAQ" },
];

export const productFeatures = [
  {
    icon: "spark",
    number: "01",
    title: "Сайт без разработчиков",
    text: "Соберите страницы из готовых блоков, настройте цвет и опубликуйте на своём поддомене.",
    tone: "lavender",
  },
  {
    icon: "calendar",
    number: "02",
    title: "Запись без переписок",
    text: "Клиент сам выбирает услугу, вариант, мастера и свободное время. Запись работает круглосуточно.",
    tone: "white",
  },
  {
    icon: "people",
    number: "03",
    title: "CRM без таблиц",
    text: "Карточки клиентов, история визитов, формулы и технические заметки, календарь команды.",
    tone: "sky",
  },
  {
    icon: "bell",
    number: "04",
    title: "Напоминания без рутины",
    text: "Email уже в базовом тарифе. SMS и Telegram подключаются, когда салон готов расти дальше.",
    tone: "lime",
  },
];

export const workflow = [
  {
    step: "1",
    title: "Расскажите о салоне",
    text: "Название, адрес, график, услуги и мастера заполняются в одном кабинете.",
  },
  {
    step: "2",
    title: "Соберите свой сайт",
    text: "Перетаскивайте блоки, меняйте тексты и сразу смотрите результат в предпросмотре.",
  },
  {
    step: "3",
    title: "Откройте онлайн-запись",
    text: "Опубликуйте сайт и принимайте записи в календарь без звонков и ручных переносов.",
  },
];

export const examples = [
  {
    title: "FORMA",
    city: "Москва",
    image: "/images/landing/studio-cut.svg",
    color: "#75dfb5",
    rotate: "-2.5deg",
  },
  {
    title: "БЛОК 07",
    city: "Казань",
    image: "/images/landing/barber-grid.svg",
    color: "#d15022",
    rotate: "2deg",
  },
  {
    title: "TON / 21",
    city: "Санкт-Петербург",
    image: "/images/landing/color-studio.svg",
    color: "#75dfb5",
    rotate: "-1deg",
  },
];

export const outcomes = [
  {
    quote: "Администратор видит день целиком, а не собирает его из чатов и заметок.",
    label: "Порядок в расписании",
    marker: "КАЛЕНДАРЬ",
  },
  {
    quote: "У каждого клиента остаются пожелания, формулы, фото и история визитов.",
    label: "Контекст в деталях",
    marker: "КАРТОЧКА КЛИЕНТА",
  },
  {
    quote: "Клиент записывается тогда, когда ему удобно, даже если салон уже закрыт.",
    label: "Запись 24/7",
    marker: "ОНЛАЙН",
  },
];

export const fallbackPlans: MarketingPlan[] = [
  {
    code: "start",
    name: "Старт",
    price: 990,
    period: "month",
    description: "Для частного мастера или небольшого салона.",
    features: [
      "Сайт на поддомене",
      "До 4 базовых блоков",
      "Онлайн-запись",
      "До 50 клиентов",
      "1 мастер и email-уведомления",
    ],
  },
  {
    code: "business",
    name: "Бизнес",
    price: 2490,
    period: "month",
    description: "Для салона с командой и постоянным потоком.",
    features: [
      "Все блоки конструктора",
      "Клиенты без ограничений",
      "До 3 мастеров",
      "SMS и Telegram",
      "Отзывы, акции, лояльность",
      "Аналитика и экспорт",
    ],
    featured: true,
  },
  {
    code: "pro",
    name: "Профи",
    price: 4990,
    period: "month",
    description: "Для сети, студии или быстро растущей команды.",
    features: [
      "Всё из тарифа Бизнес",
      "Мастера без ограничений",
      "Свой домен и SSL",
      "Онлайн-оплата и предоплата",
      "Расширенная аналитика",
      "Приоритетная поддержка",
    ],
  },
];

const descriptions: Record<PlanCode, string> = {
  start: fallbackPlans[0].description,
  business: fallbackPlans[1].description,
  pro: fallbackPlans[2].description,
};

const featureLabels: Record<PlanCode, string[]> = {
  start: fallbackPlans[0].features,
  business: fallbackPlans[1].features,
  pro: fallbackPlans[2].features,
};

export function normalizePlans(value: unknown): MarketingPlan[] {
  if (!Array.isArray(value)) return fallbackPlans;

  const plans = value.flatMap((item): MarketingPlan[] => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    if (!(["start", "business", "pro"] as const).includes(raw.code as PlanCode)) return [];
    const code = raw.code as PlanCode;
    const price = Number(raw.price);
    if (!Number.isFinite(price) || price < 0 || typeof raw.name !== "string") return [];

    return [
      {
        id: typeof raw.id === "string" ? raw.id : undefined,
        code,
        name: raw.name,
        price,
        period: typeof raw.period === "string" ? raw.period : "month",
        description: descriptions[code],
        features: featureLabels[code],
        featured: code === "business",
      },
    ];
  });

  if (plans.length !== 3) return fallbackPlans;
  const order: Record<PlanCode, number> = { start: 0, business: 1, pro: 2 };
  return plans.sort((left, right) => order[left.code] - order[right.code]);
}

export const faqs = [
  {
    question: "Нужно ли уметь делать сайты?",
    answer:
      "Нет. Вы выбираете готовые блоки, меняете текст, фотографии и порядок. Предпросмотр показывает будущую страницу до публикации.",
  },
  {
    question: "Как быстро появится сайт?",
    answer:
      "Черновик можно собрать за один вечер. После публикации сайт открывается на поддомене салона, а на тарифе Профи можно подключить собственный домен.",
  },
  {
    question: "Клиенты разных салонов не смешаются?",
    answer:
      "Нет. Данные каждого салона изолированы на уровне базы, а клиентская учётная запись существует только внутри конкретного салона.",
  },
  {
    question: "Можно перенести текущую клиентскую базу?",
    answer:
      "Да, базу можно подготовить к импорту. В тарифах Бизнес и Профи также доступен экспорт клиентов и записей в CSV или Excel.",
  },
  {
    question: "Что входит в индивидуальный лендинг?",
    answer:
      "Мы вручную создаём отдельный визуальный шаблон для вашего салона. Вы продолжаете менять контент в той же CRM. Стоимость разработки составляет 20 000 ₽ единоразово.",
  },
  {
    question: "Есть ли пробный период?",
    answer:
      "Да, после регистрации доступен 14-дневный пробный период. Карта для старта не нужна.",
  },
];
