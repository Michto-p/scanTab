"""Corpus artificiels de recette uniquement ; aucun modèle publié par ces tests."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("engine", Path(__file__).resolve().parents[1] / "training/engine.py")
ENGINE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ENGINE)


def corpus(root):
    from PIL import Image
    document = {"version": 1, "conflicts": []}
    serial = 0
    for split, count in (("train", 3), ("validation", 2), ("test", 2)):
        document[split] = []
        for family_index, family in enumerate(("disjoncteur", "contacteur")):
            for index in range(count):
                serial += 1
                temporary = root / "image.png"
                Image.new("RGB", (16, 32), (30+family_index*140, 20+serial, 90)).save(temporary)
                digest = ENGINE.sha256_file(temporary)
                relative = f"images/{digest}.png"
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                temporary.replace(path)
                document[split].append({"imageHash": digest, "path": relative, "seances": [f"{split}-seance-{index}"], "label": {"validé_par": "recette artificielle", "date": "2026-11-22T10:00:00+01:00", "famille": {"valeur": family, "confiance": 1, "niveau": "manuel"}}})
    ENGINE.write_json(root / "dataset.json", document)
    return document


class CorpusTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="scan-tableau-TEST-ONLY-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.document = corpus(self.root)

    def read(self):
        ENGINE.write_json(self.root / "dataset.json", self.document)
        return ENGINE.dataset(self.root)

    def test_valid_corpus(self):
        rows, classes, fingerprint = self.read()
        self.assertEqual([len(rows[k]) for k in ("train", "validation", "test")], [6, 4, 4])
        self.assertEqual(len(classes), 2)
        self.assertRegex(fingerprint, r"^[a-f0-9]{64}$")

    def test_human_validation(self):
        label = self.document["train"][0]["label"]
        for key, value in (("validé_par", ""), ("date", "invalide")):
            previous = label[key]
            label[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.read()
            label[key] = previous
        label["famille"]["niveau"] = "classifieur"
        with self.assertRaises(ValueError):
            self.read()

    def test_confidence_one(self):
        for score in (0, 0.99, True, "1", None):
            self.document["train"][0]["label"]["famille"]["confiance"] = score
            with self.subTest(score=score), self.assertRaises(ValueError):
                self.read()

    def test_seances_disjointes(self):
        self.document["test"][0]["seances"] = self.document["train"][0]["seances"]
        with self.assertRaises(ValueError):
            self.read()

    def test_no_duplicate_inflation(self):
        self.document["train"][1] = copy.deepcopy(self.document["train"][0])
        with self.assertRaises(ValueError):
            self.read()

    def test_unchanged_images(self):
        path = self.root / self.document["train"][0]["path"]
        path.write_bytes(path.read_bytes()+b"modification")
        with self.assertRaises(ValueError):
            self.read()

    def test_chemins(self):
        for path in ("../image.png", str((self.root / "image.png").resolve())):
            self.document["train"][0]["path"] = path
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.read()

    def test_minimum_evaluation(self):
        self.document["test"].pop()
        with self.assertRaises(ValueError):
            self.read()

    def test_evaluation_fingerprint(self):
        original = self.read()[2]
        self.document["test"].reverse()
        self.document["train"][0]["seances"] = ["nouvelle-seance-train"]
        self.assertEqual(self.read()[2], original)
        self.document["test"][0]["seances"] = ["nouvelle-seance-test"]
        self.assertNotEqual(self.read()[2], original)

    def test_letterbox_preserves_device(self):
        import numpy as np
        from PIL import Image
        for size in ((120, 30), (30, 120)):
            path = self.root / "large.png"
            Image.new("RGB", size, (17, 57, 101)).save(path)
            tensor = ENGINE.preprocess(path)
            self.assertEqual(tensor.shape, (3, 224, 224))
            self.assertEqual(tensor.dtype, np.float32)
            restored = np.rint((tensor.transpose(1, 2, 0)*np.array(ENGINE.PREPROCESS["std"])+np.array(ENGINE.PREPROCESS["mean"]))*255).astype(np.uint8)
            np.testing.assert_array_equal(restored[112, 112], [17, 57, 101])
            np.testing.assert_array_equal(restored[0, 0], [255, 255, 255])
            occupied = np.any(restored < 250, axis=2)
            self.assertEqual(sorted([int(np.any(occupied, axis=0).sum()), int(np.any(occupied, axis=1).sum())]), [56, 224])


class AdoptionTests(unittest.TestCase):
    def test_non_regression_same_evaluation(self):
        manifest = lambda score, digest="a"*64: {"precision": score, "evaluation_hash": digest}
        self.assertTrue(ENGINE.adoption_reason(None, manifest(.5))[0])
        self.assertTrue(ENGINE.adoption_reason(manifest(.5), manifest(.5))[0])
        self.assertFalse(ENGINE.adoption_reason(manifest(.75), manifest(.5))[0])
        self.assertFalse(ENGINE.adoption_reason(manifest(.5), manifest(1, "b"*64))[0])
        for score in (True, float("nan"), -1, 2):
            with self.subTest(score=score), self.assertRaises(ValueError):
                ENGINE.adoption_reason(None, manifest(score))


@unittest.skipUnless(os.environ.get("SCAN_TABLEAU_TEST_TRAIN") == "1", "Export CPU de recette sur demande")
class ExportTests(unittest.TestCase):
    def test_real_torch_training_onnx_inference(self):
        import torch
        from torchvision.models import mobilenet_v3_small
        with tempfile.TemporaryDirectory(prefix="scan-tableau-TEST-ONLY-") as folder:
            root = Path(folder).resolve()
            data = corpus(root)
            backbone = root / "backbone/mobilenet_v3_small.pth"
            backbone.parent.mkdir()
            torch.manual_seed(7)
            # Ces poids aléatoires sont confinés à un dossier de test détruit ensuite.
            torch.save(mobilenet_v3_small(weights=None).state_dict(), backbone)
            result = ENGINE.train(root, epochs=2)
            self.assertTrue(result["adopted"])
            candidate = result["candidate"]
            self.assertLess((root / candidate["path"]).stat().st_size, ENGINE.MAX_MODEL)
            self.assertEqual(candidate["test"], 4)
            prediction = ENGINE.analyze(root, [data["test"][0]["path"]])
            family = prediction["results"][0]["champs"]["famille"]
            self.assertEqual(family["niveau"], "classifieur")
            self.assertGreaterEqual(family["confiance"], 0)
            self.assertLessEqual(family["confiance"], 1)


if __name__ == "__main__":
    unittest.main()
