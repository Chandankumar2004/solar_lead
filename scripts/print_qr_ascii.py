import sys

try:
    import qrcode
except Exception as exc:
    print(f"IMPORT_ERROR: {exc}")
    sys.exit(2)


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python scripts/print_qr_ascii.py <text>")
        return 1

    payload = sys.argv[1]
    qr = qrcode.QRCode(border=2, box_size=1)
    qr.add_data(payload)
    qr.make(fit=True)
    matrix = qr.get_matrix()

    black = "##"
    white = "  "

    for row in matrix:
        line = "".join(black if cell else white for cell in row)
        print(line)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
