import { Icon } from "@/components/ui/icons";

const days = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];

export function ProductMockup() {
  return (
    <div className="product-mockup" aria-label="Пример интерфейса TrimmyCRM">
      <div className="product-mockup__window">
        <div className="product-mockup__bar">
          <span className="window-dots"><i /><i /><i /></span>
          <span className="product-mockup__url">app.trimmycrm.ru/calendar</span>
          <span className="product-mockup__status">всё спокойно</span>
        </div>
        <div className="product-mockup__body">
          <aside className="product-mockup__sidebar">
            <span className="mini-logo">t</span>
            <span className="sidebar-item sidebar-item--active"><Icon name="calendar" /></span>
            <span className="sidebar-item"><Icon name="people" /></span>
            <span className="sidebar-item"><Icon name="bell" /></span>
          </aside>
          <div className="product-mockup__content">
            <div className="mockup-heading">
              <div>
                <span className="mockup-caption">РАСПИСАНИЕ</span>
                <strong>Неделя без накладок</strong>
              </div>
              <span className="mockup-add">+ новая запись</span>
            </div>
            <div className="calendar-board">
              {days.map((day, index) => (
                <div className="calendar-column" key={day}>
                  <span className={index === 2 ? "is-today" : ""}>{day}</span>
                  {index === 0 && <i className="appointment appointment--lime">Анна<br />Стрижка</i>}
                  {index === 1 && <i className="appointment appointment--blue">Макс<br />Фейд</i>}
                  {index === 2 && <i className="appointment appointment--pink">Лера<br />Цвет</i>}
                  {index === 3 && <i className="appointment appointment--violet">Илья<br />Борода</i>}
                  {index === 4 && <i className="appointment appointment--lime appointment--late">Маша<br />Укладка</i>}
                  {index === 5 && <i className="appointment appointment--blue">Олег<br />Стрижка</i>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="product-mockup__note note-card note-card--pink">Записи приходят сами ↓</div>
      <div className="product-mockup__kpi">
        <span>Сегодня</span>
        <strong>12 клиентов</strong>
        <small>+3 онлайн</small>
      </div>
    </div>
  );
}
