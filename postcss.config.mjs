// PostCSS pipeline: runs Tailwind v4's PostCSS plugin over globals.css at build time.
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
