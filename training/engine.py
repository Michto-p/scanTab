"""Moteur CPU local : famille uniquement, apprentissage humain et séances disjointes."""
import argparse
import contextlib
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import sys
from datetime import datetime, timezone
from uuid import uuid4

MAX_MODEL = 30_000_000
PREPROCESS = {"width": 224, "height": 224, "mode": "letterbox-blanc", "mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225]}


def local_path(root, relative):
    if Path(relative).is_absolute():
        raise ValueError("Un chemin relatif au dossier PC est attendu.")
    result = (root / relative).resolve()
    if not result.is_relative_to(root.resolve()):
        raise ValueError("Chemin hors du dossier PC.")
    return result


def read_json(path):
    if path.stat().st_size > 16 * 1024 * 1024:
        raise ValueError("Manifeste trop volumineux.")
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid4().hex + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def current_model(root):
    path = root / "models/current.json"
    return read_json(path) if path.exists() else None


def validated_family(label):
    field = label.get("famille", {})
    if not isinstance(label.get("validé_par"), str) or not label["validé_par"].strip():
        raise ValueError("Validation humaine absente.")
    datetime.fromisoformat(label["date"].replace("Z", "+00:00"))
    if field.get("niveau") != "manuel" or isinstance(field.get("confiance"), bool) or field.get("confiance") != 1 or field.get("valeur") in (None, "", "inconnu"):
        raise ValueError("La famille doit avoir été confirmée par un humain.")
    return field["valeur"]


def dataset(root, min_train=3, min_eval=2):
    source = read_json(root / "dataset.json")
    rows = {}
    image_splits, session_splits = {}, {}
    for split in ("train", "validation", "test"):
        rows[split] = []
        for item in source[split]:
            digest = item["imageHash"]
            if not re.fullmatch(r"[a-f0-9]{64}", digest):
                raise ValueError("Empreinte d'image invalide.")
            image = local_path(root, item["path"])
            if image.stat().st_size > MAX_MODEL or sha256_file(image) != digest:
                raise ValueError("Image modifiée ou trop volumineuse.")
            if digest in image_splits:
                raise ValueError("Image répétée dans les jeux d'apprentissage.")
            image_splits[digest] = split
            sessions = item["seances"]
            if not isinstance(sessions, list) or not sessions or any(not isinstance(s, str) or not s.strip() for s in sessions):
                raise ValueError("Séance photo absente.")
            for session in sessions:
                if session in session_splits and session_splits[session] != split:
                    raise ValueError("Une séance figure dans plusieurs jeux.")
                session_splits[session] = split
            rows[split].append({**item, "family": validated_family(item["label"]), "file": image})
    classes = sorted({row["family"] for row in rows["train"]})
    if len(classes) < 2:
        raise ValueError("Il faut au moins deux familles validées pour entraîner un modèle.")
    for split, minimum in (("train", min_train), ("validation", min_eval), ("test", min_eval)):
        if {r["family"] for r in rows[split]} != set(classes) or any(sum(r["family"] == c for r in rows[split]) < minimum for c in classes):
            raise ValueError(f"Jeu {split} insuffisant : au moins {minimum} vignettes distinctes par famille et séances séparées requises.")
    evaluation = {"classes": classes, "preprocess": PREPROCESS, "rows": {s: sorted((r["imageHash"], r["family"], sorted(r["seances"])) for r in rows[s]) for s in ("validation", "test")}}
    fingerprint = hashlib.sha256(json.dumps(evaluation, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return rows, classes, fingerprint


def preprocess(path):
    import numpy as np
    from PIL import Image, ImageOps
    with Image.open(path) as original:
        if original.width * original.height > 40_000_000 or original.format not in ("PNG", "JPEG", "WEBP"):
            raise ValueError("Image trop grande ou format non reconnu.")
        image = ImageOps.exif_transpose(original).convert("RGB")
        image = ImageOps.contain(image, (224, 224), Image.Resampling.BILINEAR)
        canvas = Image.new("RGB", (224, 224), "white")
        canvas.paste(image, ((224-image.width)//2, (224-image.height)//2))
        pixels = np.asarray(canvas, dtype=np.float32) / 255
    pixels = (pixels - np.array(PREPROCESS["mean"], dtype=np.float32)) / np.array(PREPROCESS["std"], dtype=np.float32)
    return pixels.transpose(2, 0, 1).copy()


def session_for(root, manifest):
    import onnxruntime as ort
    path = local_path(root, manifest["path"])
    if path.stat().st_size >= MAX_MODEL or sha256_file(path) != manifest["sha256"] or manifest["preprocess"] != PREPROCESS:
        raise ValueError("Modèle local invalide.")
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    return ort.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])


def probabilities(session, pixels):
    import numpy as np
    logits = session.run(None, {"image": pixels[None]})[0][0]
    if not np.isfinite(logits).all():
        raise ValueError("Sortie du modèle non finie.")
    scores = np.exp(logits - np.max(logits))
    return scores / scores.sum()


def analyze(root, images):
    model = current_model(root)
    if model is None:
        return {"ok": True, "modelVersion": None, "results": [], "message": "Aucun modèle de familles entraîné et adopté."}
    if not images or len(images) > 64:
        raise ValueError("Une à 64 vignettes attendues.")
    session = session_for(root, model)
    results = []
    for image in images:
        scores = probabilities(session, preprocess(local_path(root, image)))
        index = int(scores.argmax())
        confidence = float(scores[index])
        results.append({"image": image, "champs": {"famille": {"valeur": model["classes"][index] if confidence >= model["threshold"] else "inconnu", "confiance": confidence, "niveau": "classifieur"}}})
    return {"ok": True, "modelVersion": model["version"], "results": results, "limites": ["Le score du classifieur n'est pas une probabilité calibrée."]}


def setup(root):
    import torch
    from torchvision.models import MobileNet_V3_Small_Weights
    path = root / "backbone/mobilenet_v3_small.pth"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        weights = MobileNet_V3_Small_Weights.IMAGENET1K_V1.get_state_dict(progress=False, check_hash=True)
        temporary = path.with_suffix(".tmp")
        torch.save(weights, temporary)
        os.replace(temporary, path)
    return {"ok": True, "message": "Extracteur visuel local prêt. Ce n'est pas un classifieur d'appareils électriques."}


def adoption_reason(current, candidate):
    for manifest in (current, candidate):
        if manifest is not None and (isinstance(manifest.get("precision"), bool) or not isinstance(manifest.get("precision"), (int, float)) or not math.isfinite(manifest["precision"]) or not 0 <= manifest["precision"] <= 1 or not re.fullmatch(r"[a-f0-9]{64}", manifest.get("evaluation_hash", ""))):
            raise ValueError("Manifeste d'évaluation invalide.")
    if current is None:
        return True, "Premier modèle évalué sur les séances de test réservées."
    if current["evaluation_hash"] != candidate["evaluation_hash"]:
        return False, "Les séances ou familles d'évaluation ont changé : comparaison manuelle requise."
    if candidate["precision"] < current["precision"]:
        return False, "Précision inférieure au modèle utilisé : candidat conservé sans adoption."
    return True, "Précision au moins égale sur les mêmes séances réservées."


def train(root, epochs=80, min_train=3, min_eval=2):
    rows, classes, fingerprint = dataset(root, min_train, min_eval)
    import numpy as np
    import torch
    from torch import nn
    from torchvision.models import mobilenet_v3_small
    backbone = root / "backbone/mobilenet_v3_small.pth"
    if not backbone.exists():
        raise ValueError("Extracteur absent. Exécutez d'abord la préparation explicite du moteur sur le PC.")
    torch.manual_seed(42)
    torch.set_num_threads(4)
    base = mobilenet_v3_small(weights=None)
    base.load_state_dict(torch.load(backbone, map_location="cpu", weights_only=True))
    features = nn.Sequential(base.features, base.avgpool, nn.Flatten()).eval()
    for param in features.parameters():
        param.requires_grad = False
    encoded, targets = {}, {}
    for split, samples in rows.items():
        batches = []
        with torch.inference_mode():
            for start in range(0, len(samples), 16):
                pixels = torch.from_numpy(np.stack([preprocess(r["file"]) for r in samples[start:start+16]]))
                batches.append(features(pixels))
        encoded[split] = torch.cat(batches).clone()
        targets[split] = torch.tensor([classes.index(r["family"]) for r in samples], dtype=torch.long)
    head = nn.Linear(base.classifier[0].in_features, len(classes))
    optimizer = torch.optim.AdamW(head.parameters(), lr=0.003)
    loss_fn = nn.CrossEntropyLoss()
    best_score, best_state = None, None
    for _ in range(epochs):
        head.train()
        for indices in torch.randperm(len(rows["train"])).split(32):
            optimizer.zero_grad()
            loss = loss_fn(head(encoded["train"][indices]), targets["train"][indices])
            loss.backward()
            optimizer.step()
        head.eval()
        with torch.no_grad():
            output = head(encoded["validation"])
            score = (float((output.argmax(1) == targets["validation"]).float().mean()), -float(loss_fn(output, targets["validation"])))
        if best_score is None or score > best_score:
            best_score = score
            best_state = {k: v.detach().clone() for k, v in head.state_dict().items()}
    head.load_state_dict(best_state)
    model = nn.Sequential(features, head).eval()
    version = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex[:8]
    directory = root / "models/candidates" / version
    directory.mkdir(parents=True)
    path = directory / "model.onnx"
    torch.onnx.export(model, torch.zeros(1, 3, 224, 224), str(path), input_names=["image"], output_names=["famille"], opset_version=17, dynamo=False, external_data=False)
    if path.stat().st_size >= MAX_MODEL:
        raise ValueError("Le modèle exporté dépasse 30 Mo.")
    candidate = {"version": version, "date": datetime.now(timezone.utc).isoformat(), "path": str(path.relative_to(root)).replace("\\", "/"), "sha256": sha256_file(path), "bytes": path.stat().st_size, "classes": classes, "preprocess": PREPROCESS, "threshold": 0.8, "evaluation_hash": fingerprint, "train": len(rows["train"]), "validation": len(rows["validation"]), "test": len(rows["test"]), "precision": 0}
    session = session_for(root, candidate)
    check = preprocess(rows["test"][0]["file"])
    with torch.inference_mode():
        expected = model(torch.from_numpy(check[None])).numpy()
    actual = session.run(None, {"image": check[None]})[0]
    if not np.allclose(expected, actual, rtol=1e-3, atol=1e-4):
        raise ValueError("La vérification PyTorch / ONNX a échoué.")
    correct = answered = correct_answered = 0
    for row in rows["test"]:
        scores = probabilities(session, preprocess(row["file"]))
        index = int(scores.argmax())
        success = classes[index] == row["family"]
        correct += int(success)
        if float(scores[index]) >= candidate["threshold"]:
            answered += 1
            correct_answered += int(success)
    candidate.update(precision=correct/len(rows["test"]), coverage=answered/len(rows["test"]), precision_above_threshold=correct_answered/answered if answered else None)
    adopted, reason = adoption_reason(current_model(root), candidate)
    write_json(directory / "version.json", candidate)
    if adopted:
        write_json(root / "models/current.json", candidate)
    return {"ok": True, "adopted": adopted, "reason": reason, "candidate": candidate}


def status(root):
    packages = {name: importlib.metadata.version(name) for name in ("torch", "torchvision", "onnx", "onnxruntime", "Pillow", "numpy")}
    return {"ok": True, "packages": packages, "backbone": (root / "backbone/mobilenet_v3_small.pth").exists(), "model": current_model(root)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path(__file__).resolve().parent.parent / ".local/pc")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("status")
    commands.add_parser("setup")
    analysis = commands.add_parser("analyze")
    analysis.add_argument("--image", action="append", required=True)
    learning = commands.add_parser("train")
    learning.add_argument("--epochs", type=int, default=80)
    args = parser.parse_args()
    root = args.data_dir.resolve()
    root.mkdir(parents=True, exist_ok=True)
    with contextlib.redirect_stdout(sys.stderr):
        if args.command == "status":
            result = status(root)
        elif args.command == "setup":
            result = setup(root)
        elif args.command == "analyze":
            result = analyze(root, args.image)
        else:
            if not 1 <= args.epochs <= 500:
                raise ValueError("Nombre d'époques invalide.")
            result = train(root, args.epochs)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        sys.exit(1)
