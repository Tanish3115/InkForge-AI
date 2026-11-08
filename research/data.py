"""Prepare writer-disjoint IAM manifests; validate licensed external line datasets."""
import argparse
import hashlib
import json
import random
import xml.etree.ElementTree as ET
from pathlib import Path


def read_manifest(path):
    path = Path(path).resolve()
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not rows:
        raise ValueError(f"Empty manifest: {path}")
    seen = set()
    for row in rows:
        for key in ("id", "image", "text", "writer", "dataset"):
            if not row.get(key):
                raise ValueError(f"Missing {key}: {row}")
        image = Path(row["image"])
        row["image"] = str((path.parent / image).resolve() if not image.is_absolute() else image.resolve())
        if not Path(row["image"]).is_file():
            raise FileNotFoundError(row["image"])
        if row["id"] in seen:
            raise ValueError(f"Duplicate sample ID: {row['id']}")
        seen.add(row["id"])
        if row.get("language", "en") != "en":
            raise ValueError("This experiment supports English only. Filter non-English CVL pages first.")
        if row["dataset"] == "custom" and not row.get("consent_id"):
            raise ValueError("Custom samples require a pseudonymous consent_id; keep consent records separately.")
    return rows


def manifest_hash(rows):
    return hashlib.sha256(json.dumps(rows, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def write_manifest(path, rows):
    Path(path).write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


def iam_rows(root):
    root = Path(root).resolve()
    writers = {}
    for line in (root / "ascii/forms.txt").read_text().splitlines():
        if line and not line.startswith("#"):
            fields = line.split()
            writers[fields[0]] = fields[1]
    rows = []
    for line in (root / "ascii/lines.txt").read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        fields = line.split(maxsplit=8)
        if len(fields) != 9:
            raise ValueError(f"Invalid IAM annotation: {line}")
        sample_id, status = fields[:2]
        form_id = sample_id.rsplit("-", 1)[0]
        image = root / "lines" / form_id.split("-")[0] / form_id / (sample_id + ".png")
        if not image.is_file():
            raise FileNotFoundError(image)
        writer = writers[form_id]
        xml_path = root / "xml" / (form_id + ".xml")
        if xml_path.exists():
            # ElementTree does not fetch the external IAM DTD.
            xml_writer = ET.parse(xml_path).getroot().get("writer-id")
            if xml_writer and xml_writer != writer:
                raise ValueError(f"Writer disagreement for {form_id}")
        rows.append({"id": sample_id, "image": str(image), "text": fields[8].replace("|", " "),
                     "writer": writer, "dataset": "iam", "language": "en", "word_segmentation": status,
                     "box": list(map(int, fields[4:8]))})
    return rows


def prepare(root, output, seed=42):
    rows = iam_rows(root)
    writers = sorted({row["writer"] for row in rows})
    if len(writers) < 3:
        raise ValueError("At least three writers are needed for train/validation/test splits.")
    random.Random(seed).shuffle(writers)
    n_val = max(1, round(len(writers) * .1))
    n_test = max(1, round(len(writers) * .1))
    groups = {"validation": set(writers[:n_val]), "test": set(writers[n_val:n_val + n_test]),
              "train": set(writers[n_val + n_test:])}
    assert not (groups["train"] & groups["validation"] or groups["train"] & groups["test"] or groups["validation"] & groups["test"])
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    report = {"seed": seed, "total_lines": len(rows), "total_writers": len(writers), "splits": {},
              "limitation": "Writer-disjoint for this fine-tuning run only. The pretrained IAM checkpoint may already have seen these writers. IAM scores are not independent generalization evidence."}
    for name, ids in groups.items():
        subset = [row for row in rows if row["writer"] in ids]
        write_manifest(output / (name + ".jsonl"), subset)
        report["splits"][name] = {"lines": len(subset), "writers": sorted(ids), "manifest_sha256": manifest_hash(subset)}
    (output / "split-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    prep = sub.add_parser("iam")
    prep.add_argument("--root", required=True, type=Path)
    prep.add_argument("--output", default="research/data/iam", type=Path)
    prep.add_argument("--seed", type=int, default=42)
    validate = sub.add_parser("validate")
    validate.add_argument("manifest", type=Path)
    args = parser.parse_args()
    if args.command == "iam":
        result = prepare(args.root, args.output, args.seed)
        print(json.dumps({"lines": result["total_lines"], "writers": result["total_writers"], "splits": {k: v["lines"] for k, v in result["splits"].items()}}, indent=2))
    else:
        rows = read_manifest(args.manifest)
        print(json.dumps({"samples": len(rows), "writers": len({r['writer'] for r in rows}), "sha256": manifest_hash(rows)}))
