# api/main.py
import logging

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api import auth
from api.routes import alerts, scan, positions, manage, settings, portfolio, performance

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

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

# Everything except /auth, / and /health needs a login when APP_PASSWORD is set
protected = [Depends(auth.require_auth)]
app.include_router(auth.router)
app.include_router(portfolio.router, dependencies=protected)
app.include_router(scan.router,      dependencies=protected)
app.include_router(positions.router, dependencies=protected)
app.include_router(manage.router,    dependencies=protected)
app.include_router(settings.router,  dependencies=protected)
app.include_router(performance.router, dependencies=protected)
app.include_router(alerts.router,   dependencies=protected)
auth.warn_if_open()

@app.get("/")
async def root():
    return {"status": "ok", "message": "Covered Call Scanner API"}

@app.get("/health")
async def health():
    return {"status": "healthy"}
