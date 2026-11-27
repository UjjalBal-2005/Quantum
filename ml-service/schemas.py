from typing import List, Literal, Optional
from pydantic import BaseModel, Field


class SalesRecordIn(BaseModel):
    date: str
    product_id: str
    product: str
    category: str
    quantity_sold: float
    selling_price: Optional[float] = None
    promotion_name: Optional[str] = None
    is_promotion: Optional[bool] = False
    stock_availability: Optional[str] = None


class InventoryRecordIn(BaseModel):
    product_id: str
    product: str
    category: str
    current_stock: float
    reorder_level: float
    quantity_received: float = 0.0
    stock_availability: str = "in_stock"
    incoming_stock: Optional[float] = 0.0
    lead_time_days: Optional[int] = None
    shelf_life_days: Optional[int] = None


class CalendarRecordIn(BaseModel):
    date: str
    day_of_week: Optional[str] = None
    is_weekend: Optional[bool] = None
    holiday: Optional[str] = None
    festival: Optional[str] = None
    promotion_event: Optional[str] = None
    event_name: Optional[str] = None


class TrainForecastRequest(BaseModel):
    sales: List[SalesRecordIn]
    inventory: List[InventoryRecordIn]
    calendar: List[CalendarRecordIn] = Field(default_factory=list)
    horizonDays: int = 7
    defaultLeadTimeDays: int = 3


class DailyPredictedPoint(BaseModel):
    date: str
    predictedUnits: float


class MlFeatureDriver(BaseModel):
    feature: str
    label: str
    importance: float


class MlProductResult(BaseModel):
    productId: str
    engineUsed: Literal["python_sklearn", "statistical_fallback"]
    dailyForecast: List[DailyPredictedPoint]
    horizonDemand: float
    demand14d: float
    mlRiskClass: Literal["Urgent", "Watch", "Healthy", "Excess"]
    mlRiskConfidence: float
    trainingSamples: int
    topDrivers: List[MlFeatureDriver]


class TrainForecastResponse(BaseModel):
    results: List[MlProductResult]
    trainingTimeMs: float


class HoldoutProductMetric(BaseModel):
    productId: str
    product: str
    category: str
    actualTotal: float
    mlMae: float
    mlWmape: float
    mlStockoutDays: int
    mlEndingStock: float


class HoldoutEvalResponse(BaseModel):
    holdoutDays: int
    startDate: str
    endDate: str
    portfolioMlMae: float
    portfolioMlWmape: float
    totalMlStockoutDays: int
    totalMlEndingStock: float
    productsEvaluated: int
    perProduct: List[HoldoutProductMetric]
    assumptions: List[str]
