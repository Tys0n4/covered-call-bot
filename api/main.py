# api/main.py
"""
FastAPI backend for the Covered Call Scanner.

Run with:
  uvicorn api.main:app --reload --port 8000

From the covered-call-bot/ root directory.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import scan, positions, manage, settings

app = FastAPI(
    title="Covered Call Scanner API",
    description="Scan, plan, and manage covered call positions.",
    version="1.0.0",
)

# Allow requests from the React frontend during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routes
app.include_router(scan.router)
app.include_router(positions.router)
app.include_router(manage.router)
app.include_router(settings.router)


@app.get("/")
async def root():
    return {"status": "ok", "message": "Covered Call Scanner API"}


@app.get("/health")
async def health():
    return {"status": "healthy"}
