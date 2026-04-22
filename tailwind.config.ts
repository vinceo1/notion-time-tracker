import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "SF Mono",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        bg: {
          DEFAULT: "#0b0b0d",
          surface: "#121215",
          elev: "#17171b",
          border: "#24242a",
        },
        accent: {
          DEFAULT: "#ffffff",
          muted: "#a1a1aa",
        },
        due: {
          overdue: "#ef4444",
          today: "#f59e0b",
          soon: "#60a5fa",
          later: "#71717a",
          none: "#52525b",
        },
      },
      boxShadow: {
        subtle: "0 1px 2px rgba(0,0,0,0.25)",
        ring: "0 0 0 1px rgba(255,255,255,0.06) inset",
      },
      animation: {
        pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
