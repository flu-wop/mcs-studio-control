import type { Config } from "tailwindcss";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const preset = require("@flu-wop/design-system/tailwind-preset");

const config: Config = {
  presets: [preset],
  content: [
    "./src/**/*.{ts,tsx,mdx}",
    "./node_modules/@flu-wop/design-system/src/**/*.{ts,tsx}",
  ],
  plugins: [],
};

export default config;
