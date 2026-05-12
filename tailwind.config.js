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
