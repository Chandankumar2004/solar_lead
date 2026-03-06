const QRCode = require("qrcode");

const input = process.argv[2];

if (!input) {
  console.error("Usage: node scripts/print-qr.cjs <text>");
  process.exit(1);
}

QRCode.toString(input, { type: "utf8" }, (error, output) => {
  if (error) {
    console.error(error.message || String(error));
    process.exit(1);
  }
  console.log(output);
});
