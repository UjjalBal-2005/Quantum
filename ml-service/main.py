import time
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from models import run_python_holdout_evaluation, train_and_forecast_all
from schemas import HoldoutEvalResponse, TrainForecastRequest, TrainForecastResponse

app = FastAPI(
    title="Retail Smart Stock Local ML Service",
    description="Local scikit-learn demand forecasting & inventory risk classification service.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "*",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check():
    return {"status": "ok", "engine": "scikit-learn"}


@app.post("/api/ml/train-and-forecast", response_model=TrainForecastResponse)
def train_and_forecast(req: TrainForecastRequest):
    t0 = time.perf_counter()
    results = train_and_forecast_all(req)
    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 1)
    return TrainForecastResponse(results=results, trainingTimeMs=elapsed_ms)


@app.post("/api/ml/holdout-eval", response_model=HoldoutEvalResponse)
def holdout_eval(req: TrainForecastRequest):
    return run_python_holdout_evaluation(req)
