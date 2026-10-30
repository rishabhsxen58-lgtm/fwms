from __future__ import annotations

from typing import Literal

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import train_test_split

app = FastAPI(
    title="Faculty Workload Classifier",
    description="Optional Random Forest classification service. Calculated workload remains authoritative.",
    version="1.0.0",
)

LABELS = ["Underloaded", "Balanced", "High Workload"]
model: RandomForestClassifier | None = None
evaluation: dict[str, object] | None = None


def train_classifier() -> dict[str, object]:
    # Synthetic labeled examples are generated from the same transparent workload bands
    # used by the demo institution; test metrics are computed on a held-out split.
    rng = np.random.default_rng(2026)
    sample_count = 3000
    teaching = rng.uniform(0, 30, sample_count)
    duties = rng.uniform(0, 8, sample_count)
    totals = teaching + duties
    labels = np.where(totals < 8, LABELS[0], np.where(totals > 16, LABELS[2], LABELS[1]))
    features = np.column_stack((teaching, duties))
    x_train, x_test, y_train, y_test = train_test_split(
        features, labels, test_size=0.25, random_state=42, stratify=labels
    )
    classifier = RandomForestClassifier(
        n_estimators=160, max_depth=8, min_samples_leaf=2, random_state=42, class_weight="balanced"
    )
    classifier.fit(x_train, y_train)
    predicted = classifier.predict(x_test)
    report = classification_report(y_test, predicted, labels=LABELS, output_dict=True, zero_division=0)
    global model, evaluation
    model = classifier
    evaluation = {
        "trainingData": "synthetic",
        "trainingRows": int(len(x_train)),
        "testRows": int(len(x_test)),
        "accuracy": float(accuracy_score(y_test, predicted)),
        "macroF1": float(f1_score(y_test, predicted, labels=LABELS, average="macro")),
        "labels": LABELS,
        "classificationReport": {
            label: {
                "precision": float(report[label]["precision"]),
                "recall": float(report[label]["recall"]),
                "f1Score": float(report[label]["f1-score"]),
                "support": int(report[label]["support"]),
            }
            for label in LABELS
        },
        "confusionMatrix": confusion_matrix(y_test, predicted, labels=LABELS).tolist(),
    }
    return evaluation


class PredictionInput(BaseModel):
    teachingHours: float = Field(ge=0, le=80)
    dutyHours: float = Field(ge=0, le=80)


@app.on_event("startup")
def startup() -> None:
    train_classifier()


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ready" if model is not None else "not trained",
        "modelReady": model is not None,
        "model": "RandomForestClassifier",
        "trainingData": "synthetic",
    }


@app.get("/metrics")
def metrics() -> dict[str, object]:
    if evaluation is None:
        raise HTTPException(status_code=503, detail="Classifier has not been trained")
    return evaluation


@app.post("/train")
def train() -> dict[str, object]:
    return train_classifier()


@app.post("/predict")
def predict(payload: PredictionInput) -> dict[str, object]:
    if model is None:
        raise HTTPException(status_code=503, detail="Classifier is not ready")
    label: Literal["Underloaded", "Balanced", "High Workload"] = model.predict(
        np.array([[payload.teachingHours, payload.dutyHours]])
    )[0]
    return {
        "classification": label,
        "notice": "ML estimate only; the platform's policy-based workload calculation is authoritative.",
        "trainingData": "synthetic",
    }
