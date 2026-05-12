from app.workers.celery_app import celery_app


@celery_app.task(name="app.workers.tasks.regu_watch_poll")
def regu_watch_poll() -> int:
    from app.services.regu_watch import process_feeds_sync
    from app.sync_db import sync_session

    session = sync_session()
    try:
        return process_feeds_sync(session)
    finally:
        session.close()
