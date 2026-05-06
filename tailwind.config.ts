import type { Config } from "tailwindcss";

const config: Config = {
    content: [
        "./pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./components/**/*.{js,ts,jsx,tsx,mdx}",
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                bg: "var(--bg)",
                black: "var(--black)",
                vermilion: "var(--vermilion)",
                "vermilion-d": "var(--vermilion-d)",
                profit: "var(--profit)",
                loss: "var(--loss)",
                gray: {
                    50: "var(--gray-50)",
                    100: "var(--gray-100)",
                    200: "var(--gray-200)",
                    300: "var(--gray-300)",
                    400: "var(--gray-400)",
                    500: "var(--gray-500)",
                    600: "var(--gray-600)",
                    700: "var(--gray-700)",
                    800: "var(--gray-800)",
                    900: "var(--gray-900)",
                    950: "var(--gray-950)",
                },
            },
            fontFamily: {
                display: ['var(--font-sora)', 'system-ui', 'sans-serif'],
                body: ['var(--font-inter)', 'system-ui', 'sans-serif'],
                mono: ['var(--font-jetbrains)', 'ui-monospace', 'monospace'],
                jp: ['var(--font-noto-serif-jp)', 'serif'],
            },
        },
    },
    plugins: [],
};

export default config;
