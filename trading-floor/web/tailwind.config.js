/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        wolf: { 950: '#05070b', 900: '#0a0e15', 850: '#0e131c', 800: '#131a26', 700: '#1c2534', 600: '#2a3548', 500: '#3c4a62', 400: '#6b7a93', 300: '#9aa8bf', 200: '#c7d1e0' },
        brand: { DEFAULT: '#2f7bff', glow: '#4f9bff', deep: '#123a8a' },
        pos: '#1fd67a',
        neg: '#ff4053',
        warn: '#ffc533',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
