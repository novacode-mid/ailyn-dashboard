import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#818cf8',
          400: '#6366f1',
          500: '#4f46e5',
          600: '#4338ca',
          700: '#3730a3',
          800: '#312e81',
          900: '#1e1b4b',
        },
        ailyn: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          400: '#6366f1',
          600: '#4338ca',
          800: '#312e81',
          900: '#1e1b4b',
        },
        cyan: {
          400: '#22d3ee',
          500: '#06b6d4',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'glow': '0 0 30px rgba(99, 102, 241, 0.4)',
        'glow-sm': '0 0 15px rgba(99, 102, 241, 0.3)',
        'glow-cyan': '0 0 30px rgba(6, 182, 212, 0.3)',
      },
    },
  },
  plugins: [],
}

export default config
