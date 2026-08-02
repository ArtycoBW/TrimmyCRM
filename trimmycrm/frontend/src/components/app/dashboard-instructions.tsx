"use client";

export function DashboardInstructions() {
  return (
    <section className="instructions-page">
      <p className="crm-kicker">Помощь</p>
      <h1>Инструкция.</h1>
      <p className="instructions-page__lead">Короткая экскурсия поможет быстро найти записи, клиентов, сайт салона и настройки.</p>
      <div className="instructions-page__card">
        <span aria-hidden="true">01</span>
        <div><h2>Повторить знакомство с кабинетом</h2><p>Тур можно запускать в любой момент — он ничего не изменит в данных салона.</p></div>
        <button className="button button--ink" type="button" onClick={() => window.dispatchEvent(new Event("trimmycrm:start-dashboard-tour"))}>Запустить тур</button>
      </div>
    </section>
  );
}
