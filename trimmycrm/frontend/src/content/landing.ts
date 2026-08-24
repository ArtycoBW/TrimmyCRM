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
    title: "Сайт салона",
    text: "Выберите готовые блоки, добавьте фотографии и цены, затем опубликуйте сайт на своём поддомене.",
  },
  {
    icon: "calendar",
    title: "Онлайн-запись",
    text: "Клиент выбирает услугу, мастера и свободное время. Новая запись сразу появляется в календаре.",
  },
  {
    icon: "people",
    title: "Клиентская база",
    text: "В карточке хранятся контакты, история визитов, формулы, фотографии и заметки мастера.",
  },
  {
    icon: "bell",
    title: "Напоминания",
    text: "Email входит в базовый тариф. В тарифах для команды доступны SMS и Telegram.",
  },
];

export const workflow = [
  {
    step: "1",
    title: "Заполните данные салона",
    text: "Укажите название, адрес, график, услуги и мастеров.",
  },
  {
    step: "2",
    title: "Настройте страницы",
    text: "Меняйте порядок блоков, тексты и фотографии в предпросмотре.",
  },
  {
    step: "3",
    title: "Опубликуйте сайт",
    text: "Включите онлайн-запись и получайте новые визиты сразу в календарь.",
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
    quote: "Администратор видит все записи на день и свободные окна мастеров.",
    label: "Расписание",
    marker: "КАЛЕНДАРЬ",
  },
  {
    quote: "Пожелания, формулы, фотографии и визиты хранятся в карточке клиента.",
    label: "Клиенты",
    marker: "КАРТОЧКА КЛИЕНТА",
  },
  {
    quote: "Клиент выбирает свободное время на сайте без звонка администратору.",
    label: "Онлайн-запись",
    marker: "ОНЛАЙН",
  },
];

export const fallbackPlans: MarketingPlan[] = [
  {
    code: "start",
    name: "Старт",
    price: 990,
    period: "month",
    description: "Для частного мастера.",
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
    description: "Для салона с командой до трёх мастеров.",
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
    description: "Для большой команды или нескольких точек.",
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
    question: "Нужен ли разработчик для сайта?",
    answer:
      "Нет. В кабинете есть готовые блоки. Вы меняете тексты, фотографии и порядок, а затем публикуете страницу.",
  },
  {
    question: "Как быстро можно запустить сайт?",
    answer:
      "Базовую страницу можно собрать за вечер. Она откроется на поддомене салона, а на тарифе Профи можно подключить свой домен.",
  },
  {
    question: "Данные разных салонов разделены?",
    answer:
      "Да. У каждого салона отдельная база. Сотрудники видят только клиентов и записи своей компании.",
  },
  {
    question: "Можно перенести текущую клиентскую базу?",
    answer:
      "Да. Поможем подготовить базу к импорту. В тарифах Бизнес и Профи также есть экспорт клиентов и записей в CSV или Excel.",
  },
  {
    question: "Что входит в индивидуальный лендинг?",
    answer:
      "Дизайнер собирает отдельный шаблон для вашего салона. Тексты и фотографии вы продолжаете менять в CRM. Разработка стоит 20 000 ₽ один раз.",
  },
  {
    question: "Есть ли пробный период?",
    answer:
      "Да. После регистрации TrimmyCRM работает бесплатно 14 дней. Банковская карта не нужна.",
  },
];
