module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module"
  },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"],
  ignorePatterns: [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.next/**",
    "**/.expo/**",
    "coverage/**"
  ],
  overrides: [
    {
      files: ["apps/web/**/*.{ts,tsx,js,jsx}"],
      env: { browser: true, node: true }
    },
    {
      files: ["apps/mobile/**/*.{ts,tsx,js,jsx}"],
      env: { browser: true, node: true }
    },
    {
      files: ["apps/api/**/*.{ts,js}"],
      env: { node: true }
    }
  ]
};

