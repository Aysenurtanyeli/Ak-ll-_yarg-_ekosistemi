from celery import Celery

from app.config import get_settings

s = get_settings()
celery_app = Celery(
    "lexiguard",
    broker=s.celery_broker_url,
    backend=s.celery_result_backend,
    include=["app.workers.tasks"],
)

celery_app.conf.timezone = "Europe/Istanbul"
celery_app.conf.beat_schedule = {
    "mevzuat-izleme-saatlik": {
        "task": "app.workers.tasks.regu_watch_poll",
        "schedule": 3600.0,
    },
}
