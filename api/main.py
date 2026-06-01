# api/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routes import scan, positions, manage, settings, portfolio

app = FastAPI(
    title="Covered Call Scanner API",
    description="Scan, plan, and manage covered call positions.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "https://covered-call-bot.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(portfolio.router)
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
