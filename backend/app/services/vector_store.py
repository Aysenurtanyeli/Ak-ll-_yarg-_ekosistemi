from app.config import get_settings

if get_settings().vector_store_provider.lower().strip() == "pinecone":
    from app.services.pinecone_store import store, vector_id
else:
    from app.services.local_vector_store import store, vector_id

__all__ = ["store", "vector_id"]
