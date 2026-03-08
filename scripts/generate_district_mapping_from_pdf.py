import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


def load_pdf_text(pdf_path: Path) -> str:
    reader = None
    try:
        from pypdf import PdfReader  # type: ignore

        reader = PdfReader(str(pdf_path))
    except Exception:
        from PyPDF2 import PdfReader  # type: ignore

        reader = PdfReader(str(pdf_path))

    parts: list[str] = []
    for page in reader.pages:
        text = page.extract_text() or ""
        parts.append(text)
    return "\n".join(parts)


def normalize_token(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", value.strip())
    return cleaned


def normalize_state_name(value: str) -> str:
    state = normalize_token(value)
    state = state.replace("India - ", "").replace("India – ", "")
    state = state.replace("Union Territory Example – ", "").replace("Union Territory Example - ", "")
    return state


def parse_mapping(text: str) -> dict[str, list[str]]:
    mapping: dict[str, list[str]] = {}
    current_state: str | None = None

    lines = [normalize_token(line) for line in text.splitlines()]
    lines = [line for line in lines if line]

    state_header = re.compile(r"^(.+?)\s*\((\d+)\)$")
    skip_lines = {
        "India – States and Districts List",
        "INDIA – STATES AND DISTRICTS LIST",
    }

    for line in lines:
        if line in skip_lines or line.startswith("===== PAGE"):
            continue

        header_match = state_header.match(line)
        if header_match:
            current_state = normalize_state_name(header_match.group(1))
            mapping.setdefault(current_state, [])
            continue

        if not current_state:
            continue

        parts = [normalize_token(part) for part in line.split(",")]
        for part in parts:
            district_name = part.strip(" .")
            if (
                district_name
                and len(district_name) > 1
                and district_name not in mapping[current_state]
            ):
                mapping[current_state].append(district_name)

    # Drop empty states.
    return {state: districts for state, districts in mapping.items() if districts}


def index_to_uuid(index: int) -> str:
    tail = f"{index:012x}"
    return f"00000000-0000-4000-8000-{tail}"


def build_payload(mapping: dict[str, list[str]]) -> dict:
    states = sorted(mapping.keys())
    districts: list[dict[str, str]] = []
    out_mapping: dict[str, list[dict[str, str]]] = {}

    idx = 1
    for state in states:
        out_mapping[state] = []
        for district in sorted(mapping[state]):
            district_id = index_to_uuid(idx)
            idx += 1
            out_mapping[state].append({"id": district_id, "name": district})
            districts.append({"id": district_id, "name": district, "state": state})

    return {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "states": states,
        "mapping": out_mapping,
        "districts": districts,
    }


def main() -> int:
    if len(sys.argv) < 3:
        print(
            "Usage: python scripts/generate_district_mapping_from_pdf.py <input.pdf> <output.json>"
        )
        return 1

    pdf_path = Path(sys.argv[1]).resolve()
    output_path = Path(sys.argv[2]).resolve()

    if not pdf_path.exists():
        print(f"PDF not found: {pdf_path}")
        return 1

    text = load_pdf_text(pdf_path)
    mapping = parse_mapping(text)
    payload = build_payload(mapping)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")

    print(
        f"Generated {output_path} with {len(payload['states'])} states and {len(payload['districts'])} districts"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
