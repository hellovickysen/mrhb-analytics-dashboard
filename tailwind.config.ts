import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        mrhb: {
          blue: '#01A6FA',
          'blue-light': '#D0EFFF',
          dark: '#29231D',
          cream: '#FEF8EF',
          'warm-grey': '#BFB4A6',
          'warm-tan': '#E5B897',
          white: '#FFFFFF',
        },
      },
      fontFamily: {
        syne: ['Syne', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
