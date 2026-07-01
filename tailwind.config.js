import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        accent: {
          50: '#f0fdfa', 100: '#ccfbf1', 200: '#99f6e4', 300: '#5eead4',
          400: '#2dd4bf', 500: '#14b8a6', 600: '#0d9488', 700: '#0f766e',
        },
        insight: {
          cyan: '#00E5FF',
          pink: '#F472B6',
          success: '#10B981', // Emerald
          warning: '#F59E0B', // Amber
          alert: '#F43F5E',   // Rose
        }
      },
    },
  },
  plugins: [
    typography,
  ],
};
