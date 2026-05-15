from __future__ import annotations

import os

from app.config import get_settings


def _load_langchain_classes():
    try:
        from langchain.chains import RetrievalQA
        from langchain_ollama import ChatOllama, OllamaEmbeddings
        from langchain_pinecone import PineconeVectorStore
    except ImportError as e:
        raise RuntimeError(
            "LangChain entegrasyonu icin paketler kurulu degil. "
            "backend/requirements.txt icindeki langchain, langchain-ollama ve "
            "langchain-pinecone paketlerini kurun."
        ) from e
    return RetrievalQA, ChatOllama, OllamaEmbeddings, PineconeVectorStore


def get_llm():
    _, ChatOllama, _, _ = _load_langchain_classes()
    settings = get_settings()
    if settings.chat_provider.lower().strip() != "ollama":
        raise RuntimeError("LangChain servisi bu projede Ollama chat modeli ile calisir.")
    return ChatOllama(
        base_url=settings.ollama_base_url,
        model=settings.chat_model,
        temperature=0.2,
    )


def get_retriever(top_k: int = 8, filter_dict: dict | None = None):
    _, _, OllamaEmbeddings, PineconeVectorStore = _load_langchain_classes()
    settings = get_settings()
    if settings.vector_store_provider.lower().strip() != "pinecone":
        raise RuntimeError("LangChain retriever icin VECTOR_STORE_PROVIDER=pinecone olmalidir.")
    if not settings.pinecone_api_key:
        raise RuntimeError("PINECONE_API_KEY ortam degiskeni tanimli degil.")
    os.environ.setdefault("PINECONE_API_KEY", settings.pinecone_api_key)

    embeddings = OllamaEmbeddings(
        base_url=settings.ollama_base_url,
        model=settings.embedding_model,
    )
    vectorstore = PineconeVectorStore.from_existing_index(
        index_name=settings.pinecone_index_name,
        embedding=embeddings,
        text_key="text_excerpt",
    )
    search_kwargs: dict = {"k": max(1, top_k)}
    if filter_dict:
        search_kwargs["filter"] = filter_dict
    return vectorstore.as_retriever(search_kwargs=search_kwargs)


def langchain_query(sorgu: str, top_k: int = 8, filter_dict: dict | None = None) -> str:
    RetrievalQA, _, _, _ = _load_langchain_classes()
    chain = RetrievalQA.from_chain_type(
        llm=get_llm(),
        retriever=get_retriever(top_k, filter_dict=filter_dict),
        return_source_documents=False,
    )
    result = chain.invoke({"query": sorgu})
    return str(result.get("result") or "")
