from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import Base, engine
from app.routers import assignments, auth, enrollment, reference

# For a real production rollout, prefer Alembic migrations over create_all.
# create_all is kept here so the app also boots cleanly from a fresh DB
# during local dev / first Railway deploy.
Base.metadata.create_all(bind=engine)

app = FastAPI(title="4Geeks Instructor Payroll", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(reference.router)
app.include_router(assignments.router)
app.include_router(enrollment.router)


@app.get("/health")
def health():
    return {"status": "ok"}
