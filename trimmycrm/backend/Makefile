.PHONY: install lint typecheck test test-integration migrate run worker beat

install:
	python -m pip install -e '.[dev]'

lint:
	ruff check app tests
	ruff format --check app tests

typecheck:
	mypy app

test:
	pytest -m 'not integration' --cov=app --cov-report=term-missing

test-integration:
	pytest -m integration

migrate:
	alembic upgrade head

run:
	uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

worker:
	celery -A app.tasks.celery_app:celery_app worker --loglevel=INFO

beat:
	celery -A app.tasks.celery_app:celery_app beat --loglevel=INFO

