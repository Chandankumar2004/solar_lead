import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eaf8f2",
          100: "#c9ecd9",
          600: "#1f7a59",
          700: "#14553d"
        }
      }
    }
  },
  plugins: []
} satisfies Config;

