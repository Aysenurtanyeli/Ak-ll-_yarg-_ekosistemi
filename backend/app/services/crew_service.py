from __future__ import annotations

from app.config import get_settings


def _load_crewai_classes():
    try:
        from crewai import Agent, Crew, LLM, Task
    except ImportError as e:
        raise RuntimeError(
            "CrewAI entegrasyonu icin crewai paketi kurulu degil. "
            "backend/requirements.txt icindeki bagimliliklari kurun."
        ) from e
    return Agent, Crew, LLM, Task


def _get_llm():
    _, _, LLM, _ = _load_crewai_classes()
    settings = get_settings()
    if settings.chat_provider.lower().strip() != "ollama":
        raise RuntimeError("CrewAI servisi bu projede Ollama chat modeli ile calisir.")
    return LLM(
        model=f"ollama/{settings.chat_model}",
        base_url=settings.ollama_base_url,
    )


def run_legal_crew(belgeler: str, sorgu: str) -> str:
    Agent, Crew, _, Task = _load_crewai_classes()
    llm = _get_llm()

    belge_uzmani = Agent(
        role="Belge Analisti",
        goal="Hukuki belgelerdeki kritik olaylari, kisileri, tarihleri ve delilleri cikar",
        backstory="Turk hukuk belgelerini kaynak disiplininden kopmadan inceleyen deneyimli bir analiz uzmani.",
        llm=llm,
        verbose=False,
    )
    hukuk_analisti = Agent(
        role="Hukuk Analisti",
        goal="Belge analizine gore celiskileri, riskleri ve stratejik hukuki notlari degerlendir",
        backstory="Turk hukuk sistemi, delil degerlendirme ve dava stratejisi alanlarinda calisan dikkatli bir hukukcu.",
        llm=llm,
        verbose=False,
    )
    dilekce_yazari = Agent(
        role="Dilekce Yazari",
        goal="Analizi resmi, sade ve kaynak sinirlarina bagli Turkce hukuki metne donustur",
        backstory="Mahkeme dilekcesi ve avukat gorus notu yaziminda uzman bir hukuk metni yazari.",
        llm=llm,
        verbose=False,
    )

    t1 = Task(
        description=(
            "Asagidaki LangChain/Pinecone baglamini incele. Yalnizca verilen baglama dayanarak "
            f"kritik kisileri, tarihleri, olaylari, delilleri ve celiskileri cikar.\n\nBaglam:\n{belgeler}"
        ),
        expected_output="Kisiler, tarihler, olaylar, deliller ve celiskilerden olusan kaynak sinirli analiz listesi.",
        agent=belge_uzmani,
    )
    t2 = Task(
        description=(
            f"Kullanici sorusu: {sorgu}\n"
            "Belge analizini kullanarak hukuki riskleri, eksik delilleri ve olasi argumanlari degerlendir. "
            "Kaynakta olmayan bilgiyi kesin hukum gibi yazma."
        ),
        expected_output="Risk analizi, celiskiler, eksik noktalar ve avukat icin stratejik notlar.",
        agent=hukuk_analisti,
        context=[t1],
    )
    t3 = Task(
        description=(
            "Belge analizi ve hukuk analistinin notlarini resmi Turkceyle nihai cevaba donustur. "
            "Cevap kullanici sorusunu dogrudan yanitlasin; gerekiyorsa dilekce taslagi bolumu ekle."
        ),
        expected_output="Kaynak sinirli analiz ve gerekiyorsa resmi hukuki metin/dilekce taslagi.",
        agent=dilekce_yazari,
        context=[t1, t2],
    )

    crew = Crew(
        agents=[belge_uzmani, hukuk_analisti, dilekce_yazari],
        tasks=[t1, t2, t3],
        verbose=False,
    )
    return str(crew.kickoff())
