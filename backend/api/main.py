# api/main.py
import logging
import threading
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from api import auth
from api.routes import alerts, scan, positions, manage, settings, portfolio, performance, upcoming
from core.db import get_engine
from core.market_hours import is_market_open, next_market_open

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("api")


def _warm_up() -> None:
    """
    Connect to the database as soon as the server starts. The server sleeps when
    idle and so does a free Postgres plan, which takes a few seconds to wake; this
    way the wake-up overlaps the app's first requests instead of following them.
    """
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        log.warning("Database warm-up failed: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    threading.Thread(target=_warm_up, name="db-warm-up", daemon=True).start()
    yield


app = FastAPI(
    title="Covered Call Scanner API",
    description="Scan, plan, and manage covered call positions.",
    version="1.0.0",
    lifespan=lifespan,
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
app.include_router(upcoming.router, dependencies=protected)
app.include_router(alerts.scheduler)          # its own key instead of the login (ALERTS_KEY)
auth.warn_if_open()

@app.get("/")
async def root():
    return {"status": "ok", "message": "Covered Call Scanner API"}

@app.get("/health")
async def health():
    return {"status": "healthy"}

# The "Market open / closed" status in the app's header. Public, like /health: it's only the NYSE calendar.
@app.get("/market")
async def market():
    open_now = is_market_open()
    return {"market_open": open_now, "next_market_open": None if open_now else next_market_open().isoformat()}
