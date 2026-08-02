from __future__ import annotations

import json
import secrets

from fastapi import APIRouter, Query, Request
from fastapi.responses import HTMLResponse

router = APIRouter(include_in_schema=False)


def _json_for_script(value: str) -> str:
    return json.dumps(value).replace("<", "\\u003c")


def _response(content: str, nonce: str) -> HTMLResponse:
    return HTMLResponse(
        content,
        headers={
            "Cache-Control": "no-store",
            "Content-Security-Policy": (
                "default-src 'none'; "
                f"script-src 'nonce-{nonce}'; "
                f"style-src 'nonce-{nonce}'; "
                "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
            ),
            "Referrer-Policy": "no-referrer",
        },
    )


def _endpoint(request: Request, action: str) -> str:
    realm = "t/auth" if getattr(request.state, "tenant_id", None) is not None else "auth"
    return f"/api/v1/{realm}/{action}"


@router.get("/verify-email", response_class=HTMLResponse)
async def verify_email_page(
    request: Request,
    token: str = Query(min_length=16, max_length=2048, pattern=r"^[A-Za-z0-9_-]+$"),
) -> HTMLResponse:
    nonce = secrets.token_urlsafe(18)
    endpoint = _endpoint(request, "verify-email")
    content = f"""<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Подтверждение email — TrimmyCRM</title>
  <style nonce="{nonce}">
    :root {{ color-scheme: light; font-family: Inter, system-ui, sans-serif; }}
    body {{
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      background: #f5f3ff; color: #1f2937;
    }}
    main {{
      width: min(420px, calc(100% - 32px)); padding: 32px;
      border-radius: 20px; background: white; box-shadow: 0 18px 50px #312e811a;
    }}
    h1 {{ margin-top: 0; font-size: 26px; }}
    p {{ line-height: 1.5; }}
    button {{
      width: 100%; margin-top: 12px; padding: 13px 18px; border: 0;
      border-radius: 12px; background: #4f46e5; color: white;
      font: inherit; font-weight: 700; cursor: pointer;
    }}
    button:disabled {{ opacity: .55; cursor: default; }}
    #status {{ min-height: 24px; margin-top: 16px; }}
  </style>
</head>
<body>
  <main>
    <h1>Подтверждение email</h1>
    <p>Нажмите кнопку, чтобы завершить регистрацию в TrimmyCRM.</p>
    <button id="confirm" type="button">Подтвердить email</button>
    <p id="status" role="status" aria-live="polite"></p>
  </main>
  <script nonce="{nonce}">
    const token = {_json_for_script(token)};
    const endpoint = {_json_for_script(endpoint)};
    const button = document.getElementById('confirm');
    const status = document.getElementById('status');
    button.addEventListener('click', async () => {{
      button.disabled = true;
      status.textContent = 'Подтверждаем…';
      try {{
        const response = await fetch(endpoint, {{
          method: 'POST',
          headers: {{'Content-Type': 'application/json'}},
          body: JSON.stringify({{token}})
        }});
        const payload = await response.json();
        status.textContent = response.ok
          ? payload.message
          : (payload.message || 'Не удалось подтвердить email');
        if (!response.ok) button.disabled = false;
      }} catch (_) {{
        status.textContent = 'Сервис временно недоступен. Повторите попытку.';
        button.disabled = false;
      }}
    }});
  </script>
</body>
</html>"""
    return _response(content, nonce)


@router.get("/reset-password", response_class=HTMLResponse)
async def reset_password_page(
    request: Request,
    token: str = Query(min_length=16, max_length=2048, pattern=r"^[A-Za-z0-9_-]+$"),
) -> HTMLResponse:
    nonce = secrets.token_urlsafe(18)
    endpoint = _endpoint(request, "reset-password")
    content = f"""<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Новый пароль — TrimmyCRM</title>
  <style nonce="{nonce}">
    :root {{ color-scheme: light; font-family: Inter, system-ui, sans-serif; }}
    body {{
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      background: #f5f3ff; color: #1f2937;
    }}
    main {{
      width: min(420px, calc(100% - 32px)); padding: 32px;
      border-radius: 20px; background: white; box-shadow: 0 18px 50px #312e811a;
    }}
    h1 {{ margin-top: 0; font-size: 26px; }}
    label {{ display: block; margin-top: 16px; font-weight: 700; }}
    input {{
      box-sizing: border-box; width: 100%; margin-top: 7px; padding: 12px;
      border: 1px solid #c7d2fe; border-radius: 10px; font: inherit;
    }}
    button {{
      width: 100%; margin-top: 22px; padding: 13px 18px; border: 0;
      border-radius: 12px; background: #4f46e5; color: white;
      font: inherit; font-weight: 700; cursor: pointer;
    }}
    button:disabled {{ opacity: .55; cursor: default; }}
    #status {{ min-height: 24px; margin-top: 16px; }}
  </style>
</head>
<body>
  <main>
    <h1>Задайте новый пароль</h1>
    <form id="reset">
      <label>Новый пароль
        <input id="password" type="password" minlength="10" maxlength="128"
               autocomplete="new-password" required>
      </label>
      <label>Повторите пароль
        <input id="confirm" type="password" minlength="10" maxlength="128"
               autocomplete="new-password" required>
      </label>
      <button id="submit" type="submit">Сохранить пароль</button>
    </form>
    <p id="status" role="status" aria-live="polite"></p>
  </main>
  <script nonce="{nonce}">
    const token = {_json_for_script(token)};
    const endpoint = {_json_for_script(endpoint)};
    const form = document.getElementById('reset');
    const button = document.getElementById('submit');
    const status = document.getElementById('status');
    form.addEventListener('submit', async (event) => {{
      event.preventDefault();
      const password = document.getElementById('password').value;
      const passwordConfirm = document.getElementById('confirm').value;
      if (password !== passwordConfirm) {{
        status.textContent = 'Пароли не совпадают.';
        return;
      }}
      button.disabled = true;
      status.textContent = 'Сохраняем…';
      try {{
        const response = await fetch(endpoint, {{
          method: 'POST',
          headers: {{'Content-Type': 'application/json'}},
          body: JSON.stringify({{token, password, passwordConfirm}})
        }});
        const payload = await response.json();
        status.textContent = response.ok
          ? payload.message
          : (payload.message || 'Не удалось изменить пароль');
        if (!response.ok) button.disabled = false;
      }} catch (_) {{
        status.textContent = 'Сервис временно недоступен. Повторите попытку.';
        button.disabled = false;
      }}
    }});
  </script>
</body>
</html>"""
    return _response(content, nonce)
