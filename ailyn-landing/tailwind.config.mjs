/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        ailyn: {
          400: '#7c3aed',
          500: '#6d28d9',
          600: '#5b21b6',
          900: '#1e0a3e',
        },
      },
    },
  },
  plugins: [],
};
