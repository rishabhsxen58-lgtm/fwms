import unittest

from app import LABELS, predict, train_classifier, PredictionInput


class ClassifierTests(unittest.TestCase):
    def test_training_returns_measured_held_out_metrics(self):
        metrics = train_classifier()
        self.assertEqual(metrics["trainingData"], "synthetic")
        self.assertGreater(metrics["trainingRows"], 0)
        self.assertGreater(metrics["testRows"], 0)
        self.assertIn("accuracy", metrics)
        self.assertIn("macroF1", metrics)
        self.assertEqual(metrics["labels"], LABELS)
        self.assertEqual(sum(sum(row) for row in metrics["confusionMatrix"]), metrics["testRows"])

    def test_prediction_returns_one_supported_class(self):
        train_classifier()
        result = predict(PredictionInput(teachingHours=12, dutyHours=2))
        self.assertIn(result["classification"], LABELS)
        self.assertEqual(result["trainingData"], "synthetic")
        self.assertIn("authoritative", result["notice"])


if __name__ == "__main__":
    unittest.main()
